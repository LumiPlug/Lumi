// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest'
import type { McpConnectionInfo } from '@lumiplug/shared'
import { buildWorkbenchPrompt, formatMcpConfig, mcpAvailability, parseMcpPort } from './mcp'

const connection: McpConnectionInfo = {
  endpoint: 'http://127.0.0.1:43210/mcp',
  authHeader: 'x-lumiplug-session-token',
  sessionToken: 'test-session-token',
  coreState: 'ready',
  stdioCommand: '/test/lumi-mcp-proxy',
}

describe('desktop MCP configuration', () => {
  it('uses the current endpoint and authentication header without exposing supervisor metadata', () => {
    const config = JSON.parse(formatMcpConfig(connection))
    expect(config).toEqual({
      mcpServers: {
        Lumi: {
          url: connection.endpoint,
          headers: { 'x-lumiplug-session-token': connection.sessionToken },
        },
      },
    })
  })

  it.each(['connection'] as const)(
    '%s includes the current session and available gateway',
    (type) => {
      const prompt = buildWorkbenchPrompt(type, connection)
      expect(prompt).toContain(formatMcpConfig(connection))
      expect(prompt).toContain('保持 Lumi 运行')
      expect(prompt).toContain('修改端口并重启或手动刷新令牌后，请重新复制配置')
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

  it.each(['assistant', 'features'] as const)('%s contains only workbench instructions', (type) => {
    const prompt = buildWorkbenchPrompt(type, connection)
    expect(prompt).toBe(buildWorkbenchPrompt(type, null))
    expect(prompt).not.toContain(connection.sessionToken)
    expect(prompt).not.toContain(connection.endpoint)
    expect(prompt).not.toContain('mcpServers')
    expect(prompt).not.toContain('配置 Lumi MCP')
    expect(prompt).toContain('Lumi.get_context')
  })

  it('does not invent credentials when the desktop IPC is unavailable', () => {
    const prompt = buildWorkbenchPrompt('connection', null)
    expect(prompt).toContain('设置 → MCP 连接')
    expect(prompt).not.toContain('mcpServers')
    expect(prompt).not.toContain('127.0.0.1')
  })

  it('uses the same token in stdio environment configuration, without putting it in process arguments', () => {
    const config = JSON.parse(formatMcpConfig(connection, 'stdio'))
    expect(config.mcpServers.Lumi).toEqual({
      command: connection.stdioCommand,
      args: ['--core-url', 'http://127.0.0.1:43210'],
      env: { LUMIPLUG_SESSION_TOKEN: connection.sessionToken },
    })
    expect(config.mcpServers.Lumi.args).not.toContain(connection.sessionToken)
    expect(formatMcpConfig({ ...connection, stdioCommand: null }, 'stdio')).toBe('')
  })

  it('reports local service readiness', () => {
    expect(mcpAvailability({ ...connection, coreState: 'starting' })).toContain('尚未就绪')
    expect(mcpAvailability(connection)).toContain('保持 Lumi 运行')
  })
})

describe('MCP port input', () => {
  it('accepts supported integer ports and rejects blank, ephemeral, privileged and malformed ports', () => {
    for (const input of ['0', '1023', '65536', '', '1e4', '1234.5', '-2000', '38491abc'])
      expect(parseMcpPort(input)).toBeNull()
    expect(parseMcpPort(' 38491 ')).toBe(38491)
    expect(parseMcpPort('1024')).toBe(1024)
    expect(parseMcpPort('65535')).toBe(65535)
  })
})
