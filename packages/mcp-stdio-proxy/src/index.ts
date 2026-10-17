// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from 'node:crypto'
import { isSea } from 'node:sea'
import {
  StreamableHTTPClientTransport,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  isJSONRPCErrorResponse,
} from '@modelcontextprotocol/client'
import type { JSONRPCMessage } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { LOOPBACK_HOST, SESSION_TOKEN_HEADER } from '@lumiplug/shared'

import type { Readable, Writable } from 'node:stream'

export const DEFAULT_REQUEST_TIMEOUT_MS = 310_000
export interface ProxyConfig {
  coreUrl: string
  sessionToken: string
  requestTimeoutMs: number
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

export function parseConfig(
  args = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): ProxyConfig {
  const rawUrl = argumentValue(args, '--core-url') ?? environment.LUMIPLUG_CORE_URL
  const sessionToken = argumentValue(args, '--session-token') ?? environment.LUMIPLUG_SESSION_TOKEN
  if (!rawUrl || !sessionToken || sessionToken.length < 16 || /[\r\n]/.test(sessionToken)) {
    throw new Error('proxy_configuration_missing')
  }
  const url = new URL(rawUrl)
  // The credential must never be forwarded to a remote URL or an HTTP redirect.
  if (
    url.protocol !== 'http:' ||
    url.hostname !== LOOPBACK_HOST ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('proxy_requires_loopback_url')
  }
  const timeout =
    argumentValue(args, '--request-timeout-ms') ?? environment.LUMIPLUG_REQUEST_TIMEOUT_MS
  const requestTimeoutMs = timeout === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : Number(timeout)
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 3600000)
    throw new Error('proxy_invalid_request_timeout')
  return { coreUrl: url.origin, sessionToken, requestTimeoutMs }
}

/** Transparent transport bridge: Core alone owns initialization, tools and execution. */
export async function startProxy(
  config: ProxyConfig,
  streams: { stdin: Readable; stdout: Writable; stderr: Writable } = process,
): Promise<() => Promise<void>> {
  const stdio = new StdioServerTransport(streams.stdin, streams.stdout, {
    maxBufferSize: 24 * 1024 * 1024,
  })
  const http = new StreamableHTTPClientTransport(new URL(`${config.coreUrl}/mcp`), {
    requestInit: {
      headers: { [SESSION_TOKEN_HEADER]: config.sessionToken },
      redirect: 'error',
    },
  })
  let closed = false
  const controllers = new Set<AbortController>()
  const requestControllers = new Map<string | number, AbortController>()
  const initializationIds = new Set<string | number>()
  const wireIds = new Map<string | number, string>()
  const clientIds = new Map<string, string | number>()
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    for (const controller of controllers) controller.abort('cancelled')
    await Promise.allSettled([http.close(), stdio.close()])
  }
  stdio.onclose = () => {
    void close()
  }
  stdio.onerror = () => {
    streams.stderr.write('lumi-mcp: invalid stdio message\n')
  }
  http.onerror = () => {
    streams.stderr.write('lumi-mcp: Core transport error\n')
  }
  http.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCResultResponse(message) && initializationIds.delete(message.id)) {
      const protocolVersion = message.result.protocolVersion
      if (typeof protocolVersion === 'string') http.setProtocolVersion(protocolVersion)
    }
    if (isJSONRPCErrorResponse(message) && message.id !== null && message.id !== undefined)
      initializationIds.delete(message.id)
    let forwarded = message
    if (
      (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) &&
      typeof message.id === 'string'
    ) {
      const clientId = clientIds.get(message.id)
      if (clientId !== undefined) forwarded = { ...message, id: clientId }
    }
    if (!closed) void stdio.send(forwarded).catch(() => close())
  }
  stdio.onmessage = (message: JSONRPCMessage) => {
    if (closed) return
    let forwarded = message
    if ('method' in message && message.method === 'notifications/cancelled') {
      const id = message.params?.requestId
      if (typeof id === 'string' || typeof id === 'number')
        requestControllers.get(id)?.abort('cancelled')
      const wireId = typeof id === 'string' || typeof id === 'number' ? wireIds.get(id) : undefined
      // Unknown or completed IDs must never be forwarded to another client's call.
      if (!wireId) return
      forwarded = { ...message, params: { ...message.params, requestId: wireId } }
    }
    if (controllers.size >= 128) {
      if (isJSONRPCRequest(message)) {
        void stdio
          .send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: 'Lumi proxy is busy. Try again.' },
          })
          .catch(() => close())
      }
      return
    }
    if (isJSONRPCRequest(message)) {
      if (wireIds.has(message.id)) return
      const wireId = randomUUID()
      wireIds.set(message.id, wireId)
      clientIds.set(wireId, message.id)
      forwarded = { ...message, id: wireId }
      if (message.method === 'initialize') initializationIds.add(wireId)
    }
    const controller = new AbortController()
    controllers.add(controller)
    if (isJSONRPCRequest(message)) requestControllers.set(message.id, controller)
    const timer = setTimeout(() => controller.abort('timeout'), config.requestTimeoutMs)
    // Concurrent requests stay concurrent. Notifications never acquire synthetic IDs.
    void http
      .send(forwarded, { requestSignal: controller.signal })
      .catch(async () => {
        if (closed || controller.signal.reason === 'cancelled' || !isJSONRPCRequest(message)) return
        initializationIds.delete(message.id)
        await stdio
          .send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message:
                controller.signal.reason === 'timeout'
                  ? 'Lumi MCP request timed out. Check task status before retrying; execution may have started.'
                  : 'Lumi Core connection failed. Check the running app and its connection configuration.',
              data: {
                reason:
                  controller.signal.reason === 'timeout' ? 'request_timeout' : 'connection_failed',
              },
            },
          })
          .catch(() => close())
      })
      .finally(() => {
        clearTimeout(timer)
        controllers.delete(controller)
        if (isJSONRPCRequest(message) && requestControllers.get(message.id) === controller) {
          requestControllers.delete(message.id)
          const wireId = wireIds.get(message.id)
          if (wireId) {
            clientIds.delete(wireId)
            initializationIds.delete(wireId)
          }
          wireIds.delete(message.id)
        }
      })
  }
  await http.start()
  await stdio.start()
  return close
}

async function main(): Promise<void> {
  try {
    const close = await startProxy(parseConfig())
    process.once('SIGINT', () => {
      void close()
    })
    process.once('SIGTERM', () => {
      void close()
    })
  } catch {
    process.stderr.write('lumi-mcp: unable to start; check the local connection configuration\n')
    process.exitCode = 1
  }
}

if (isSea() || require.main === module) void main()
