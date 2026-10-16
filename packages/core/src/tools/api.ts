// SPDX-License-Identifier: MPL-2.0
import type { CapabilityDefinition, JsonObject, ToolRunOverrides } from '@lumiplug/shared'
import { deriveAiToolView } from '@lumiplug/shared'
import type { CapabilityRepository } from '../capability/repository'
import type { CapabilityRegistry } from '../capability/registry'
import type { TaskManager } from './tasks'
import type { McpConnections } from './mcp'
import { ToolError, record, parseDefinition, checkExecutable } from './config'
export class ToolsApi {
  constructor(
    private readonly repository: CapabilityRepository,
    private readonly registry: CapabilityRegistry,
    private readonly tasks: TaskManager,
    private readonly mcp: McpConnections,
  ) {}
  async request(body: unknown): Promise<unknown> {
    if (!record(body) || typeof body.action !== 'string')
      throw new ToolError('tool_request_invalid')
    const p = record(body.payload) ? body.payload : {}
    const id = typeof p.id === 'string' ? p.id : ''
    if (body.action === 'list') return this.registry.listUiCapabilities()
    if (body.action === 'tasks') return this.tasks.metadata(id || undefined)
    if (body.action === 'task') return this.tasks.get(id)
    if (body.action === 'snapshot') return this.tasks.snapshot(id)
    if (body.action === 'stop') return this.tasks.stop(id)
    if (body.action === 'restart') return this.registry.restartTask(id, 'manual')
    if (body.action === 'get') {
      const def = this.repository.getById(id)
      if (!def) throw new ToolError('capability_not_found')
      return def
    }
    if (body.action === 'save') {
      const def = parseDefinition(p.definition)
      const old = this.repository.getById(def.id)
      const expected = p.expectedVersion
      if (!Number.isInteger(expected) || (old?.version ?? 0) !== expected)
        throw new ToolError('tool_version_conflict')
      if (def.namespace === 'Lumi') throw new ToolError('reserved_tool_namespace')
      const next: CapabilityDefinition = {
        ...def,
        source: old?.source ?? 'ui',
        status: 'draft',
        enabled: false,
      }
      return this.repository.saveDraft(next, expected as number)
    }
    if (body.action === 'check') {
      const def = parseDefinition(p.definition)
      checkExecutable(def)
      return { valid: true, preview: def.tools.map((t) => deriveAiToolView(def, t)) }
    }
    if (body.action === 'discover') {
      const def = parseDefinition(p.definition)
      const tools = await this.mcp.discover(def)
      return parseDefinition({ ...def, tools }).tools
    }
    if (['enable', 'disable', 'archive', 'restore'].includes(body.action)) {
      const current = this.repository.getById(id)
      if (!current) throw new ToolError('capability_not_found')
      if (current.version !== p.expectedVersion || current.updatedAt !== p.expectedUpdatedAt)
        throw new ToolError('tool_version_conflict')
      if (body.action === 'archive' || body.action === 'restore')
        return this.repository.setArchived(id, body.action === 'archive')
      return body.action === 'enable'
        ? this.registry.enable(id, 'ui')
        : this.registry.disable(id, 'ui')
    }
    if (body.action === 'prepare' || body.action === 'run') {
      if (typeof p.name !== 'string' || !record(p.arguments))
        throw new ToolError('tool_request_invalid')
      if (body.action === 'prepare')
        return this.registry.prepareTask(
          p.name,
          p.arguments as JsonObject,
          typeof p.expectedVersion === 'number' ? p.expectedVersion : undefined,
          p.overrides as ToolRunOverrides | undefined,
        )
      return this.registry.startTask(
        p.name,
        p.arguments,
        'manual',
        p.overrides as ToolRunOverrides | undefined,
        typeof p.expectedVersion === 'number' ? p.expectedVersion : undefined,
      )
    }
    throw new ToolError('tool_request_invalid')
  }
}
