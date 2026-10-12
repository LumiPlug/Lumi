// SPDX-License-Identifier: MPL-2.0

import type { DatabaseSync } from 'node:sqlite'
import {
  type CapabilityDefinition,
  type CapabilityField,
  type CapabilitySummary,
  type CapabilityTool,
  type JsonSchema,
  toCapabilitySummary,
  validateCapabilityDefinition,
  type ValidationIssue,
} from '@lumiplug/shared'

interface CapabilityRow {
  id: string
  name: string
  namespace: string
  description: string
  version: number
  source: CapabilityDefinition['source']
  status: CapabilityDefinition['status']
  enabled: number
  archived: number
  created_at: string
  updated_at: string
}

interface RunnerRow {
  runner_type: CapabilityDefinition['runner']['type']
  settings_json: string
}

interface ToolRow {
  upstream_name: string | null
  upstream_signature: string | null
  upstream_input_schema_json: string | null
  upstream_output_schema_missing: number | null
  name: string
  description: string
  output_schema_json: string
  position: number
}

interface FieldRow {
  field_key: string
  schema_json: string
  required: number
  ai_visible: number
  value_json: string
  binding_json: string | null
  position: number
}

export class CapabilityValidationError extends Error {
  public readonly issues: ValidationIssue[]

  public constructor(issues: ValidationIssue[]) {
    super('capability_validation_failed')
    this.name = 'CapabilityValidationError'
    this.issues = issues
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function begin(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE;')
}

function commit(database: DatabaseSync): void {
  database.exec('COMMIT;')
}

function rollback(database: DatabaseSync): void {
  database.exec('ROLLBACK;')
}

export class CapabilityRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public saveDraft(input: CapabilityDefinition, expectedVersion?: number): CapabilityDefinition {
    const validation = validateCapabilityDefinition(input)
    if (!validation.valid) {
      throw new CapabilityValidationError(validation.issues)
    }

    const existing = this.getById(input.id)
    if (expectedVersion !== undefined && (existing?.version ?? 0) !== expectedVersion) {
      throw new Error('tool_version_conflict')
    }
    const timestamp = new Date().toISOString()
    const definition: CapabilityDefinition = {
      ...input,
      version: existing ? existing.version + 1 : input.version,
      status: 'draft',
      enabled: false,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? input.createdAt,
      updatedAt: timestamp,
    }

    begin(this.database)
    try {
      this.database
        .prepare(
          `INSERT INTO capabilities
            (id, name, namespace, description, version, source, status, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             namespace = excluded.namespace,
             description = excluded.description,
             version = excluded.version,
             source = excluded.source,
             status = excluded.status,
             enabled = excluded.enabled,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          definition.id,
          definition.name,
          definition.namespace,
          definition.description,
          definition.version,
          definition.source,
          definition.status,
          0,
          definition.createdAt,
          definition.updatedAt,
        )
      this.replaceRunner(definition)
      this.replaceTools(definition)
      this.saveVersionSnapshot(definition)
      commit(this.database)
    } catch (error) {
      rollback(this.database)
      throw error
    }

    return definition
  }

  public getById(id: string): CapabilityDefinition | null {
    const row = this.database.prepare('SELECT * FROM capabilities WHERE id = ?').get(id) as
      CapabilityRow | undefined
    if (!row) {
      return null
    }

    const runner = this.database
      .prepare('SELECT runner_type, settings_json FROM runner_configs WHERE capability_id = ?')
      .get(id) as RunnerRow | undefined
    if (!runner) {
      throw new Error('capability_runner_missing')
    }

    const toolRows = this.database
      .prepare(
        `SELECT name, description, output_schema_json, position, upstream_name, upstream_signature, upstream_input_schema_json, upstream_output_schema_missing
         FROM capability_tools WHERE capability_id = ? ORDER BY position ASC`,
      )
      .all(id) as unknown as ToolRow[]

    const tools: CapabilityTool[] = toolRows.map((toolRow) => {
      const fieldRows = this.database
        .prepare(
          `SELECT field_key, schema_json, required, ai_visible, value_json, binding_json, position
           FROM capability_tool_fields
           WHERE capability_id = ? AND tool_name = ?
           ORDER BY position ASC`,
        )
        .all(id, toolRow.name) as unknown as FieldRow[]

      const fields: CapabilityField[] = fieldRows.map((fieldRow) => ({
        key: fieldRow.field_key,
        schema: parseJson<JsonSchema>(fieldRow.schema_json),
        required: fieldRow.required === 1,
        aiVisible: fieldRow.ai_visible === 1,
        value: parseJson<CapabilityField['value']>(fieldRow.value_json),
        binding: fieldRow.binding_json
          ? parseJson<CapabilityField['binding']>(fieldRow.binding_json)
          : null,
      }))

      return {
        ...(toolRow.upstream_name ? { upstreamName: toolRow.upstream_name } : {}),
        ...(toolRow.upstream_signature ? { upstreamSignature: toolRow.upstream_signature } : {}),
        ...(toolRow.upstream_input_schema_json
          ? { upstreamInputSchema: parseJson<JsonSchema>(toolRow.upstream_input_schema_json) }
          : {}),
        ...(toolRow.upstream_output_schema_missing !== null
          ? { upstreamOutputSchemaMissing: toolRow.upstream_output_schema_missing === 1 }
          : {}),
        name: toolRow.name,
        description: toolRow.description,
        fields,
        outputSchema: parseJson<JsonSchema>(toolRow.output_schema_json),
      }
    })

    return {
      id: row.id,
      name: row.name,
      namespace: row.namespace,
      description: row.description,
      version: row.version,
      source: row.source,
      status: row.status,
      enabled: row.enabled === 1,
      archived: row.archived === 1,
      runner: {
        type: runner.runner_type,
        settings: parseJson<CapabilityDefinition['runner']['settings']>(runner.settings_json),
      },
      tools,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  public listAll(): CapabilityDefinition[] {
    const rows = this.database
      .prepare('SELECT id FROM capabilities ORDER BY updated_at DESC, id ASC')
      .all() as unknown as Array<{ id: string }>
    return rows.flatMap((row) => {
      const definition = this.getById(row.id)
      return definition ? [definition] : []
    })
  }

  public listEnabled(): CapabilityDefinition[] {
    const rows = this.database
      .prepare(
        `SELECT id FROM capabilities
         WHERE enabled = 1 AND status = 'ready' AND archived = 0
         ORDER BY updated_at DESC, id ASC`,
      )
      .all() as unknown as Array<{ id: string }>
    return rows.flatMap((row) => {
      const definition = this.getById(row.id)
      return definition ? [definition] : []
    })
  }

  public listSummaries(): CapabilitySummary[] {
    return this.listAll().map(toCapabilitySummary)
  }

  public enable(id: string, actor: 'ui'): CapabilityDefinition {
    if (actor !== 'ui') {
      throw new Error('only_ui_may_enable_capabilities')
    }
    const current = this.getById(id)
    if (!current) {
      throw new Error('capability_not_found')
    }
    if (current.archived) throw new Error('tool_archived')

    const next: CapabilityDefinition = {
      ...current,
      status: 'ready',
      enabled: true,
      updatedAt: new Date().toISOString(),
    }
    const validation = validateCapabilityDefinition(next)
    if (!validation.valid) {
      throw new CapabilityValidationError(validation.issues)
    }

    begin(this.database)
    try {
      this.database
        .prepare(
          `UPDATE capabilities SET status = 'ready', enabled = 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(next.updatedAt, id)
      this.saveVersionSnapshot(next)
      commit(this.database)
    } catch (error) {
      rollback(this.database)
      throw error
    }
    return next
  }

  public disable(id: string, actor: 'ui'): CapabilityDefinition {
    if (actor !== 'ui') {
      throw new Error('only_ui_may_disable_capabilities')
    }
    const current = this.getById(id)
    if (!current) {
      throw new Error('capability_not_found')
    }

    const next: CapabilityDefinition = {
      ...current,
      status: 'disabled',
      enabled: false,
      updatedAt: new Date().toISOString(),
    }
    begin(this.database)
    try {
      this.database
        .prepare(
          `UPDATE capabilities SET status = 'disabled', enabled = 0, updated_at = ?
           WHERE id = ?`,
        )
        .run(next.updatedAt, id)
      this.saveVersionSnapshot(next)
      commit(this.database)
    } catch (error) {
      rollback(this.database)
      throw error
    }
    return next
  }

  public setArchived(id: string, archived: boolean): CapabilityDefinition {
    const current = this.getById(id)
    if (!current) throw new Error('capability_not_found')
    const next: CapabilityDefinition = {
      ...current,
      archived,
      enabled: false,
      status: archived ? 'disabled' : 'draft',
      updatedAt: new Date().toISOString(),
    }
    begin(this.database)
    try {
      this.database
        .prepare(
          'UPDATE capabilities SET archived = ?, enabled = 0, status = ?, updated_at = ? WHERE id = ?',
        )
        .run(archived ? 1 : 0, next.status, next.updatedAt, id)
      this.saveVersionSnapshot(next)
      commit(this.database)
    } catch (error) {
      rollback(this.database)
      throw error
    }
    return next
  }

  private replaceRunner(definition: CapabilityDefinition): void {
    this.database.prepare('DELETE FROM runner_configs WHERE capability_id = ?').run(definition.id)
    this.database
      .prepare(
        `INSERT INTO runner_configs (capability_id, runner_type, settings_json)
         VALUES (?, ?, ?)`,
      )
      .run(definition.id, definition.runner.type, JSON.stringify(definition.runner.settings))
  }

  private replaceTools(definition: CapabilityDefinition): void {
    this.database
      .prepare('DELETE FROM capability_tool_fields WHERE capability_id = ?')
      .run(definition.id)
    this.database.prepare('DELETE FROM capability_tools WHERE capability_id = ?').run(definition.id)

    const toolStatement = this.database.prepare(
      `INSERT INTO capability_tools
        (capability_id, name, description, output_schema_json, position, upstream_name, upstream_signature, upstream_input_schema_json, upstream_output_schema_missing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const fieldStatement = this.database.prepare(
      `INSERT INTO capability_tool_fields
        (capability_id, tool_name, field_key, schema_json, required, ai_visible, value_json, binding_json, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    definition.tools.forEach((tool, toolIndex) => {
      toolStatement.run(
        definition.id,
        tool.name,
        tool.description,
        JSON.stringify(tool.outputSchema),
        toolIndex,
        tool.upstreamName ?? null,
        tool.upstreamSignature ?? null,
        tool.upstreamInputSchema ? JSON.stringify(tool.upstreamInputSchema) : null,
        tool.upstreamOutputSchemaMissing === undefined
          ? null
          : tool.upstreamOutputSchemaMissing
            ? 1
            : 0,
      )
      tool.fields.forEach((field, fieldIndex) => {
        fieldStatement.run(
          definition.id,
          tool.name,
          field.key,
          JSON.stringify(field.schema),
          field.required ? 1 : 0,
          field.aiVisible ? 1 : 0,
          JSON.stringify(field.value),
          field.binding === null ? null : JSON.stringify(field.binding),
          fieldIndex,
        )
      })
    })
  }

  private saveVersionSnapshot(definition: CapabilityDefinition): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO capability_versions
          (capability_id, version, definition_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(definition.id, definition.version, JSON.stringify(definition), new Date().toISOString())
  }
}
