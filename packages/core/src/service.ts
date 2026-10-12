// SPDX-License-Identifier: MPL-2.0

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {
  CORE_PROTOCOL_VERSION,
  CORE_VERSION,
  type CapabilityDraftKind,
  type CapabilitySummary,
  type CoreHealth,
  type CoreResponse,
  LOOPBACK_HOST,
  SESSION_TOKEN_HEADER,
  type SidecarReadyHandshake,
} from '@lumiplug/shared'
import { CoreDatabase } from './db/database'
import { CapabilityRegistry } from './capability/registry'
import { CapabilityRepository } from './capability/repository'
import type { CoreRuntimeConfig } from './config'
import { checkMcpConnection, McpGateway } from './mcp/gateway'
import { WorkbenchRepository } from './workbench/repository'
import { RegistryError } from './capability/registry'
import { HOME_ERRORS } from './workbench/errors'
import { HOME_LIMITS } from '@lumiplug/shared'
import type { HomeRpcRequest } from '@lumiplug/shared'
import { HomeRuntimeServer } from './workbench/runtime-server'
import { SkillProjectValidationError, SkillsRepository } from './skills/repository'
import { SkillFileError } from './skills/files'
import { ToolsApi } from './tools/api'
import { TaskManager } from './tools/tasks'
import { McpConnections } from './tools/mcp'
import { ToolError } from './tools/config'
import { TOOL_ERRORS } from '@lumiplug/shared'
import { KnowledgeService, KnowledgeError } from './knowledge/service'

interface ServiceOptions extends CoreRuntimeConfig {
  emitReady?: (handshake: SidecarReadyHandshake) => void
}

interface ErrorPayload {
  code: string
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDraftKind(value: unknown): value is CapabilityDraftKind {
  return value === 'terminal' || value === 'http' || value === 'mcp'
}

function response<T>(data: T): CoreResponse<T> {
  return { ok: true, requestId: randomUUID(), data }
}

function failure(code: string, message: string): CoreResponse<undefined> {
  return { ok: false, requestId: randomUUID(), error: { code, message } }
}

function writeJson(responseObject: ServerResponse, statusCode: number, body: unknown): void {
  const serialized = JSON.stringify(body)
  responseObject.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(serialized),
    'cache-control': 'no-store',
    connection: 'close',
  })
  responseObject.end(serialized)
}

async function readBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > maxBytes) {
      throw new Error('body_too_large')
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) {
    return {}
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('invalid_json')
  }
}

function hostIsLoopback(hostHeader: string | undefined, port: number): boolean {
  const allowed = [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`]
  if (port === 80) allowed.push(LOOPBACK_HOST, 'localhost')
  return allowed.includes(hostHeader?.toLowerCase() ?? '')
}

export class CoreService {
  public readonly knowledge: KnowledgeService
  public readonly database: CoreDatabase
  public readonly repository: CapabilityRepository
  public readonly registry: CapabilityRegistry
  public readonly workbench: WorkbenchRepository
  public readonly skills: SkillsRepository
  public readonly tasks: TaskManager
  public readonly tools: ToolsApi
  private readonly options: ServiceOptions
  private readonly server: Server
  private readonly mcp: McpGateway
  private readonly homeRuntime: HomeRuntimeServer
  private actualPort: number | null = null
  private readyAt: string | null = null
  private sessionToken: string

  public constructor(options: ServiceOptions) {
    if (options.host !== LOOPBACK_HOST || options.sessionToken.length < 16) {
      throw new Error('invalid_core_launch_configuration')
    }
    this.options = options
    this.sessionToken = options.sessionToken
    if (
      options.hostToken &&
      (options.hostToken.length < 32 ||
        options.hostToken === options.sessionToken ||
        /[\r\n]/.test(options.hostToken))
    )
      throw new Error('invalid_host_token')
    fs.mkdirSync(options.userDataDir, { recursive: true })
    this.database = new CoreDatabase(path.join(options.userDataDir, 'lumiplug.sqlite'))
    this.knowledge = new KnowledgeService(this.database.raw)
    this.repository = new CapabilityRepository(this.database.raw)
    this.workbench = new WorkbenchRepository(this.database.raw)
    this.skills = new SkillsRepository(this.database.raw)
    const upstream = new McpConnections((definition) => {
      const current = this.repository.getById(definition.id)
      if (current?.version === definition.version && current.enabled)
        this.repository.saveDraft(current, current.version)
    })
    this.tasks = new TaskManager(this.database.raw, upstream)
    this.registry = new CapabilityRegistry(
      this.repository,
      this.workbench,
      this.tasks,
      this.knowledge,
    )
    this.tools = new ToolsApi(this.repository, this.registry, this.tasks, upstream)
    this.mcp = new McpGateway(this.registry)
    this.homeRuntime = new HomeRuntimeServer(this.workbench)
    this.server = createServer((request, responseObject) => {
      void this.handle(request, responseObject).catch(() => {
        if (!responseObject.headersSent) {
          writeJson(responseObject, 400, failure('invalid_request', 'request is invalid'))
        } else if (!responseObject.writableEnded) {
          responseObject.end()
        }
      })
    })
  }

  public get port(): number {
    return this.actualPort ?? this.options.port
  }

  public async start(): Promise<SidecarReadyHandshake> {
    if (this.actualPort !== null) {
      throw new Error('core_already_started')
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        this.server.off('error', onError)
        resolve()
      }
      this.server.once('error', onError)
      this.server.once('listening', onListening)
      this.server.listen(this.options.port, this.options.host)
    })

    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('core_address_unavailable')
    }
    await this.homeRuntime.start()
    this.actualPort = address.port
    this.readyAt = new Date().toISOString()
    const handshake: SidecarReadyHandshake = {
      kind: 'sidecar.ready',
      protocolVersion: CORE_PROTOCOL_VERSION,
      coreVersion: CORE_VERSION,
      port: address.port,
      pid: process.pid,
    }
    this.options.emitReady?.(handshake)
    return handshake
  }

  public async stop(): Promise<void> {
    await this.knowledge.close()
    await this.tasks.close()
    await this.mcp.close()
    await this.homeRuntime.close()
    if (this.actualPort !== null) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve())
      })
      this.actualPort = null
    }
    this.database.close()
  }

  private async handle(request: IncomingMessage, responseObject: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    const requestUrl = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`)
    const route = requestUrl.pathname

    if (route === '/healthz' && method === 'GET') {
      if (!hostIsLoopback(request.headers.host, this.port)) {
        writeJson(responseObject, 400, failure('invalid_host', 'request host is not allowed'))
        return
      }
      const health: CoreHealth = {
        status: 'ok',
        protocolVersion: CORE_PROTOCOL_VERSION,
        coreVersion: CORE_VERSION,
        pid: process.pid,
        readyAt: this.readyAt ?? new Date().toISOString(),
      }
      writeJson(responseObject, 200, health)
      return
    }

    if (route.startsWith('/app/') || route === '/mcp') {
      if (!hostIsLoopback(request.headers.host, this.port)) {
        writeJson(responseObject, 400, failure('invalid_host', 'request host is not allowed'))
        return
      }
      if (!this.originAllowed(request.headers.origin)) {
        writeJson(responseObject, 403, failure('invalid_origin', 'request origin is not allowed'))
        return
      }
      if (!this.tokenMatches(request.headers[SESSION_TOKEN_HEADER], this.sessionToken)) {
        writeJson(responseObject, 401, failure('invalid_session', 'session is not authorized'))
        return
      }
      if (route === '/mcp') {
        responseObject.setHeader('cache-control', 'no-store')
        await this.mcp.handle(request, responseObject)
        return
      }
      await this.handleAppRoute(route, method, request, responseObject)
      return
    }

    writeJson(responseObject, 404, failure('not_found', 'route not found'))
  }

  private async handleAppRoute(
    route: string,
    method: string,
    request: IncomingMessage,
    responseObject: ServerResponse,
  ): Promise<void> {
    if (route === '/app/mcp/token' && method === 'POST') {
      if (
        !this.options.hostToken ||
        !this.tokenMatches(request.headers['x-lumiplug-host-token'], this.options.hostToken)
      ) {
        writeJson(
          responseObject,
          403,
          failure('mcp_host_required', 'desktop host authorization required'),
        )
        return
      }
      const token = randomBytes(32).toString('hex')
      const temporary = path.join(this.options.userDataDir, `mcp-token-${randomUUID()}.tmp`)
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600)
        try {
          fs.writeFileSync(fd, token)
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
        fs.renameSync(temporary, path.join(this.options.userDataDir, 'mcp-token'))
        this.sessionToken = token
        writeJson(responseObject, 200, response({ sessionToken: token }))
      } catch {
        fs.rmSync(temporary, { force: true })
        writeJson(
          responseObject,
          500,
          failure('mcp_token_settings_save_failed', 'token could not be saved'),
        )
      }
      return
    }
    if (route === '/app/knowledge' && method === 'POST') {
      if (
        !this.options.hostToken ||
        !this.tokenMatches(request.headers['x-lumiplug-host-token'], this.options.hostToken)
      ) {
        writeJson(
          responseObject,
          403,
          failure('knowledge_host_required', '桌面知识库管理仅允许主窗口操作。'),
        )
        return
      }
      try {
        const body = await readBody(request, 50 * 1024 * 1024)
        if (
          !isRecord(body) ||
          typeof body.action !== 'string' ||
          (body.payload != null && !isRecord(body.payload))
        )
          throw new KnowledgeError('knowledge_invalid_arguments')
        writeJson(
          responseObject,
          200,
          response(
            await this.knowledge.hostRequest(
              body.action,
              (body.payload as Record<string, unknown>) ?? {},
            ),
          ),
        )
      } catch (error) {
        const code = error instanceof KnowledgeError ? error.code : 'knowledge_operation_failed'
        writeJson(
          responseObject,
          code === 'knowledge_revision_conflict' ? 409 : 400,
          failure(code, '知识库操作未完成。'),
        )
      }
      return
    }
    if (route === '/app/skills' && method === 'GET') {
      writeJson(responseObject, 200, response(this.skills.inventory()))
      return
    }
    if (route === '/app/skills/scan' && method === 'POST') {
      writeJson(responseObject, 200, response(await this.skills.scan()))
      return
    }
    if ((route === '/app/skills/directory' || route === '/app/skills/file') && method === 'POST') {
      try {
        const body = await readBody(request)
        if (
          !isRecord(body) ||
          typeof body.id !== 'string' ||
          (route === '/app/skills/file' && typeof body.path !== 'string')
        )
          throw new SkillFileError('invalid_skill_file')
        const data =
          route === '/app/skills/directory'
            ? await this.skills.directory(body.id)
            : await this.skills.file(body.id, body.path as string)
        writeJson(responseObject, 200, response(data))
      } catch (error) {
        writeJson(
          responseObject,
          400,
          failure(
            error instanceof SkillFileError ? error.message : 'skill_file_unavailable',
            '技能文件无法读取，请重新扫描后重试。',
          ),
        )
      }
      return
    }
    if (route === '/app/skills/project' && method === 'POST') {
      try {
        const body = await readBody(request)
        if (!isRecord(body) || typeof body.path !== 'string')
          throw new SkillProjectValidationError('invalid_project')
        await this.skills.addProject(body.path)
        writeJson(responseObject, 200, response(await this.skills.scan()))
      } catch (error) {
        const invalid = error instanceof SkillProjectValidationError
        writeJson(
          responseObject,
          invalid ? 400 : 500,
          failure(
            invalid ? 'invalid_skill_project' : 'skill_project_failed',
            invalid ? '项目目录无效或不可读取。' : '项目扫描未完成，请重试。',
          ),
        )
      }
      return
    }
    if (route === '/app/skills/archive' && method === 'POST') {
      try {
        const body = await readBody(request)
        if (!isRecord(body) || typeof body.id !== 'string' || typeof body.archived !== 'boolean')
          throw new Error('invalid_skill')
        writeJson(responseObject, 200, response(this.skills.archive(body.id, body.archived)))
      } catch {
        writeJson(
          responseObject,
          400,
          failure('skill_archive_failed', '归档状态保存失败，请重新扫描后重试。'),
        )
      }
      return
    }
    if (route === '/app/workbench' && method === 'GET') {
      writeJson(responseObject, 200, response(this.homeRuntime.view()))
      return
    }
    const homeActions: Record<string, string> = {
      '/app/workbench/publish': 'Lumi.publish_workbench',
      '/app/workbench/restore': 'Lumi.restore_workbench_version',
      '/app/workbench/export': 'Lumi.export_workbench_project',
    }
    if (route === '/app/workbench/versions' && method === 'GET') {
      writeJson(responseObject, 200, response({ versions: this.workbench.listVersions() }))
      return
    }
    if (homeActions[route] && method === 'POST') {
      try {
        const body = await readBody(
          request,
          route.endsWith('/publish') ? HOME_LIMITS.requestBytes : 64 * 1024,
        )
        if (!isRecord(body)) throw new RegistryError('invalid_tool_arguments')
        const result = await this.registry.invoke(homeActions[route]!, body)
        writeJson(responseObject, 200, response(result))
      } catch (error) {
        const code = error instanceof RegistryError ? error.code : 'invalid_home_bundle'
        writeJson(
          responseObject,
          code === 'workbench_version_conflict' ? 409 : 400,
          failure(code, HOME_ERRORS[code] ?? '主页操作失败，请检查工程包后重试。'),
        )
      }
      return
    }
    if (route === '/app/workbench/rpc' && method === 'POST') {
      try {
        const body = await readBody(request, HOME_LIMITS.rpcBytes)
        if (
          !isRecord(body) ||
          !Number.isSafeInteger(body.version) ||
          typeof body.method !== 'string' ||
          !isRecord(body.args) ||
          Object.keys(body).some((key) => !['version', 'method', 'args'].includes(key))
        )
          throw new Error('invalid_rpc')
        const result = await this.registry.homeRpc(body as unknown as HomeRpcRequest)
        writeJson(responseObject, 200, response(result))
      } catch {
        writeJson(responseObject, 400, failure('invalid_rpc', '页面请求格式无效。'))
      }
      return
    }
    if (route === '/app/mcp/check' && method === 'GET') {
      const result = await checkMcpConnection(
        new URL(`http://${LOOPBACK_HOST}:${this.port}/mcp`),
        this.sessionToken,
        this.mcp.probeToken,
      )
      result.lastExternalActivityAt = this.mcp.lastExternalActivityAt
      writeJson(responseObject, 200, response(result))
      return
    }
    if (route === '/app/tools' && method === 'POST') {
      try {
        const data = await this.tools.request(await readBody(request))
        writeJson(responseObject, 200, response(data))
      } catch (error) {
        const code =
          error instanceof ToolError || error instanceof RegistryError
            ? error.code
            : 'tool_config_invalid'
        writeJson(
          responseObject,
          code === 'tool_version_conflict' ? 409 : 400,
          failure(code, TOOL_ERRORS[code] ?? TOOL_ERRORS.tool_config_invalid!),
        )
      }
      return
    }

    if (route === '/app/capabilities' && method === 'GET') {
      writeJson(responseObject, 200, response({ capabilities: this.registry.listUiCapabilities() }))
      return
    }

    if (route === '/app/capabilities/drafts' && method === 'POST') {
      let body: unknown
      try {
        body = await readBody(request)
      } catch {
        writeJson(responseObject, 400, failure('invalid_request', 'request body is invalid'))
        return
      }
      if (!isRecord(body) || typeof body.name !== 'string' || !isDraftKind(body.kind)) {
        writeJson(
          responseObject,
          400,
          failure('invalid_request', 'draft kind and name are required'),
        )
        return
      }
      const namespace = typeof body.namespace === 'string' ? body.namespace : 'local'
      try {
        const definition =
          body.kind === 'terminal'
            ? this.registry.saveDraft({
                kind: 'terminal',
                name: body.name,
                namespace,
                source: 'ui',
              })
            : body.kind === 'http'
              ? this.registry.saveDraft({
                  kind: 'http',
                  name: body.name,
                  namespace,
                  url: '',
                  source: 'ui',
                })
              : this.registry.saveDraft({
                  kind: 'mcp',
                  name: body.name,
                  namespace,
                  source: 'ui',
                })
        const data: { capability: CapabilitySummary } = {
          capability: this.registry.summary(definition),
        }
        writeJson(responseObject, 201, response(data))
      } catch {
        writeJson(responseObject, 400, failure('invalid_draft', 'draft could not be saved'))
      }
      return
    }

    const capabilityMatch = /^\/app\/capabilities\/([^/]+)\/(enable|disable)$/.exec(route)
    if (capabilityMatch && method === 'POST') {
      const capabilityId = decodeURIComponent(capabilityMatch[1] ?? '')
      try {
        const definition =
          capabilityMatch[2] === 'enable'
            ? this.registry.enable(capabilityId, 'ui')
            : this.registry.disable(capabilityId, 'ui')
        writeJson(responseObject, 200, response({ capability: this.registry.summary(definition) }))
      } catch {
        writeJson(
          responseObject,
          400,
          failure('capability_update_failed', 'capability update failed'),
        )
      }
      return
    }

    writeJson(responseObject, 404, failure('not_found', 'route not found'))
  }

  private originAllowed(origin: string | undefined): boolean {
    if (origin === undefined) {
      return true
    }
    return new Set([
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'http://127.0.0.1:1420',
      'http://localhost:1420',
    ]).has(origin)
  }

  private tokenMatches(value: string | string[] | undefined, expectedToken: string): boolean {
    if (typeof value !== 'string') {
      return false
    }
    const expected = Buffer.from(expectedToken)
    const actual = Buffer.from(value)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
}

export function writeReadyHandshake(handshake: SidecarReadyHandshake): void {
  process.stdout.write(`${JSON.stringify(handshake)}\n`)
}

export function genericErrorPayload(error: unknown): ErrorPayload {
  if (isRecord(error) && error.code === 'EADDRINUSE')
    return { code: 'mcp_port_in_use', message: 'MCP port is already in use.' }
  return {
    code: 'core_start_failed',
    message: error instanceof Error ? error.message : 'core_start_failed',
  }
}
