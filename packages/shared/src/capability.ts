// SPDX-License-Identifier: MPL-2.0

import type { JsonSchema, JsonValue } from './json'
import { responseFilterSchema } from './response-filter'

export const RUNNER_TYPES = ['terminal', 'http', 'mcp'] as const
export type RunnerType = (typeof RUNNER_TYPES)[number]

export const CAPABILITY_STATUSES = ['draft', 'ready', 'disabled'] as const
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number]

export const CAPABILITY_SOURCES = ['ui', 'ai', 'import'] as const
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number]

export interface CapabilityFieldBinding {
  location: 'argument' | 'body' | 'header' | 'mcpArgument' | 'path' | 'query' | 'stdin'
  key: string
}

export interface CapabilityField {
  key: string
  schema: JsonSchema
  required: boolean
  aiVisible: boolean
  /** null is used instead of undefined so canonical definitions remain JSON serializable. */
  value: JsonValue | null
  binding: CapabilityFieldBinding | null
}

export interface TerminalRunnerSettings {
  type: 'terminal'
  command?: string
  cwd: string
  shell: string
  environment: Record<string, string>
}

export interface HttpRunnerSettings {
  type: 'http'
  url: string
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  timeoutMs: number
  fixedHeaders: Record<string, string>
  responseMode?: 'json' | 'text'
  bodyMode?: 'json' | 'form'
  body?: JsonValue
  responseFilter?: JsonValue
}

export interface McpRunnerSettings {
  type: 'mcp'
  transport: 'stdio' | 'streamable-http'
  command: string | null
  args: string[]
  url: string | null
  environment: Record<string, string>
  headers?: Record<string, string>
  toolName?: string
}

export type RunnerSettings = TerminalRunnerSettings | HttpRunnerSettings | McpRunnerSettings

export interface CapabilityTool {
  name: string
  description: string
  fields: CapabilityField[]
  outputSchema: JsonSchema
  /** Actual upstream identifier, never derived by stripping a namespace. */
  upstreamName?: string
  upstreamSignature?: string
  /** Canonical upstream constraints, retained internally and checked after merging private fields. */
  upstreamInputSchema?: JsonSchema
  /** Distinguishes an absent upstream schema from an explicit output allow-list. */
  upstreamOutputSchemaMissing?: boolean
}

export interface CapabilityDefinition {
  id: string
  name: string
  namespace: string
  description: string
  version: number
  source: CapabilitySource
  status: CapabilityStatus
  enabled: boolean
  archived?: boolean
  runner: {
    type: RunnerType
    settings: RunnerSettings
  }
  tools: CapabilityTool[]
  createdAt: string
  updatedAt: string
}

export interface AiToolView {
  name: string
  description: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
}

export interface CapabilitySummary {
  id: string
  name: string
  namespace: string
  description: string
  version: number
  runnerType: RunnerType
  status: CapabilityStatus
  enabled: boolean
  archived?: boolean
  toolCount: number
  createdAt: string
  updatedAt: string
}

export interface CapabilityDraftBase {
  id?: string
  name: string
  namespace?: string
  description?: string
  source?: CapabilitySource
}

export interface TerminalCapabilityDraft extends CapabilityDraftBase {
  kind: 'terminal'
  command?: string
  cwd?: string
  shell?: string
}

export interface HttpCapabilityDraft extends CapabilityDraftBase {
  kind: 'http'
  url: string
  method?: HttpRunnerSettings['method']
  timeoutMs?: number
}

export interface McpCapabilityDraft extends CapabilityDraftBase {
  kind: 'mcp'
  transport?: McpRunnerSettings['transport']
  command?: string
  args?: string[]
  url?: string
}

export type CapabilityDraft = TerminalCapabilityDraft | HttpCapabilityDraft | McpCapabilityDraft

export type CapabilityDraftKind = CapabilityDraft['kind']

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/

function issue(path: string, message: string): ValidationIssue {
  return { path, message }
}

function isRunnerType(value: string): value is RunnerType {
  return (RUNNER_TYPES as readonly string[]).includes(value)
}

function isStatus(value: string): value is CapabilityStatus {
  return (CAPABILITY_STATUSES as readonly string[]).includes(value)
}

function isSource(value: string): value is CapabilitySource {
  return (CAPABILITY_SOURCES as readonly string[]).includes(value)
}

/**
 * Validate the shape and invariants of the one canonical Capability definition.
 * This is deliberately dependency-free so the same rule can be used by UI/Core.
 */
export function validateCapabilityDefinition(definition: CapabilityDefinition): ValidationResult {
  const issues: ValidationIssue[] = []

  if (!definition.id || typeof definition.id !== 'string') {
    issues.push(issue('id', 'id is required'))
  }
  if (!definition.name.trim() || definition.name.length > 64 || /\p{Cc}/u.test(definition.name)) {
    issues.push(issue('name', 'name must contain 1 to 64 printable characters'))
  }
  if (!SAFE_NAME.test(definition.namespace)) {
    issues.push(
      issue('namespace', 'namespace must start with a letter and contain only safe characters'),
    )
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    issues.push(issue('version', 'version must be a positive integer'))
  }
  if (!isSource(definition.source)) {
    issues.push(issue('source', 'source is not supported'))
  }
  if (!isStatus(definition.status)) {
    issues.push(issue('status', 'status is not supported'))
  }
  if (!isRunnerType(definition.runner.type)) {
    issues.push(issue('runner.type', 'runner type is not supported'))
  } else if (definition.runner.settings.type !== definition.runner.type) {
    issues.push(issue('runner.settings.type', 'runner settings type must match runner type'))
  }
  if (definition.enabled && definition.status !== 'ready') {
    issues.push(issue('enabled', 'only ready capabilities may be enabled'))
  }
  if (definition.archived !== undefined && typeof definition.archived !== 'boolean') {
    issues.push(issue('archived', 'archived must be a boolean'))
  }
  if (definition.archived && definition.enabled) {
    issues.push(issue('enabled', 'archived capabilities cannot be enabled'))
  }
  if (definition.status === 'draft' && definition.enabled) {
    issues.push(issue('status', 'draft capabilities cannot be enabled'))
  }
  if (definition.status === 'disabled' && definition.enabled) {
    issues.push(issue('status', 'disabled capabilities cannot be enabled'))
  }
  if (!definition.createdAt || !definition.updatedAt) {
    issues.push(issue('timestamps', 'createdAt and updatedAt are required'))
  }
  if (definition.tools.length === 0) {
    issues.push(issue('tools', 'at least one tool is required'))
  }

  const toolNames = new Set<string>()
  definition.tools.forEach((tool, toolIndex) => {
    if (!SAFE_NAME.test(tool.name)) {
      issues.push(issue(`tools[${toolIndex}].name`, 'tool name contains unsupported characters'))
    }
    if (toolNames.has(tool.name)) {
      issues.push(issue(`tools[${toolIndex}].name`, 'tool names must be unique'))
    }
    toolNames.add(tool.name)

    const fieldNames = new Set<string>()
    tool.fields.forEach((field, fieldIndex) => {
      const fieldPath = `tools[${toolIndex}].fields[${fieldIndex}]`
      if (!SAFE_NAME.test(field.key)) {
        issues.push(issue(`${fieldPath}.key`, 'field key contains unsupported characters'))
      }
      if (fieldNames.has(field.key)) {
        issues.push(issue(`${fieldPath}.key`, 'field keys must be unique'))
      }
      fieldNames.add(field.key)
      if (field.aiVisible && field.value !== null) {
        issues.push(issue(`${fieldPath}.value`, 'AI-visible fields cannot carry fixed values'))
      }
      if (field.required && !field.aiVisible) {
        issues.push(
          issue(`${fieldPath}.required`, 'hidden fields cannot be required in the AI schema'),
        )
      }
    })
  })

  return { valid: issues.length === 0, issues }
}

function projectPublicSchema(schema: JsonSchema): JsonSchema {
  const projected: JsonSchema = {}
  const scalarKeys = [
    '$schema',
    '$id',
    'title',
    'description',
    'type',
    'format',
    'pattern',
    'default',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'minProperties',
    'maxProperties',
    'uniqueItems',
  ] as const

  for (const key of scalarKeys) {
    const value = schema[key]
    if (value !== undefined) {
      projected[key] = value as never
    }
  }

  if (schema.enum !== undefined) {
    projected.enum = schema.enum.map((value) => value)
  }
  if (schema.const !== undefined) {
    projected.const = schema.const
  }
  if (schema.items !== undefined) {
    projected.items = projectPublicSchema(schema.items)
  }
  if (schema.properties !== undefined) {
    projected.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      projected.properties[key] = projectPublicSchema(value)
    }
  }
  if (schema.required !== undefined) {
    projected.required = [...schema.required]
  }
  if (schema.additionalProperties !== undefined) {
    projected.additionalProperties =
      typeof schema.additionalProperties === 'boolean'
        ? schema.additionalProperties
        : projectPublicSchema(schema.additionalProperties)
  }
  if (schema.anyOf !== undefined) {
    projected.anyOf = schema.anyOf.map(projectPublicSchema)
  }
  if (schema.oneOf !== undefined) {
    projected.oneOf = schema.oneOf.map(projectPublicSchema)
  }
  if (schema.allOf !== undefined) {
    projected.allOf = schema.allOf.map(projectPublicSchema)
  }

  if (schema.dependentRequired)
    projected.dependentRequired = structuredClone(schema.dependentRequired)
  if (schema.dependentSchemas)
    projected.dependentSchemas = Object.fromEntries(
      Object.entries(schema.dependentSchemas).map(([key, child]) => [
        key,
        projectPublicSchema(child),
      ]),
    )
  for (const key of ['if', 'then', 'else', 'not'] as const)
    if (schema[key]) projected[key] = projectPublicSchema(schema[key])
  return projected
}

/**
 * Project a canonical tool through an allow-list. The full capability is never
 * serialized and then redacted; runner settings, values and bindings are not
 * read while deriving the public view.
 */
export function deriveAiToolView(
  capability: Pick<CapabilityDefinition, 'namespace' | 'description'> &
    Partial<Pick<CapabilityDefinition, 'runner'>>,
  tool: CapabilityTool,
): AiToolView {
  const visibleFields = tool.fields.filter((field) => field.aiVisible)
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const field of visibleFields) {
    properties[field.key] = projectPublicSchema(field.schema)
    if (field.required) {
      required.push(field.key)
    }
  }

  const inputSchema: JsonSchema = {
    // Keep root constraints only when every field is public; private schemas stay internal.
    ...(visibleFields.length === tool.fields.length &&
    visibleFields.every((field) => !field.binding || field.binding.key === field.key) &&
    tool.upstreamInputSchema
      ? projectPublicSchema(tool.upstreamInputSchema)
      : {}),
    type: 'object',
    properties,
    additionalProperties: false,
  }
  if (required.length > 0) {
    inputSchema.required = required
  }

  return {
    name: capability.namespace ? `${capability.namespace}.${tool.name}` : tool.name,
    description: tool.description || capability.description,
    inputSchema,
    outputSchema: projectPublicSchema(
      capability.runner?.settings.type === 'http' &&
        capability.runner.settings.responseFilter !== undefined
        ? responseFilterSchema(capability.runner.settings.responseFilter)
        : tool.outputSchema,
    ),
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function newCapabilityId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID()
  }
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function baseDefinition(draft: CapabilityDraft): Omit<CapabilityDefinition, 'runner' | 'tools'> {
  const timestamp = nowIso()
  return {
    id: draft.id ?? newCapabilityId(),
    name: draft.name,
    namespace: draft.namespace ?? 'local',
    description: draft.description ?? `${draft.name} capability draft`,
    version: 1,
    source: draft.source ?? 'ui',
    status: 'draft',
    enabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const emptyObjectSchema: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

export function createCapabilityDefinition(draft: CapabilityDraft): CapabilityDefinition {
  const base = baseDefinition(draft)

  switch (draft.kind) {
    case 'terminal':
      return {
        ...base,
        runner: {
          type: 'terminal',
          settings: {
            type: 'terminal',
            ...(draft.command !== undefined ? { command: draft.command } : {}),
            cwd: draft.cwd ?? '.',
            shell: draft.shell ?? 'auto',
            environment: {},
          },
        },
        tools: [
          {
            name: 'run',
            description: base.description,
            fields:
              draft.command !== undefined
                ? []
                : [
                    {
                      key: 'command',
                      schema: { type: 'string', minLength: 1 },
                      required: true,
                      aiVisible: true,
                      value: null,
                      binding: { location: 'stdin', key: 'command' },
                    },
                  ],
            outputSchema: {
              type: 'object',
              properties: {
                stdout: { type: 'string' },
                stderr: { type: 'string' },
                exitCode: { type: ['integer', 'null'] },
                truncated: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
        ],
      }
    case 'http':
      return {
        ...base,
        runner: {
          type: 'http',
          settings: {
            type: 'http',
            url: draft.url,
            method: draft.method ?? 'GET',
            timeoutMs: draft.timeoutMs ?? 30_000,
            fixedHeaders: {},
          },
        },
        tools: [
          {
            name: 'request',
            description: base.description,
            fields: [
              {
                key: 'input',
                schema: emptyObjectSchema,
                required: false,
                aiVisible: true,
                value: null,
                binding: { location: 'body', key: 'input' },
              },
            ],
            outputSchema: emptyObjectSchema,
          },
        ],
      }
    case 'mcp':
      return {
        ...base,
        runner: {
          type: 'mcp',
          settings: {
            type: 'mcp',
            transport: draft.transport ?? 'stdio',
            command: draft.command ?? null,
            args: draft.args ?? [],
            url: draft.url ?? null,
            environment: {},
          },
        },
        tools: [
          {
            name: 'call',
            description: base.description,
            fields: [
              {
                key: 'arguments',
                schema: emptyObjectSchema,
                required: false,
                aiVisible: true,
                value: null,
                binding: { location: 'mcpArgument', key: 'arguments' },
              },
            ],
            outputSchema: emptyObjectSchema,
          },
        ],
      }
  }
}

export function toCapabilitySummary(definition: CapabilityDefinition): CapabilitySummary {
  return {
    id: definition.id,
    name: definition.name,
    namespace: definition.namespace,
    description: definition.description,
    version: definition.version,
    runnerType: definition.runner.type,
    status: definition.status,
    enabled: definition.enabled,
    archived: definition.archived ?? false,
    toolCount: definition.tools.length,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}
