// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCapabilityDefinition, SESSION_TOKEN_HEADER, KNOWLEDGE_TOOLS } from '@lumiplug/shared'
import type { CapabilityDefinition } from '@lumiplug/shared'
import { CoreService } from '../service'
import { SKILL_TOOLS } from '../skills/tools'

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
        cwd: dataDir,
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

async function connectClient(): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  clients.push(client)
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { [SESSION_TOKEN_HEADER]: mcpToken } },
    }),
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
  })
  const handshake = await service.start()
  expect(handshake.kind).toBe('sidecar.ready')
  endpoint = new URL(`http://127.0.0.1:${service.port}/mcp`)
})

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()))
  await service.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('Lumi unified MCP gateway', () => {
  it('supports the official client and real built-in calls', async () => {
    const client = await connectClient()
    expect(client.getServerVersion()?.name).toBe('Lumi')
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      [
        'Lumi.create_capability_draft',
        'Lumi.export_workbench_project',
        'Lumi.get_context',
        'Lumi.get_task',
        'Lumi.get_workbench',
        'Lumi.get_workbench_template',
        'Lumi.list_capabilities',
        'Lumi.list_tasks',
        'Lumi.list_workbench_versions',
        'Lumi.publish_workbench',
        'Lumi.restart_task',
        'Lumi.restore_workbench_version',
        'Lumi.stop_task',
        ...KNOWLEDGE_TOOLS.map((tool) => tool.name),
        ...SKILL_TOOLS.map((tool) => tool.name),
      ].sort(),
    )
    const context = await client.callTool({ name: 'Lumi.get_context', arguments: {} })
    expect(context.structuredContent).toMatchObject({
      name: 'Lumi',
      features: { capabilityDrafts: true, runnerExecution: true, workbenchEditing: true },
    })
    expectPrivateFieldsAbsent(context)
    const check = await fetch(new URL('/app/mcp/check', endpoint), {
      headers: { [SESSION_TOKEN_HEADER]: mcpToken },
    })
    expect(await check.json()).toMatchObject({
      data: {
        ok: true,
        serverName: 'Lumi',
        toolCount: 13 + KNOWLEDGE_TOOLS.length + SKILL_TOOLS.length,
        error: null,
      },
    })

    expect(
      (await client.callTool({ name: 'Lumi.list_capabilities', arguments: {} })).structuredContent,
    ).toEqual({ capabilities: [] })
    await expect(client.callTool({ name: 'lumi.get_context', arguments: {} })).rejects.toThrow(
      'Tool is unavailable',
    )
  })

  it('does not count self-checks as external access, but records real tool discovery', async () => {
    const check = async () =>
      (
        await (
          await fetch(new URL('/app/mcp/check', endpoint), {
            headers: { [SESSION_TOKEN_HEADER]: mcpToken },
          })
        ).json()
      ).data
    expect(await check()).toMatchObject({ ok: true, lastExternalActivityAt: null })
    const client = await connectClient()
    expect(await check()).toMatchObject({ lastExternalActivityAt: null })
    await expect(client.listTools({ cursor: 'invalid' })).rejects.toThrow()
    expect(await check()).toMatchObject({ lastExternalActivityAt: null })
    await client.listTools()
    expect(await check()).toMatchObject({ ok: true, lastExternalActivityAt: expect.any(String) })
  })

  it('creates persistent AI drafts without exposing or enabling them', async () => {
    const client = await connectClient()
    const result = await client.callTool({
      name: 'Lumi.create_capability_draft',
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
    const list = await client.callTool({ name: 'Lumi.list_capabilities', arguments: {} })
    expect(list.structuredContent).toMatchObject({
      capabilities: [{ id: draft.id, enabled: false }],
    })
    expect((await client.listTools()).tools.some((tool) => tool.name === 'project.request')).toBe(
      false,
    )
    expectPrivateFieldsAbsent(result)
    expectPrivateFieldsAbsent(list)
  })

  it('persists fixed Terminal commands through MCP without running or enabling them', async () => {
    const client = await connectClient()
    const marker = path.join(dataDir, 'must-not-exist')
    const command = `touch '${marker}'`
    const result = await client.callTool({
      name: 'Lumi.create_capability_draft',
      arguments: { kind: 'terminal', name: 'restartLumi', namespace: 'desktop', command },
    })
    expect(result.isError).not.toBe(true)
    const draft = service.repository.listAll()[0]!
    expect(draft.runner.settings).toMatchObject({ type: 'terminal', command, cwd: '' })
    expect(draft.tools[0]!.fields).toEqual([])
    expect(draft).toMatchObject({ source: 'ai', enabled: false, status: 'draft' })
    expect(fs.existsSync(marker)).toBe(false)
    expect(JSON.stringify(result)).not.toContain(command)
    expect((await client.listTools()).tools.some((t) => t.name === 'desktop.run')).toBe(false)
    const invalid = await client.callTool({
      name: 'Lumi.create_capability_draft',
      arguments: { kind: 'http', name: 'wrongKind', command },
    })
    expect(invalid.isError).toBe(true)
    expect(service.repository.listAll()).toHaveLength(1)
  })

  it('refreshes enabled tools live, hides private fields, and rejects calls after disable', async () => {
    const client = await connectClient()
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
      await client.callTool({ name: 'Lumi.list_capabilities', arguments: {} }),
    )
    const unavailable = await client.callTool({
      name: 'example.run',
      arguments: { command: 'exit 1' },
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
    const client = await connectClient()
    await expect(client.listTools({ cursor: canary })).rejects.toThrow('no pagination cursor')
    const invalid = await client.callTool({
      name: 'Lumi.create_capability_draft',
      arguments: { kind: 'terminal', name: 'test-task', enabled: true, sessionToken: canary },
    })
    expect(invalid.isError).toBe(true)
    expectPrivateFieldsAbsent(invalid)
    const reserved = await client.callTool({
      name: 'Lumi.create_capability_draft',
      arguments: { kind: 'terminal', name: 'test-task', namespace: 'Lumi' },
    })
    expect(reserved.isError).toBe(true)
    expect(service.repository.listAll()).toHaveLength(0)
    const reservedDraft = service.repository.saveDraft(fixture('Lumi'))
    expect(() => service.registry.enable(reservedDraft.id, 'ui')).toThrow('reserved_tool_namespace')
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
    expect((await fetch(new URL('/app/capabilities', endpoint), { headers })).status).toBe(403)
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
          body: JSON.stringify({ data: 'x'.repeat(24 * 1024 * 1024 + 1) }),
        })
      ).status,
    ).toBe(413)
    expect(
      (await fetch(endpoint, { headers: { ...headers, accept: 'text/event-stream' } })).status,
    ).toBe(405)
  })

  it('bridges stdio to the same Core, preserving tool lists, IDs and parallel calls', async () => {
    const http = await connectClient()
    const client = new Client({ name: 'stdio-test', version: '1' })
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
      client.callTool({ name: 'Lumi.get_context', arguments: {} }),
      client.callTool({
        name: 'Lumi.create_capability_draft',
        arguments: { kind: 'terminal', name: 'from-stdio' },
      }),
    ])
    expect(results[0]?.structuredContent).toMatchObject({ name: 'Lumi' })
    expect(results[1]?.structuredContent).toMatchObject({
      capability: { name: 'from-stdio', enabled: false },
    })
    expect(
      (await http.callTool({ name: 'Lumi.list_capabilities', arguments: {} })).structuredContent,
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
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 'catalog', method: 'tools/list', params: {} })}\n${JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'Lumi.get_context', arguments: {} } })}\n`,
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
