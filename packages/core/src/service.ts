// SPDX-License-Identifier: MPL-2.0

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {
  CORE_PROTOCOL_VERSION,
  CORE_VERSION,
  type CapabilityDraftKind,
  type CapabilitySummary,
  type CoreAppStatus,
  type CoreHealth,
  type CoreResponse,
  LOOPBACK_HOST,
  SESSION_TOKEN_HEADER,
  type SidecarReadyHandshake,
  type UiCoreStatus,
} from '@lumiplug/shared'
import { CoreDatabase } from './db/database'
import { CapabilityRegistry } from './capability/registry'
import { CapabilityRepository } from './capability/repository'
import type { CoreRuntimeConfig } from './config'
import { checkMcpConnection, McpGateway } from './mcp/gateway'

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
    'cache-control': 'no-store',
    connection: 'close',
  })
  responseObject.end(serialized)
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > 64 * 1024) {
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
  public readonly database: CoreDatabase
  public readonly repository: CapabilityRepository
  public readonly registry: CapabilityRegistry
  private readonly options: ServiceOptions
  private readonly server: Server
  private readonly mcp: McpGateway
  private actualPort: number | null = null
  private readyAt: string | null = null

  public constructor(options: ServiceOptions) {
    if (options.host !== LOOPBACK_HOST || options.sessionToken.length < 16) {
      throw new Error('invalid_core_launch_configuration')
    }
    this.options = options
    fs.mkdirSync(options.userDataDir, { recursive: true })
    this.database = new CoreDatabase(path.join(options.userDataDir, 'lumiplug.sqlite'))
    this.repository = new CapabilityRepository(this.database.raw)
    this.registry = new CapabilityRegistry(this.repository)
    this.mcp = new McpGateway(this.registry)
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
    this.actualPort = address.port
    this.readyAt = new Date().toISOString()
    const handshake: SidecarReadyHandshake = {
      kind: 'sidecar.ready',
      protocolVersion: CORE_PROTOCOL_VERSION,
      coreVersion: CORE_VERSION,
      port: address.port,
      pid: process.pid,
      mcpAvailable: true,
    }
    this.options.emitReady?.(handshake)
    return handshake
  }

  public async stop(): Promise<void> {
    await this.mcp.close()
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

    if (route.startsWith('/app/') || route === '/events' || route === '/mcp') {
      if (!hostIsLoopback(request.headers.host, this.port)) {
        writeJson(responseObject, 400, failure('invalid_host', 'request host is not allowed'))
        return
      }
      if (!this.originAllowed(request.headers.origin)) {
        writeJson(responseObject, 403, failure('invalid_origin', 'request origin is not allowed'))
        return
      }
      if (!this.tokenMatches(request.headers[SESSION_TOKEN_HEADER], this.options.sessionToken)) {
        writeJson(responseObject, 401, failure('invalid_session', 'session is not authorized'))
        return
      }
      if (route === '/events' && method === 'GET') {
        this.handleEvents(request, responseObject)
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

  private handleEvents(request: IncomingMessage, responseObject: ServerResponse): void {
    responseObject.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    })
    const status: UiCoreStatus = {
      state: 'ready',
      protocolVersion: CORE_PROTOCOL_VERSION,
      coreVersion: CORE_VERSION,
      userDataPathAvailable: fs.existsSync(this.options.userDataDir),
      restartCount: 0,
      lastError: null,
    }
    responseObject.write(
      `event: core.status\ndata: ${JSON.stringify({ type: 'core.status', status })}\n\n`,
    )
    const keepAlive = setInterval(() => {
      responseObject.write(': keep-alive\n\n')
    }, 15_000)
    request.on('close', () => {
      clearInterval(keepAlive)
    })
  }

  private async handleAppRoute(
    route: string,
    method: string,
    request: IncomingMessage,
    responseObject: ServerResponse,
  ): Promise<void> {
    if (route === '/app/mcp/check' && method === 'GET') {
      const result = await checkMcpConnection(
        new URL(`http://${LOOPBACK_HOST}:${this.port}/mcp`),
        this.options.sessionToken,
      )
      writeJson(responseObject, 200, response(result))
      return
    }
    if (route === '/app/status' && method === 'GET') {
      const data: CoreAppStatus = {
        state: 'ready',
        protocolVersion: CORE_PROTOCOL_VERSION,
        coreVersion: CORE_VERSION,
        userDataPathAvailable: fs.existsSync(this.options.userDataDir),
        capabilityCount: this.repository.count(),
      }
      writeJson(responseObject, 200, response(data))
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
  return {
    code: 'core_start_failed',
    message: error instanceof Error ? error.message : 'core_start_failed',
  }
}
