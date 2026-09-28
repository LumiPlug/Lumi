// SPDX-License-Identifier: MPL-2.0

import {
  StreamableHTTPClientTransport,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  isJSONRPCErrorResponse,
} from '@modelcontextprotocol/client'
import type { JSONRPCMessage } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { LOOPBACK_HOST, SESSION_TOKEN_HEADER } from '@lumiplug/shared'

export interface ProxyConfig {
  coreUrl: string
  sessionToken: string
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
  return { coreUrl: url.origin, sessionToken }
}

/** Transparent transport bridge: Core alone owns initialization, tools and execution. */
export async function startProxy(config: ProxyConfig): Promise<() => Promise<void>> {
  const stdio = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 64 * 1024,
  })
  const http = new StreamableHTTPClientTransport(new URL(`${config.coreUrl}/mcp`), {
    requestInit: {
      headers: { [SESSION_TOKEN_HEADER]: config.sessionToken },
      redirect: 'error',
    },
  })
  let closed = false
  const controllers = new Set<AbortController>()
  const initializationIds = new Set<string | number>()
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    for (const controller of controllers) controller.abort()
    await Promise.allSettled([http.close(), stdio.close()])
  }
  stdio.onclose = () => {
    void close()
  }
  stdio.onerror = () => {
    process.stderr.write('lumi-mcp: invalid stdio message\n')
  }
  http.onerror = () => {
    process.stderr.write('lumi-mcp: Core transport error\n')
  }
  http.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCResultResponse(message) && initializationIds.delete(message.id)) {
      const protocolVersion = message.result.protocolVersion
      if (typeof protocolVersion === 'string') http.setProtocolVersion(protocolVersion)
    }
    if (isJSONRPCErrorResponse(message) && message.id !== null) initializationIds.delete(message.id)
    if (!closed) void stdio.send(message).catch(() => close())
  }
  stdio.onmessage = (message: JSONRPCMessage) => {
    if (closed) return
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
    if (isJSONRPCRequest(message) && message.method === 'initialize')
      initializationIds.add(message.id)
    const controller = new AbortController()
    controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 30_000)
    // Concurrent requests stay concurrent. Notifications never acquire synthetic IDs.
    void http
      .send(message, { requestSignal: controller.signal })
      .catch(async () => {
        if (closed || !isJSONRPCRequest(message)) return
        initializationIds.delete(message.id)
        await stdio
          .send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message:
                'Lumi Core is unavailable. Check the running app and refresh its connection configuration.',
            },
          })
          .catch(() => close())
      })
      .finally(() => {
        clearTimeout(timer)
        controllers.delete(controller)
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

if (require.main === module) void main()
