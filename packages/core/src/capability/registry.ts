// SPDX-License-Identifier: MPL-2.0

import {
  createCapabilityDefinition,
  deriveAiToolView,
  toCapabilitySummary,
  HOME_PAGE_BUILTINS,
  TOOL_ERRORS,
} from '@lumiplug/shared'
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
import { KNOWLEDGE_TOOLS } from '@lumiplug/shared'
import { KnowledgeError, type KnowledgeService } from '../knowledge/service'
import { WorkbenchError } from '../workbench/repository'
import type { WorkbenchRepository } from '../workbench/repository'
import { homeTemplate, homeSourceForExport, exportHomeProject } from '../workbench/template'
import { HOME_ERRORS } from '../workbench/errors'
import type { HomeRpcRequest, HomeRpcResponse, JsonValue } from '@lumiplug/shared'
import type { TaskSource, ToolTask, ToolRunOverrides } from '@lumiplug/shared'
import type { TaskManager } from '../tools/tasks'
import { prepareRunArguments } from '../tools/run-parameters'
import type { SkillsRepository } from '../skills/repository'
import { SKILL_TOOLS } from '../skills/tools'
import { SkillFileError } from '../skills/files'
import {
  checkExecutable,
  parseDefinition,
  record,
  ToolError,
  validateMcpArguments,
} from '../tools/config'

export class RegistryError extends Error {
  public readonly code: string

  public constructor(code: string) {
    super(code)
    this.name = 'RegistryError'
    this.code = code
  }
}

export class CapabilityRegistry {
  private readonly validator = new Ajv({
    strict: false,
    allErrors: false,
    validateFormats: false,
    useDefaults: true,
  })
  private readonly validators = new Map<string, ValidateFunction>()
  public constructor(
    private readonly repository: CapabilityRepository,
    private readonly workbench?: WorkbenchRepository,
    private readonly tasks?: TaskManager,
    private readonly knowledge?: KnowledgeService,
    private readonly skills?: SkillsRepository,
  ) {}

  public listUiCapabilities(): CapabilitySummary[] {
    return this.repository.listSummaries()
  }

  public listAiTools(): AiToolView[] {
    return this.repository
      .listEnabled()
      .flatMap((definition) => definition.tools.map((tool) => deriveAiToolView(definition, tool)))
  }

  public listMcpTools(): AiToolView[] {
    return [
      ...BUILTIN_TOOLS,
      ...(this.knowledge ? KNOWLEDGE_TOOLS : []),
      ...(this.skills ? SKILL_TOOLS : []),
      ...this.listAiTools(),
    ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
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

  public enable(id: string, actor: 'ui'): CapabilityDefinition {
    const candidate = this.repository.getById(id)
    if (!candidate) throw new RegistryError('capability_not_found')
    if (candidate.archived) throw new RegistryError('tool_archived')
    if (candidate.namespace === 'Lumi') throw new RegistryError('reserved_tool_namespace')
    if (this.tasks) checkExecutable(candidate)
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
  public async invoke(
    name: string,
    argumentsObject: Record<string, unknown>,
    source: TaskSource = 'ai',
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    const builtin = [
      ...BUILTIN_TOOLS,
      ...(this.knowledge ? KNOWLEDGE_TOOLS : []),
      ...(this.skills ? SKILL_TOOLS : []),
    ].find((tool) => tool.name === name)
    const view = builtin ?? this.getAiTool(name)
    if (!view) throw new RegistryError('ai_tool_not_found_or_disabled')
    this.validateArguments(view, argumentsObject)

    if (name === 'Lumi.list_tasks')
      return {
        tasks: JSON.parse(
          JSON.stringify(
            this.tasks?.metadata(
              typeof argumentsObject.capabilityId === 'string'
                ? argumentsObject.capabilityId
                : undefined,
            ) ?? [],
          ),
        ) as JsonValue,
      }
    if (name === 'Lumi.get_task' || name === 'Lumi.stop_task' || name === 'Lumi.restart_task') {
      if (!this.tasks) throw new RegistryError('task_not_found')
      const id = argumentsObject.id as string
      const task =
        name === 'Lumi.stop_task'
          ? this.tasks.stop(id)
          : name === 'Lumi.restart_task'
            ? this.restartTask(id, source)
            : this.tasks.get(id)
      return { task: JSON.parse(JSON.stringify(task)) as JsonValue }
    }

    if (name.startsWith('Lumi.knowledge_') && this.knowledge) {
      try {
        return JSON.parse(
          JSON.stringify(await this.knowledge.invoke(name, argumentsObject)),
        ) as JsonObject
      } catch (error) {
        throw new RegistryError(
          error instanceof KnowledgeError ? error.code : 'knowledge_operation_failed',
        )
      }
    }
    if (this.skills && SKILL_TOOLS.some((tool) => tool.name === name)) {
      try {
        const result =
          name === 'Lumi.search_skills'
            ? await this.skills.searchSkills(
                argumentsObject.query as string | undefined,
                argumentsObject.offset as number | undefined,
                argumentsObject.limit as number | undefined,
              )
            : name === 'Lumi.get_skill'
              ? await this.skills.getSkill(argumentsObject.id as string)
              : await this.skills.readManagedFile(
                  argumentsObject.id as string,
                  argumentsObject.path as string,
                )
        return JSON.parse(JSON.stringify(result)) as JsonObject
      } catch (error) {
        throw new RegistryError(
          error instanceof SkillFileError ? error.message : 'skill_file_unavailable',
        )
      }
    }
    if (name === 'Lumi.get_context')
      return publicContext(Boolean(this.knowledge), Boolean(this.skills))
    if (name === 'Lumi.get_workbench_template') return homeTemplate()
    if (
      [
        'Lumi.get_workbench',
        'Lumi.publish_workbench',
        'Lumi.list_workbench_versions',
        'Lumi.restore_workbench_version',
        'Lumi.export_workbench_project',
      ].includes(name)
    ) {
      if (!this.workbench) throw new RegistryError('workbench_unavailable')
      try {
        if (name === 'Lumi.get_workbench') {
          const current = this.workbench.get(argumentsObject.version as number | undefined)
          if (argumentsObject.version !== undefined && !current.bundle)
            throw new WorkbenchError('workbench_version_missing')
          return {
            version: current.version,
            updatedAt: current.updatedAt,
            manifest: current.bundle?.manifest ?? null,
            sourceFiles: current.bundle?.sourceFiles ?? [],
            ...(argumentsObject.includeBundle ? { bundle: current.bundle } : {}),
          }
        }
        if (name === 'Lumi.publish_workbench') {
          const next = this.workbench.publish(
            argumentsObject.expectedVersion as number,
            argumentsObject.bundle,
          )
          return {
            version: next.version,
            updatedAt: next.updatedAt,
            manifest: next.bundle!.manifest,
          }
        }
        if (name === 'Lumi.restore_workbench_version') {
          const next = this.workbench.restore(
            argumentsObject.expectedVersion as number,
            argumentsObject.version as number,
          )
          return {
            version: next.version,
            updatedAt: next.updatedAt,
            manifest: next.bundle!.manifest,
          }
        }
        if (name === 'Lumi.list_workbench_versions')
          return { versions: this.workbench.listVersions() }
        const current = this.workbench.get(argumentsObject.version as number | undefined)
        if (argumentsObject.version !== undefined && !current.bundle)
          throw new WorkbenchError('workbench_version_missing')
        return exportHomeProject(
          argumentsObject.directory as string,
          homeSourceForExport(current.bundle),
        )
      } catch (error) {
        if (error instanceof WorkbenchError) throw new RegistryError(error.code)
        throw error
      }
    }
    if (name === 'Lumi.list_capabilities') {
      return { capabilities: this.repository.listAll().map(publicCapability) }
    }
    if (name === 'Lumi.create_capability_draft') {
      if (argumentsObject.namespace === 'Lumi') throw new RegistryError('reserved_tool_namespace')
      if (
        argumentsObject.kind !== 'terminal' &&
        (argumentsObject.command !== undefined || argumentsObject.cwd !== undefined)
      )
        throw new RegistryError('capability_draft_invalid')
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
              ? this.saveDraft({
                  ...base,
                  kind: 'terminal',
                  command: argumentsObject.command as string | undefined,
                  cwd: (argumentsObject.cwd as string | undefined) ?? '',
                })
              : this.saveDraft({ ...base, kind: 'mcp' })
        return { capability: publicCapability(definition) }
      } catch {
        throw new RegistryError('capability_draft_invalid')
      }
    }

    if (!this.tasks) throw new RegistryError('runner_execution_not_implemented_until_m4_m6')
    signal?.throwIfAborted()
    const task = this.startTask(name, argumentsObject, source)
    if (task.runnerType === 'terminal' && name.endsWith('.start'))
      return { taskId: task.id, status: task.status }
    const cancel = () => this.tasks!.stop(task.id)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    let finished: ToolTask
    try {
      finished = await this.tasks.wait(task.id)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    if (finished.status !== 'completed')
      throw new RegistryError(finished.error ?? 'tool_execution_failed')
    return finished.result && typeof finished.result === 'object' && !Array.isArray(finished.result)
      ? (finished.result as JsonObject)
      : { result: finished.result }
  }

  private runDefinition(name: string, overrides?: ToolRunOverrides, expectedVersion?: number) {
    const original = this.resolveForExecution(name)
    if (expectedVersion !== undefined && original.version !== expectedVersion)
      throw new RegistryError('tool_version_conflict')
    if (!overrides) return original
    if (
      !record(overrides) ||
      !record(overrides.settings) ||
      !record(overrides.fixedParameters) ||
      overrides.settings.type !== original.runner.type
    )
      throw new ToolError('tool_request_invalid')
    const selected = original.tools.find((t) => deriveAiToolView(original, t).name === name)!
    if (
      Object.keys(overrides.fixedParameters).some(
        (key) => !selected.fields.some((f) => !f.aiVisible && f.key === key),
      )
    )
      throw new ToolError('invalid_tool_arguments')
    return parseDefinition({
      ...original,
      runner: { ...original.runner, settings: overrides.settings },
      tools: original.tools.map((tool) =>
        tool === selected
          ? {
              ...tool,
              fields: tool.fields.map((field) =>
                !field.aiVisible && Object.hasOwn(overrides.fixedParameters, field.key)
                  ? { ...field, value: overrides.fixedParameters[field.key] }
                  : field,
              ),
            }
          : tool,
      ),
    })
  }

  public startTask(
    name: string,
    args: Record<string, unknown>,
    source: TaskSource,
    overrides?: ToolRunOverrides,
    expectedVersion?: number,
  ): ToolTask {
    if (!this.tasks) throw new RegistryError('runner_execution_not_implemented_until_m4_m6')
    if (overrides && source !== 'manual') throw new ToolError('tool_request_invalid')
    const def = this.runDefinition(name, overrides, expectedVersion)
    checkExecutable(def)
    const tool = def.tools.find((t) => deriveAiToolView(def, t).name === name)!
    this.validateArguments(deriveAiToolView(def, tool), args)
    if (def.runner.type === 'mcp' && !validateMcpArguments(tool, args as JsonObject))
      throw new ToolError('invalid_tool_arguments')
    return this.tasks.start(
      def,
      tool,
      args as JsonObject,
      source,
      overrides,
      !!overrides &&
        JSON.stringify(overrides.settings) !==
          JSON.stringify(this.resolveForExecution(name).runner.settings),
    )
  }

  public restartTask(id: string, source: TaskSource): ToolTask {
    if (!this.tasks) throw new ToolError('task_not_found')
    const input = this.tasks.restartInput(id)
    const def = this.resolveForExecution(input.name)
    if (def.version !== input.version) throw new ToolError('task_restart_unavailable')
    return this.startTask(input.name, input.args, source, input.overrides, input.version)
  }

  public prepareTask(
    name: string,
    args: JsonObject,
    expectedVersion?: number,
    overrides?: ToolRunOverrides,
  ) {
    const def = this.runDefinition(name, overrides, expectedVersion)
    const selected = def.tools.find((t) => deriveAiToolView(def, t).name === name)!
    for (const field of selected.fields.filter((f) => !f.aiVisible)) {
      if (field.value === null || !this.validator.compile(field.schema)(field.value))
        return {
          ok: false as const,
          key: field.key,
          message: '参数不符合工具要求，请检查格式和取值。',
          requiredInputs: selected.fields
            .filter((f) => f.aiVisible && f.required && f.schema.default === undefined)
            .map((f) => f.key),
        }
    }
    try {
      checkExecutable(def)
    } catch (error) {
      if (!(error instanceof ToolError)) throw error
      return {
        ok: false as const,
        key: error.key,
        message: TOOL_ERRORS[error.code] ?? '配置不符合工具要求，请检查填写内容。',
        requiredInputs: selected.fields
          .filter((f) => f.aiVisible && f.required && f.schema.default === undefined)
          .map((f) => f.key),
      }
    }
    const tool = def.tools.find((t) => deriveAiToolView(def, t).name === name)!
    return prepareRunArguments(def, tool, args)
  }

  public async homeRpc(request: HomeRpcRequest): Promise<HomeRpcResponse> {
    try {
      if (!this.workbench) throw new RegistryError('workbench_unavailable')
      const current = this.workbench.get()
      if (!current.bundle || current.version !== request.version)
        throw new RegistryError('workbench_instance_expired')
      const args = request.args
      let data: JsonValue
      if (request.method === 'context.get') data = publicContext()
      else if (request.method === 'capabilities.list')
        data = this.repository.listAll().map(publicCapability)
      else if (request.method === 'tools.list')
        data = JSON.parse(
          JSON.stringify(
            this.listMcpTools().filter(
              (tool) =>
                !tool.name.startsWith('Lumi.') ||
                (HOME_PAGE_BUILTINS as readonly string[]).includes(tool.name),
            ),
          ),
        ) as JsonValue
      else if (request.method === 'tools.call') {
        if (
          typeof args.name !== 'string' ||
          (args.name.startsWith('Lumi.') &&
            !(HOME_PAGE_BUILTINS as readonly string[]).includes(args.name))
        )
          throw new RegistryError('method_unavailable')
        if (!args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments))
          throw new RegistryError('invalid_tool_arguments')
        data = await this.invoke(args.name, args.arguments, 'workbench')
      } else if (['storage.get', 'storage.set', 'storage.delete'].includes(request.method)) {
        data = this.workbench.state(
          current.bundle.manifest.projectId,
          request.method.slice(8),
          args.key,
          args.value,
        )
      } else throw new RegistryError('method_unavailable')
      return { ok: true, data }
    } catch (error) {
      const code =
        error instanceof RegistryError || error instanceof WorkbenchError
          ? error.code
          : 'home_request_failed'
      return {
        ok: false,
        error: { code, message: HOME_ERRORS[code] ?? '页面请求失败，请检查 Lumi 服务后重试。' },
      }
    }
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
