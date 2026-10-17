// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createServer } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { createCapabilityDefinition, SESSION_TOKEN_HEADER } from '@lumiplug/shared'
import type { CapabilityDefinition, ToolTaskInputSnapshot } from '@lumiplug/shared'
import { CoreService } from '../service'
import { createRequire } from 'node:module'
const startProxy = createRequire(path.join(process.cwd(), 'package.json'))(
  './packages/mcp-stdio-proxy/dist/index.js',
).startProxy as (
  config: { coreUrl: string; sessionToken: string; requestTimeoutMs: number },
  streams: { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough },
) => Promise<() => Promise<void>>

const token = 'fix-regression-session-0123456789abcdef'
const hostToken = 'fix-regression-host-0123456789abcdef'
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-functional-fixes-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const service = new CoreService({
    host: '127.0.0.1',
    port: 0,
    sessionToken: token,
    hostToken,
    userDataDir: dir,
  })
  await service.start()
  cleanups.push(() => service.stop())
  return { service, dir, base: `http://127.0.0.1:${service.port}` }
}
async function save(service: CoreService, definition: CapabilityDefinition) {
  if (definition.runner.type === 'http')
    definition.tools = definition.tools.map((tool) => ({
      ...tool,
      fields: [
        {
          key: 'q',
          schema: { type: 'string' },
          required: false,
          aiVisible: true,
          value: null,
          binding: { location: 'query', key: 'q' },
        },
      ],
    }))
  const saved = (await service.tools.request({
    action: 'save',
    payload: { definition, expectedVersion: 0 },
  })) as CapabilityDefinition
  return service.registry.enable(saved.id, 'ui')
}
it('rejects every desktop tool action and capability approval with only an MCP token, while host operations and public MCP still work', async () => {
  const { service, base } = await setup()
  const def = await save(
    service,
    createCapabilityDefinition({ kind: 'terminal', name: 'private', namespace: 'boundary' }),
  )
  const headers = { 'content-type': 'application/json', [SESSION_TOKEN_HEADER]: token }
  for (const action of [
    'list',
    'get',
    'snapshot',
    'save',
    'enable',
    'disable',
    'run',
    'prepare',
    'discover',
    'check',
    'restart',
    'stop',
    'archive',
    'restore',
    'tasks',
    'task',
  ]) {
    const response = await fetch(base + '/app/tools', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, payload: { id: def.id } }),
    })
    expect(response.status, action).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'tools_host_required' } })
  }
  for (const route of [
    '/app/capabilities',
    '/app/capabilities/drafts',
    `/app/capabilities/${def.id}/enable`,
    `/app/capabilities/${def.id}/disable`,
  ])
    expect(
      (
        await fetch(base + route, {
          method: route === '/app/capabilities' ? 'GET' : 'POST',
          headers,
        })
      ).status,
    ).toBe(403)
  const approved = await fetch(base + '/app/tools', {
    method: 'POST',
    headers: { ...headers, 'x-lumiplug-host-token': hostToken },
    body: JSON.stringify({ action: 'get', payload: { id: def.id } }),
  })
  expect(approved.status).toBe(200)
  const publicList = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { ...headers, accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  expect(publicList.status).toBe(200)
  expect(await publicList.text()).toContain('boundary.run')
  expect(service.repository.getById(def.id)?.enabled).toBe(true)
})
it('persists original public input and private config for the host, without adding either to MCP task responses, after finish and Core restart', async () => {
  const { service, dir } = await setup()
  const definition = createCapabilityDefinition({
    kind: 'http',
    name: 'snapshot',
    namespace: 'history',
    url: 'http://127.0.0.1:1',
  })
  if (definition.runner.settings.type !== 'http') throw new Error('fixture')
  definition.runner.settings.fixedHeaders = { Authorization: 'PRIVATE-HISTORY-CANARY' }
  const def = await save(service, definition)
  const task = service.registry.startTask('history.request', { q: 'original-input' }, 'ai')
  await service.tasks.wait(task.id)
  const snapshot = (await service.tools.request({
    action: 'snapshot',
    payload: { id: task.id },
  })) as ToolTaskInputSnapshot
  expect(snapshot.definition).toEqual(def)
  expect(snapshot.arguments).toEqual({ q: 'original-input' })
  const edited = structuredClone(def)
  edited.tools[0]!.fields[0]!.schema.default = 'CHANGED-LATER-DEFAULT'
  await service.tools.request({
    action: 'save',
    payload: { definition: edited, expectedVersion: def.version },
  })
  expect(service.tasks.snapshot(task.id)).toEqual(snapshot)

  expect(
    JSON.stringify(await service.registry.invoke('Lumi.get_task', { id: task.id })),
  ).not.toContain('PRIVATE-HISTORY-CANARY')
  expect(
    JSON.stringify(await service.registry.invoke('Lumi.get_task', { id: task.id })),
  ).not.toContain('fixedHeaders')
  await service.stop()
  cleanups.pop()
  const reopened = new CoreService({
    host: '127.0.0.1',
    port: 0,
    sessionToken: token,
    hostToken,
    userDataDir: dir,
  })
  await reopened.start()
  cleanups.push(() => reopened.stop())
  expect(reopened.tasks.snapshot(task.id)).toEqual(snapshot)
})
it('isolates cancellation for two real stdio proxies using the same request ID, including a late duplicate notification', async () => {
  const { service, base } = await setup()
  const upstream = createServer((_request, response) => {
    setTimeout(() => {
      if (!response.destroyed) response.end('survivor')
    }, 350)
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        upstream.close(() => resolve())
        upstream.closeAllConnections()
      }),
  )
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('fixture address')
  for (const namespace of ['peer0', 'peer1'])
    await save(
      service,
      createCapabilityDefinition({
        kind: 'http',
        name: namespace,
        namespace,
        url: `http://127.0.0.1:${address.port}`,
      }),
    )
  type WireMessage = { id: unknown; result?: { isError?: boolean }; error?: unknown }
  const peers: Array<{ send: (message: unknown) => boolean; messages: WireMessage[] }> = []
  for (let i = 0; i < 2; i++) {
    const stdin = new PassThrough(),
      stdout = new PassThrough(),
      stderr = new PassThrough()
    const messages: Array<{ id: unknown; result?: { isError?: boolean }; error?: unknown }> = []
    let pending = ''
    stdout.on('data', (chunk) => {
      pending += chunk.toString()
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        messages.push(JSON.parse(pending.slice(0, newline)))
        pending = pending.slice(newline + 1)
      }
    })
    cleanups.push(
      await startProxy(
        { coreUrl: base, sessionToken: token, requestTimeoutMs: 10000 },
        { stdin, stdout, stderr },
      ),
    )
    const send = (message: unknown) => stdin.write(JSON.stringify(message) + '\n')
    send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: `peer${i}`, version: '1' },
      },
    })
    await expect.poll(() => messages.some((m) => m.id === 0)).toBe(true)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    peers.push({ send, messages })
  }
  for (let i = 0; i < 2; i++)
    peers[i]!.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: `peer${i}.request`, arguments: {} },
    })
  await expect.poll(() => service.tasks.list().filter((t) => t.status === 'running').length).toBe(2)
  peers[0]!.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })
  await expect
    .poll(() => service.tasks.list().find((t) => t.operation === 'peer0.request')?.status)
    .toBe('cancelled')
  peers[0]!.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })
  await expect
    .poll(
      () =>
        peers[1]!.messages.find((m) => m.id === 1)?.result?.isError === false ||
        (!!peers[1]!.messages.find((m) => m.id === 1)?.result &&
          !peers[1]!.messages.find((m) => m.id === 1)?.result?.isError),
    )
    .toBe(true)
  expect(service.tasks.list().find((t) => t.operation === 'peer1.request')?.status).toBe(
    'completed',
  )
}, 15000)
