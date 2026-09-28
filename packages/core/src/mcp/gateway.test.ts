// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport as LegacyHttp } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCapabilityDefinition, SESSION_TOKEN_HEADER } from '@lumiplug/shared'
import type { CapabilityDefinition } from '@lumiplug/shared'
import { CoreService } from '../service'

const mcpToken = 'mcp-session-test-0123456789abcdef'
const canary = 'PRIVATE-CANARY-DO-NOT-LEAK'
let service: CoreService
let dataDir: string
let endpoint: URL
const clients: Array<{ close(): Promise<void> }> = []

function fixture(namespace = 'example'): CapabilityDefinition {
  const definition = createCapabilityDefinition({
    kind: 'terminal',
    name: 'example-task',
    namespace,
  })
  const tool = definition.tools[0]!
  return {
    ...definition,
    runner: {
      type: 'terminal',
      settings: {
        type: 'terminal',
        cwd: `/private/${canary}`,
        shell: 'auto',
        environment: { internal_env: canary },
      },
    },
    tools: [
      {
        ...tool,
        fields: [
          ...tool.fields,
          {
            key: 'hidden_canary_field',
            schema: { type: 'string' },
            required: false,
            aiVisible: false,
            value: canary,
            binding: { location: 'argument', key: 'hidden_canary_binding' },
          },
        ],
      },
    ],
  }
}

async function connectLegacy(): Promise<LegacyClient> {
  const client = new LegacyClient({ name: 'test-client-v1', version: '1.0.0' })
  clients.push(client)
  await client.connect(
    new LegacyHttp(endpoint, { requestInit: { headers: { [SESSION_TOKEN_HEADER]: mcpToken } } }),
  )
  return client
}

function expectPrivateFieldsAbsent(value: unknown): void {
  const wire = JSON.stringify(value)
  for (const forbidden of [
    canary,
    'hidden_canary_field',
    'hidden_canary_binding',
    'internal_env',
    'runnerType',
    'settings',
    mcpToken,
  ]) {
    expect(wire).not.toContain(forbidden)
  }
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-mcp-test-'))
  service = new CoreService({
    host: '127.0.0.1',
    port: 0,
    sessionToken: mcpToken,
    userDataDir: dataDir,
    parentPid: process.ppid,
  })
  const handshake = await service.start()
  expect(handshake.mcpAvailable).toBe(true)
  endpoint = new URL(`http://127.0.0.1:${service.port}/mcp`)
})

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()))
  await service.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('Lumi unified MCP gateway', () => {
  it('supports official v1 and v2 clients and real built-in calls', async () => {
    const legacy = await connectLegacy()
    expect(legacy.getServerVersion()?.name).toBe('Lumi')
    expect(legacy.getServerCapabilities()?.tools?.listChanged).toBe(false)
    const tools = await legacy.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'lumi.create_capability_draft',
      'lumi.get_context',
      'lumi.list_capabilities',
    ])
    const context = await legacy.callTool({ name: 'lumi.get_context', arguments: {} })
    expect(context.structuredContent).toMatchObject({
      name: 'Lumi',
      features: { capabilityDrafts: true, runnerExecution: false, workbenchEditing: false },
    })
    expectPrivateFieldsAbsent(context)
    const check = await fetch(new URL('/app/mcp/check', endpoint), {
      headers: { [SESSION_TOKEN_HEADER]: mcpToken },
    })
    expect(await check.json()).toMatchObject({
      data: { ok: true, serverName: 'Lumi', toolCount: 3, error: null },
    })

    const modern = new Client({ name: 'test-client-v2', version: '1.0.0' })
    clients.push(modern)
    await modern.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { [SESSION_TOKEN_HEADER]: mcpToken } },
      }),
    )
    expect((await modern.listTools()).tools).toEqual(tools.tools)
    expect(
      (await modern.callTool({ name: 'lumi.list_capabilities', arguments: {} })).structuredContent,
    ).toEqual({ capabilities: [] })
  })

  it('creates persistent AI drafts without exposing or enabling them', async () => {
    const client = await connectLegacy()
    const result = await client.callTool({
      name: 'lumi.create_capability_draft',
      arguments: {
        kind: 'http',
        name: 'new-api',
        namespace: 'project',
        description: 'Read project data',
      },
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      capability: { name: 'new-api', status: 'draft', enabled: false },
    })
    const draft = service.repository.listAll()[0]!
    expect(draft.source).toBe('ai')
    expect(draft.runner.type).toBe('http')
    expect(draft.enabled).toBe(false)
    const list = await client.callTool({ name: 'lumi.list_capabilities', arguments: {} })
    expect(list.structuredContent).toMatchObject({
      capabilities: [{ id: draft.id, enabled: false }],
    })
    expect((await client.listTools()).tools.some((tool) => tool.name === 'project.request')).toBe(
      false,
    )
    expectPrivateFieldsAbsent(result)
    expectPrivateFieldsAbsent(list)
  })

  it('refreshes enabled tools live, hides private fields, and rejects calls after disable', async () => {
    const client = await connectLegacy()
    const capability = service.repository.saveDraft(fixture())
    expect((await client.listTools()).tools.some((tool) => tool.name === 'example.run')).toBe(false)
    service.registry.enable(capability.id, 'ui')
    const enabled = await client.listTools()
    expect(enabled.tools.find((tool) => tool.name === 'example.run')?.inputSchema).toEqual({
      type: 'object',
      properties: { command: { type: 'string', minLength: 1 } },
      required: ['command'],
      additionalProperties: false,
    })
    expectPrivateFieldsAbsent(enabled)
    expectPrivateFieldsAbsent(
      await client.callTool({ name: 'lumi.list_capabilities', arguments: {} }),
    )
    const unavailable = await client.callTool({
      name: 'example.run',
      arguments: { command: 'echo test' },
    })
    expect(unavailable.isError).toBe(true)
    expectPrivateFieldsAbsent(unavailable)
    service.registry.disable(capability.id, 'ui')
    expect((await client.listTools()).tools.some((tool) => tool.name === 'example.run')).toBe(false)
    await expect(
      client.callTool({ name: 'example.run', arguments: { command: 'echo test' } }),
    ).rejects.toThrow('Tool is unavailable')
  })

  it('validates arguments, sanitizes errors and reserves the built-in namespace', async () => {
    const client = await connectLegacy()
    await expect(client.listTools({ cursor: canary })).rejects.toThrow('no pagination cursor')
    const invalid = await client.callTool({
      name: 'lumi.create_capability_draft',
      arguments: { kind: 'terminal', name: 'test-task', enabled: true, sessionToken: canary },
    })
    expect(invalid.isError).toBe(true)
    expectPrivateFieldsAbsent(invalid)
    const reserved = await client.callTool({
      name: 'lumi.create_capability_draft',
      arguments: { kind: 'terminal', name: 'test-task', namespace: 'lumi' },
    })
    expect(reserved.isError).toBe(true)
    expect(service.repository.count()).toBe(0)
    await expect(client.callTool({ name: canary, arguments: {} })).rejects.toThrow(
      'Tool is unavailable',
    )
    const a = service.repository.saveDraft(fixture('unique'))
    const b = service.repository.saveDraft(fixture('unique'))
    service.registry.enable(a.id, 'ui')
    expect(() => service.registry.enable(b.id, 'ui')).toThrow('public_tool_name_conflict')
    const hiddenInput = await client.callTool({
      name: 'unique.run',
      arguments: { command: 'echo test', hidden_canary_field: canary },
    })
    expect(hiddenInput.isError).toBe(true)
    expectPrivateFieldsAbsent(hiddenInput)
  })

  it('uses the shared session token and rejects untrusted HTTP requests', async () => {
    const headers = {
      [SESSION_TOKEN_HEADER]: mcpToken,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    }
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'boundary', version: '1' },
      },
    })
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { ...headers, [SESSION_TOKEN_HEADER]: 'incorrect-session-token' },
          body,
        })
      ).status,
    ).toBe(401)
    expect((await fetch(new URL('/app/capabilities', endpoint), { headers })).status).toBe(200)
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { ...headers, origin: 'https://untrusted.example' },
          body,
        })
      ).status,
    ).toBe(403)
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        endpoint,
        { method: 'POST', headers: { ...headers, host: `evil.example:${service.port}` } },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      request.on('error', reject)
      request.end(body)
    })
    expect(hostStatus).toBe(400)
    expect((await fetch(endpoint, { method: 'POST', headers, body: '{broken-json' })).status).toBe(
      400,
    )
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ data: 'x'.repeat(70 * 1024) }),
        })
      ).status,
    ).toBe(413)
    expect(
      (await fetch(endpoint, { headers: { ...headers, accept: 'text/event-stream' } })).status,
    ).toBe(405)
  })

  it('bridges stdio to the same Core, preserving tool lists, IDs and parallel calls', async () => {
    const http = await connectLegacy()
    const client = new LegacyClient({ name: 'stdio-test', version: '1' })
    clients.push(client)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('packages/mcp-stdio-proxy/dist/index.js'), '--core-url', endpoint.origin],
      env: { ...(process.env as Record<string, string>), LUMIPLUG_SESSION_TOKEN: mcpToken },
      stderr: 'pipe',
    })
    let diagnostic = ''
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostic += chunk.toString()
    })
    await client.connect(transport)
    expect((await client.listTools()).tools).toEqual((await http.listTools()).tools)
    const results = await Promise.all([
      client.callTool({ name: 'lumi.get_context', arguments: {} }),
      client.callTool({
        name: 'lumi.create_capability_draft',
        arguments: { kind: 'terminal', name: 'from-stdio' },
      }),
    ])
    expect(results[0]?.structuredContent).toMatchObject({ name: 'Lumi' })
    expect(results[1]?.structuredContent).toMatchObject({
      capability: { name: 'from-stdio', enabled: false },
    })
    expect(
      (await http.callTool({ name: 'lumi.list_capabilities', arguments: {} })).structuredContent,
    ).toMatchObject({ capabilities: [{ name: 'from-stdio' }] })
    expectPrivateFieldsAbsent(results)
    expect(diagnostic).not.toContain(mcpToken)
  }, 15_000)

  it('preserves raw stdio request IDs and sends no response for notifications', async () => {
    const child = spawn(
      process.execPath,
      [path.resolve('packages/mcp-stdio-proxy/dist/index.js'), '--core-url', endpoint.origin],
      {
        env: { ...process.env, LUMIPLUG_SESSION_TOKEN: mcpToken },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const exited = once(child, 'exit')
    let buffer = ''
    let diagnostic = ''
    const messages: Record<string, unknown>[] = []
    const checks = new Set<() => void>()
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line) messages.push(JSON.parse(line) as Record<string, unknown>)
      for (const check of checks) check()
    })
    const waitForMessages = (count: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const check = (): void => {
          if (messages.length >= count) {
            clearTimeout(timer)
            checks.delete(check)
            resolve()
          }
        }
        const timer = setTimeout(() => {
          checks.delete(check)
          reject(new Error('stdio_response_timeout'))
        }, 2000)
        checks.add(check)
        check()
      })
    try {
      const initialize = JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'raw-stdio', version: '1' },
        },
      })
      child.stdin.write(initialize.slice(0, 30))
      child.stdin.write(`${initialize.slice(30)}\n`)
      await waitForMessages(1)
      expect(messages[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 0,
        result: { serverInfo: { name: 'Lumi' } },
      })
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 'catalog', method: 'tools/list', params: {} })}\n${JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'lumi.get_context', arguments: {} } })}\n`,
      )
      await waitForMessages(3)
      child.stdin.end()
      const [exitCode] = await exited
      expect(exitCode).toBe(0)
      expect(messages).toHaveLength(3)
      expect(new Set(messages.map((message) => message.id))).toEqual(new Set([0, 'catalog', 17]))
      expectPrivateFieldsAbsent(messages)
      expect(diagnostic).not.toContain(mcpToken)
    } finally {
      if (child.exitCode === null) child.kill()
    }
  }, 10_000)
})
