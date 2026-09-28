// SPDX-License-Identifier: MPL-2.0

import type { IncomingMessage, ServerResponse } from 'node:http'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { ProtocolError, Server } from '@modelcontextprotocol/server'
import type { Tool } from '@modelcontextprotocol/server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CORE_VERSION, SESSION_TOKEN_HEADER } from '@lumiplug/shared'
import type { McpConnectionCheck } from '@lumiplug/shared'
import { RegistryError } from '../capability/registry'
import type { CapabilityRegistry } from '../capability/registry'

const SAFE_ERRORS: Record<string, string> = {
  invalid_tool_arguments: '参数不符合公开 Schema，请检查必填字段和参数类型，不要传入内部配置。',
  reserved_tool_namespace: 'lumi 为内置工具保留的命名空间，请选择其他命名空间。',
  capability_draft_invalid: '能力草稿未能保存，请检查名称和命名空间。',
  public_tool_schema_invalid: '工具 Schema 不可用，请让用户检查能力配置。',
  runner_execution_not_implemented_until_m4_m6: '当前版本尚未接入此工具的执行器，操作未执行。',
}

/** Stateless requests read the live Registry; no duplicated tool catalog or database. */
export class McpGateway {
  private readonly activeServers = new Set<Server>()
  private stopping = false

  public constructor(private readonly registry: CapabilityRegistry) {}

  public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Stateless mode has no standalone event stream or protocol session to delete.
    if (request.method !== 'POST') {
      response.writeHead(405, { 'content-type': 'application/json', allow: 'POST' })
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Use POST for stateless MCP requests.' },
        }),
      )
      return
    }
    if (this.stopping || this.activeServers.size >= 128) {
      response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' })
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Lumi is busy. Try again.' },
        }),
      )
      return
    }
    const server = new Server(
      { name: 'Lumi', version: CORE_VERSION },
      {
        capabilities: { tools: { listChanged: false } },
        instructions:
          '连接后先调用 lumi.get_context，确认实际可用功能。使用 lumi.list_capabilities 查看目录。能力变化后重新调用 tools/list。AI 仅能保存草稿，启用由 Lumi 用户完成。',
      },
    )
    server.setRequestHandler('tools/list', async (request) => {
      if (request.params?.cursor !== undefined)
        throw new ProtocolError(-32602, 'This catalog has no pagination cursor.')
      return {
        tools: this.registry.listMcpTools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Tool['inputSchema'],
          ...(tool.outputSchema.type === 'object'
            ? { outputSchema: tool.outputSchema as Tool['outputSchema'] }
            : {}),
          ...(tool.name === 'lumi.get_context' || tool.name === 'lumi.list_capabilities'
            ? { annotations: { readOnlyHint: true, openWorldHint: false } }
            : tool.name === 'lumi.create_capability_draft'
              ? {
                  annotations: {
                    readOnlyHint: false,
                    destructiveHint: false,
                    openWorldHint: false,
                  },
                }
              : {}),
        })),
      }
    })
    server.setRequestHandler('tools/call', async (request) => {
      try {
        const result = await this.registry.invoke(
          request.params.name,
          request.params.arguments ?? {},
        )
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
        }
      } catch (error) {
        if (error instanceof RegistryError && error.code === 'ai_tool_not_found_or_disabled') {
          throw new ProtocolError(-32602, 'Tool is unavailable. Refresh tools/list.')
        }
        const message = error instanceof RegistryError ? SAFE_ERRORS[error.code] : undefined
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: message ?? '工具调用失败，操作未完成。请在 Lumi 中检查配置。',
            },
          ],
        }
      }
    })
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 64 * 1024,
    })
    this.activeServers.add(server)
    const close = (): void => {
      this.activeServers.delete(server)
      void server.close().catch(() => {})
    }
    response.once('close', close)
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response)
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'MCP request failed.' },
          }),
        )
      } else if (!response.writableEnded) {
        response.end()
      }
      close()
    }
  }

  public async close(): Promise<void> {
    this.stopping = true
    await Promise.allSettled([...this.activeServers].map((server) => server.close()))
    this.activeServers.clear()
  }
}

/** Probe the actual wire protocol, rather than treating a Core health check as MCP success. */
export async function checkMcpConnection(
  endpoint: URL,
  token: string,
): Promise<McpConnectionCheck> {
  const client = new Client({ name: 'Lumi connection check', version: CORE_VERSION })
  const options = { signal: AbortSignal.timeout(1200), timeout: 1200 }
  try {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { [SESSION_TOKEN_HEADER]: token }, redirect: 'error' },
      }),
      options,
    )
    const tools = await client.listTools({}, options)
    return {
      ok: true,
      serverName: client.getServerVersion()?.name ?? null,
      serverVersion: client.getServerVersion()?.version ?? null,
      toolCount: tools.tools.length,
      error: null,
    }
  } catch {
    return {
      ok: false,
      serverName: null,
      serverVersion: null,
      toolCount: 0,
      error: 'MCP 握手或工具发现失败，请检查 Lumi 服务并重新复制配置。',
    }
  } finally {
    await client.close().catch(() => {})
  }
}
