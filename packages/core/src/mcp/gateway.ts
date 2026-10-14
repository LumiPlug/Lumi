// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { ProtocolError, Server } from '@modelcontextprotocol/server'
import type { Tool } from '@modelcontextprotocol/server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CORE_VERSION, SESSION_TOKEN_HEADER } from '@lumiplug/shared'
import type { McpConnectionCheck } from '@lumiplug/shared'
import { RegistryError } from '../capability/registry'
import type { CapabilityRegistry } from '../capability/registry'

import { HOME_ERRORS } from '../workbench/errors'
import { HOME_LIMITS } from '@lumiplug/shared'
import { TOOL_ERRORS } from '@lumiplug/shared'
import { ToolError } from '../tools/config'
import { SKILL_ERRORS } from '../skills/managed'
import { SKILL_TOOLS } from '../skills/tools'

/** Stateless requests read the live Registry; no duplicated tool catalog or database. */
export class McpGateway {
  private readonly activeServers = new Set<Server>()
  private readonly activeCalls = new Map<string | number, Set<AbortController>>()
  private stopping = false
  public readonly probeToken = randomUUID()
  public lastExternalActivityAt: string | null = null

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
    const recordExternalActivity = (): void => {
      if (request.headers['x-lumi-connection-probe'] === this.probeToken) return
      response.once('finish', () => {
        if (response.statusCode === 200) this.lastExternalActivityAt = new Date().toISOString()
      })
    }
    const server = new Server(
      { name: 'Lumi', version: CORE_VERSION },
      {
        capabilities: { tools: { listChanged: false } },
        instructions:
          '连接后先调用 Lumi.get_context，确认实际可用功能。任务开始时用 Lumi.search_skills 查找相关技能，用 Lumi.get_skill 加载说明、Lumi.read_skill_file 按需读取附件，脚本只读不执行。使用 Lumi.list_capabilities 查看工具目录。开发主页时读取 Lumi.get_workbench 的源码、开发模板与版本，构建后通过 Lumi.publish_workbench 保存。能力变化后重新调用 tools/list。AI 仅能保存能力草稿，启用由 Lumi 用户完成。',
      },
    )
    server.setRequestHandler('tools/list', async (request) => {
      if (request.params?.cursor !== undefined)
        throw new ProtocolError(-32602, 'This catalog has no pagination cursor.')
      recordExternalActivity()
      return {
        tools: this.registry.listMcpTools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Tool['inputSchema'],
          ...(tool.outputSchema.type === 'object'
            ? { outputSchema: tool.outputSchema as Tool['outputSchema'] }
            : {}),
          ...([
            'Lumi.get_context',
            'Lumi.list_capabilities',
            'Lumi.get_workbench',
            'Lumi.get_workbench_template',
            'Lumi.list_workbench_versions',
            ...SKILL_TOOLS.map((tool) => tool.name),
          ].includes(tool.name)
            ? { annotations: { readOnlyHint: true, openWorldHint: false } }
            : ['Lumi.publish_workbench', 'Lumi.restore_workbench_version'].includes(tool.name)
              ? {
                  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
                }
              : tool.name === 'Lumi.create_capability_draft'
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
    server.setNotificationHandler('notifications/cancelled', (notification) => {
      const requestId = notification.params.requestId
      if (typeof requestId !== 'string' && typeof requestId !== 'number') return
      const calls = this.activeCalls.get(requestId)
      // Stateless clients may reuse the same ID. Never cancel an unrelated ambiguous call.
      if (calls?.size === 1) calls.values().next().value!.abort('cancelled')
    })
    server.setRequestHandler('tools/call', async (request, context) => {
      const controller = new AbortController()
      const id = context.mcpReq.id
      const calls = this.activeCalls.get(id) ?? new Set<AbortController>()
      calls.add(controller)
      this.activeCalls.set(id, calls)
      try {
        const result = await this.registry.invoke(
          request.params.name,
          request.params.arguments ?? {},
          'ai',
          AbortSignal.any([context.mcpReq.signal, controller.signal]),
        )
        recordExternalActivity()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
        }
      } catch (error) {
        if (error instanceof RegistryError && SKILL_ERRORS[error.code]) {
          const result = { error: { code: error.code, message: SKILL_ERRORS[error.code] } }
          return {
            isError: true,
            structuredContent: result,
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          }
        }
        if (error instanceof RegistryError && error.code.startsWith('knowledge_')) {
          const result = {
            error: {
              code: error.code,
              retryable: [
                'knowledge_scan_busy',
                'knowledge_build_busy',
                'knowledge_source_changed',
                'knowledge_revision_conflict',
                'knowledge_sequence_conflict',
              ].includes(error.code),
            },
          }
          return {
            isError: true,
            structuredContent: result,
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          }
        }
        if (error instanceof RegistryError && error.code === 'ai_tool_not_found_or_disabled') {
          throw new ProtocolError(-32602, 'Tool is unavailable. Refresh tools/list.')
        }
        const message =
          error instanceof RegistryError || error instanceof ToolError
            ? (TOOL_ERRORS[error.code] ?? HOME_ERRORS[error.code])
            : undefined
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: message ?? '工具调用失败，操作未完成。请在 Lumi 中检查配置。',
            },
          ],
        }
      } finally {
        calls.delete(controller)
        if (!calls.size && this.activeCalls.get(id) === calls) this.activeCalls.delete(id)
      }
    })
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: HOME_LIMITS.requestBytes,
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
  probeToken?: string,
): Promise<McpConnectionCheck> {
  const client = new Client({ name: 'Lumi connection check', version: CORE_VERSION })
  const options = { signal: AbortSignal.timeout(1200), timeout: 1200 }
  try {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: {
          headers: {
            [SESSION_TOKEN_HEADER]: token,
            ...(probeToken ? { 'x-lumi-connection-probe': probeToken } : {}),
          },
          redirect: 'error',
        },
      }),
      options,
    )
    const tools = await client.listTools({}, options)
    return {
      ok: true,
      lastExternalActivityAt: null,
      serverName: client.getServerVersion()?.name ?? null,
      serverVersion: client.getServerVersion()?.version ?? null,
      toolCount: tools.tools.length,
      error: null,
    }
  } catch {
    return {
      ok: false,
      lastExternalActivityAt: null,
      serverName: null,
      serverVersion: null,
      toolCount: 0,
      error: 'MCP 握手或工具发现失败，请检查 Lumi 服务并重新复制配置。',
    }
  } finally {
    await client.close().catch(() => {})
  }
}
