// SPDX-License-Identifier: MPL-2.0

import { createCapabilityDefinition, deriveAiToolView, toCapabilitySummary } from '@lumiplug/shared'
import type {
  AiToolView,
  CapabilityDefinition,
  CapabilityDraft,
  CapabilitySummary,
  JsonObject,
} from '@lumiplug/shared'
import Ajv from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import type { CapabilityRepository } from './repository'
import { BUILTIN_TOOLS, publicCapability, publicContext } from './builtin-tools'

export class RegistryError extends Error {
  public readonly code: string

  public constructor(code: string) {
    super(code)
    this.name = 'RegistryError'
    this.code = code
  }
}

export class CapabilityRegistry {
  private readonly validator = new Ajv({ strict: false, allErrors: false, validateFormats: false })
  private readonly validators = new Map<string, ValidateFunction>()
  public constructor(private readonly repository: CapabilityRepository) {}

  public listUiCapabilities(): CapabilitySummary[] {
    return this.repository.listSummaries()
  }

  public listAiTools(): AiToolView[] {
    return this.repository
      .listEnabled()
      .flatMap((definition) => definition.tools.map((tool) => deriveAiToolView(definition, tool)))
  }

  public listMcpTools(): AiToolView[] {
    return [...BUILTIN_TOOLS, ...this.listAiTools()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
  }

  public getAiTool(name: string): AiToolView | null {
    for (const definition of this.repository.listEnabled()) {
      for (const tool of definition.tools) {
        const view = deriveAiToolView(definition, tool)
        if (view.name === name) {
          return view
        }
      }
    }
    return null
  }

  /** Internal-only resolution. Callers must never serialize this result to AI. */
  public resolveForExecution(name: string): CapabilityDefinition {
    for (const definition of this.repository.listEnabled()) {
      if (definition.tools.some((tool) => deriveAiToolView(definition, tool).name === name)) {
        return definition
      }
    }
    throw new RegistryError('ai_tool_not_found_or_disabled')
  }

  public saveDraft(draft: CapabilityDraft): CapabilityDefinition {
    return this.repository.saveDraft(createCapabilityDefinition(draft))
  }

  public validateDraft(id: string): ReturnType<CapabilityRepository['validateDraft']> {
    return this.repository.validateDraft(id)
  }

  public enable(id: string, actor: 'ui'): CapabilityDefinition {
    const candidate = this.repository.getById(id)
    if (!candidate) throw new RegistryError('capability_not_found')
    if (candidate.namespace === 'lumi') throw new RegistryError('reserved_tool_namespace')
    const occupied = new Set(
      this.repository
        .listEnabled()
        .filter((item) => item.id !== id)
        .flatMap((item) => item.tools.map((tool) => deriveAiToolView(item, tool).name)),
    )
    for (const tool of candidate.tools) {
      const name = deriveAiToolView(candidate, tool).name
      if (name.length > 128) throw new RegistryError('public_tool_name_too_long')
      if (occupied.has(name)) throw new RegistryError('public_tool_name_conflict')
    }
    return this.repository.enable(id, actor)
  }

  public disable(id: string, actor: 'ui'): CapabilityDefinition {
    return this.repository.disable(id, actor)
  }

  /** MCP and future Workbench callers share this validated dispatch boundary. */
  public async invoke(name: string, argumentsObject: Record<string, unknown>): Promise<JsonObject> {
    const builtin = BUILTIN_TOOLS.find((tool) => tool.name === name)
    const view = builtin ?? this.getAiTool(name)
    if (!view) throw new RegistryError('ai_tool_not_found_or_disabled')
    this.validateArguments(view, argumentsObject)

    if (name === 'lumi.get_context') return publicContext()
    if (name === 'lumi.list_capabilities') {
      return { capabilities: this.repository.listAll().map(publicCapability) }
    }
    if (name === 'lumi.create_capability_draft') {
      if (argumentsObject.namespace === 'lumi') throw new RegistryError('reserved_tool_namespace')
      const base = {
        name: argumentsObject.name as string,
        namespace: (argumentsObject.namespace as string | undefined) ?? 'local',
        description: argumentsObject.description as string | undefined,
        source: 'ai' as const,
      }
      try {
        const definition =
          argumentsObject.kind === 'http'
            ? this.saveDraft({ ...base, kind: 'http', url: '' })
            : argumentsObject.kind === 'terminal'
              ? this.saveDraft({ ...base, kind: 'terminal' })
              : this.saveDraft({ ...base, kind: 'mcp' })
        return { capability: publicCapability(definition) }
      } catch {
        throw new RegistryError('capability_draft_invalid')
      }
    }

    this.resolveForExecution(name)
    throw new RegistryError('runner_execution_not_implemented_until_m4_m6')
  }

  private validateArguments(tool: AiToolView, argumentsObject: Record<string, unknown>): void {
    const key = JSON.stringify(tool.inputSchema)
    let validate = this.validators.get(key)
    if (!validate) {
      try {
        validate = this.validator.compile(tool.inputSchema)
      } catch {
        throw new RegistryError('public_tool_schema_invalid')
      }
      if (this.validators.size >= 128) {
        const oldest = this.validators.keys().next().value
        if (oldest !== undefined) {
          this.validator.removeSchema(this.validators.get(oldest)?.schema)
          this.validators.delete(oldest)
        }
      }
      this.validators.set(key, validate)
    }
    // Never serialize validator errors: they can echo private field names/values.
    if (!validate(argumentsObject)) throw new RegistryError('invalid_tool_arguments')
  }

  public summary(definition: CapabilityDefinition): CapabilitySummary {
    return toCapabilitySummary(definition)
  }
}
