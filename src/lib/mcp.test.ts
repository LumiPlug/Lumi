// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest'
import type { McpConnectionInfo } from '@lumiplug/shared'
import { buildWorkbenchPrompt, formatMcpConfig, mcpAvailability } from './mcp'

const connection: McpConnectionInfo = {
  transport: 'streamable-http',
  endpoint: 'http://127.0.0.1:43210/mcp',
  authHeader: 'x-lumiplug-session-token',
  sessionToken: 'test-session-token',
  gatewayAvailable: false,
  coreState: 'ready',
  stdioCommand: '/test/lumi-mcp-proxy',
}

describe('desktop MCP configuration', () => {
  it('uses the current endpoint and authentication header without exposing supervisor metadata', () => {
    const config = JSON.parse(formatMcpConfig(connection))
    expect(config).toEqual({
      mcpServers: {
        lumi: {
          url: connection.endpoint,
          headers: { 'x-lumiplug-session-token': connection.sessionToken },
        },
      },
    })
  })

  it.each(['connection', 'assistant', 'features'] as const)(
    '%s includes the current session and the gateway limitation',
    (type) => {
      const prompt = buildWorkbenchPrompt(type, connection)
      expect(prompt).toContain(formatMcpConfig(connection))
      expect(prompt).toContain('尚未启用 MCP 网关')
      expect(prompt).toContain('应用重新启动后，请重新复制配置')
      const nextSession = {
        ...connection,
        endpoint: 'http://127.0.0.1:43211/mcp',
        sessionToken: 'next-session-token',
      }
      const nextPrompt = buildWorkbenchPrompt(type, nextSession)
      expect(nextPrompt).toContain(formatMcpConfig(nextSession))
      expect(nextPrompt).not.toContain(connection.sessionToken)
    },
  )

  it('does not invent credentials when the desktop IPC is unavailable', () => {
    const prompt = buildWorkbenchPrompt('connection', null)
    expect(prompt).toContain('设置 → MCP 连接')
    expect(prompt).not.toContain('mcpServers')
    expect(prompt).not.toContain('127.0.0.1')
  })

  it('uses the same token in stdio environment configuration, without putting it in process arguments', () => {
    const config = JSON.parse(formatMcpConfig(connection, 'stdio'))
    expect(config.mcpServers.lumi).toEqual({
      command: connection.stdioCommand,
      args: ['--core-url', 'http://127.0.0.1:43210'],
      env: { LUMIPLUG_SESSION_TOKEN: connection.sessionToken },
    })
    expect(config.mcpServers.lumi.args).not.toContain(connection.sessionToken)
    expect(formatMcpConfig({ ...connection, stdioCommand: null }, 'stdio')).toBe('')
  })

  it('distinguishes an implemented gateway from local service readiness', () => {
    expect(
      mcpAvailability({ ...connection, gatewayAvailable: true, coreState: 'starting' }),
    ).toContain('尚未就绪')
    expect(mcpAvailability({ ...connection, gatewayAvailable: true })).toContain('保持 Lumi 运行')
  })
})
