// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Server } from '@modelcontextprotocol/server'
import type { Tool } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import {
  createCapabilityDefinition,
  SESSION_TOKEN_HEADER,
  deriveAiToolView,
} from '@lumiplug/shared'
import type { CapabilityDefinition, CapabilityTool, ToolTask } from '@lumiplug/shared'
import { CoreService } from '../service'
import { McpConnections } from './mcp'
import { TaskManager } from './tasks'
import { filterResponse } from './response-filter'
import * as terminalEnvironment from './terminal-environment'
const token = 'tools-session-test-0123456789abcdef'
const canary = 'FIXED-SECRET-CANARY-75319'
let dir: string
let service: CoreService
const servers: HttpServer[] = []
const clients: Client[] = []
async function listen(server: HttpServer): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('address')
  return address.port
}
async function save(def: CapabilityDefinition): Promise<CapabilityDefinition> {
  return (await service.tools.request({
    action: 'save',
    payload: { definition: def, expectedVersion: 0 },
  })) as CapabilityDefinition
}
async function enable(def: CapabilityDefinition): Promise<CapabilityDefinition> {
  return (await service.tools.request({
    action: 'enable',
    payload: { id: def.id, expectedVersion: def.version, expectedUpdatedAt: def.updatedAt },
  })) as CapabilityDefinition
}
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-tools-'))
  service = new CoreService({ host: '127.0.0.1', port: 0, sessionToken: token, userDataDir: dir })
  await service.start()
})
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((c) => c.close()))
  await service.stop()
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve())
          s.closeAllConnections()
        }),
    ),
  )
  fs.rmSync(dir, { recursive: true, force: true })
})
describe('tools management and shared execution', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps Terminal run alive beyond five minutes without an execution deadline',
    async () => {
      const environment = vi
        .spyOn(terminalEnvironment, 'systemTerminalEnvironment')
        .mockResolvedValue({ shell: '/bin/sh', environment: process.env })
      await enable(
        await save(
          createCapabilityDefinition({
            kind: 'terminal',
            name: 'unlimited',
            namespace: 'unlimited',
            cwd: dir,
          }),
        ),
      )
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const task = service.registry.startTask('unlimited.run', { command: 'sleep 60' }, 'manual')
        await new Promise((resolve) => setImmediate(resolve))
        await vi.advanceTimersByTimeAsync(301000)
        await new Promise((resolve) => setImmediate(resolve))
        expect(service.tasks.get(task.id).status).toBe('running')
        service.tasks.stop(task.id)
        expect((await service.tasks.wait(task.id)).status).toBe('cancelled')
      } finally {
        vi.useRealTimers()
        environment.mockRestore()
      }
    },
  )
  it.skipIf(process.platform === 'win32')(
    'replaces the same terminal tool only after its previous process closes, without stopping other tools',
    async () => {
      await enable(
        await save(
          createCapabilityDefinition({
            kind: 'terminal',
            name: 'replace',
            namespace: 'replace',
            cwd: dir,
          }),
        ),
      )
      await enable(
        await save(
          createCapabilityDefinition({
            kind: 'terminal',
            name: 'independent',
            namespace: 'independent',
            cwd: dir,
          }),
        ),
      )
      const other = service.registry.startTask('independent.run', { command: 'sleep 60' }, 'manual')
      const first = service.registry.startTask(
        'replace.run',
        { command: 'printf ready; sleep 60' },
        'manual',
      )
      await expect.poll(() => service.tasks.get(first.id).stdout, { timeout: 5000 }).toBe('ready')
      const second = service.registry.startTask(
        'replace.run',
        { command: 'printf replaced; sleep 60' },
        'manual',
      )
      await expect
        .poll(() => service.tasks.get(second.id).stdout, { timeout: 5000 })
        .toBe('replaced')
      expect(service.tasks.get(first.id).status).toBe('cancelled')
      expect(service.tasks.get(other.id).status).toBe('running')
      service.tasks.stop(second.id)
      service.tasks.stop(other.id)
      await Promise.all([service.tasks.wait(second.id), service.tasks.wait(other.id)])
    },
  )
  it.skipIf(process.platform === 'win32')(
    'forces termination of commands and children that ignore the first stop signal',
    async () => {
      await enable(
        await save(
          createCapabilityDefinition({
            kind: 'terminal',
            name: 'stubborn',
            namespace: 'stubborn',
            cwd: dir,
          }),
        ),
      )
      const marker = path.join(dir, 'surviving-child')
      const childScript = `process.on('SIGTERM',()=>{}); setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive'),1500); console.log('child-ready'); setInterval(()=>{},1000)`
      const script = `process.on('SIGTERM',()=>{}); require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'inherit'}); setInterval(()=>{},1000)`
      const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
      const task = service.registry.startTask(
        'stubborn.run',
        { command: `exec ${quote(process.execPath)} -e ${quote(script)}` },
        'manual',
      )
      await expect
        .poll(() => service.tasks.get(task.id).stdout, { timeout: 5000 })
        .toContain('child-ready')
      expect(service.tasks.stop(task.id).status).toBe('stopping')
      expect((await service.tasks.wait(task.id)).status).toBe('cancelled')
      await new Promise((resolve) => setTimeout(resolve, 1600))
      expect(fs.existsSync(marker)).toBe(false)
    },
  )
  it.skipIf(process.platform === 'win32')(
    'uses the system PATH, applies task overrides last and keeps host credentials out of command processes',
    async () => {
      const bin = path.join(dir, 'bin')
      fs.mkdirSync(bin)
      fs.writeFileSync(path.join(bin, 'lumi-system-fixture'), '#!/bin/sh\nprintf resolved\n', {
        mode: 0o755,
      })
      const environment = vi
        .spyOn(terminalEnvironment, 'systemTerminalEnvironment')
        .mockResolvedValue({
          shell: '/bin/sh',
          environment: {
            ...process.env,
            PATH: `${bin}:/usr/bin:/bin`,
            TASK_SETTING: 'system',
            LUMIPLUG_HOST_TOKEN: 'host-secret',
            LUMIPLUG_SESSION_TOKEN: 'session-secret',
          },
        })
      try {
        const def = createCapabilityDefinition({
          kind: 'terminal',
          name: 'systemEnvironment',
          namespace: 'systemEnvironment',
          cwd: dir,
          command:
            'test "$TASK_SETTING" = override && test "$PROJECT" = provided && test -z "$LUMIPLUG_HOST_TOKEN" && test -z "$LUMIPLUG_SESSION_TOKEN" && lumi-system-fixture',
        })
        if (def.runner.settings.type === 'terminal')
          def.runner.settings.environment = { TASK_SETTING: 'override' }
        def.tools[0]!.fields = [
          {
            key: 'PROJECT',
            schema: { type: 'string' },
            required: true,
            aiVisible: true,
            value: null,
            binding: null,
          },
        ]
        await enable(await save(def))
        expect(
          await service.registry.invoke('systemEnvironment.run', { PROJECT: 'provided' }),
        ).toMatchObject({ stdout: 'resolved', exitCode: 0 })
      } finally {
        environment.mockRestore()
      }
    },
  )
  it('prepares only public arguments with Core defaults and schema errors without creating tasks', async () => {
    const draft = createCapabilityDefinition({
      kind: 'terminal',
      name: 'preflight',
      namespace: 'preflight',
      command: 'echo ok',
      cwd: dir,
    })
    draft.tools[0]!.fields = [
      {
        key: 'empty',
        schema: { type: 'string', default: '' },
        required: true,
        aiVisible: true,
        value: null,
        binding: null,
      },
      {
        key: 'flag',
        schema: { type: 'boolean', default: false },
        required: true,
        aiVisible: true,
        value: null,
        binding: null,
      },
      {
        key: 'count',
        schema: { type: 'integer', default: 0 },
        required: true,
        aiVisible: true,
        value: null,
        binding: null,
      },
      {
        key: 'nullable',
        schema: { type: ['string', 'null'], default: null },
        required: true,
        aiVisible: true,
        value: null,
        binding: null,
      },
      {
        key: 'payload',
        schema: {
          type: 'object',
          properties: { limit: { type: 'integer', default: 3 } },
          default: {},
        },
        required: true,
        aiVisible: true,
        value: null,
        binding: null,
      },
      {
        key: 'secret',
        schema: { type: 'string' },
        required: false,
        aiVisible: false,
        value: canary,
        binding: null,
      },
    ]
    const def = await enable(await save(draft))
    const prepare = (args: Record<string, unknown>, expectedVersion = def.version) =>
      service.tools.request({
        action: 'prepare',
        payload: { name: 'preflight.run', arguments: args, expectedVersion },
      })
    expect(await prepare({})).toEqual({
      ok: true,
      requiredInputs: [],
      effective: { empty: '', flag: false, count: 0, nullable: null, payload: { limit: 3 } },
    })
    const overridden = await prepare({ empty: 'explicit', flag: true })
    expect(overridden).toMatchObject({ ok: true, effective: { empty: 'explicit', flag: true } })
    expect(JSON.stringify(overridden)).not.toContain(canary)
    expect(await prepare({ count: 'wrong' })).toMatchObject({ ok: false, key: 'count' })
    await expect(prepare({}, 0)).rejects.toThrow('tool_version_conflict')
    expect(service.tasks.metadata()).toEqual([])
    const invalid = { ...structuredClone(def), enabled: false, status: 'draft' as const }
    invalid.tools[0]!.fields.push({
      key: 'path',
      schema: { type: 'string', minLength: 1, default: '' },
      required: true,
      aiVisible: true,
      value: null,
      binding: null,
    })
    const saved = (await service.tools.request({
      action: 'save',
      payload: { definition: invalid, expectedVersion: def.version },
    })) as CapabilityDefinition
    const changed = await enable(saved)
    expect(await prepare({}, changed.version)).toMatchObject({
      ok: false,
      key: 'path',
      requiredInputs: ['path'],
    })
    expect(await prepare({ path: 'ok' }, changed.version)).toMatchObject({
      ok: true,
      requiredInputs: ['path'],
    })
  })
  it('archives reversibly without erasing configuration, history, or active tasks, and requires fresh authorization', async () => {
    const def = await enable(
      await save(
        createCapabilityDefinition({
          kind: 'terminal',
          name: 'archiveReview',
          namespace: 'archiveReview',
          cwd: dir,
          command: `"${process.execPath}" -e "setTimeout(()=>console.log('retained'),250)"`,
        }),
      ),
    )
    const task = service.registry.startTask('archiveReview.run', {}, 'manual')
    const change = (action: string, current: typeof def) =>
      service.tools.request({
        action,
        payload: {
          id: current.id,
          expectedVersion: current.version,
          expectedUpdatedAt: current.updatedAt,
        },
      })
    const archived = (await change('archive', def)) as typeof def
    expect(archived).toMatchObject({ archived: true, enabled: false, status: 'disabled' })
    expect(service.registry.listAiTools().some((t) => t.name === 'archiveReview.run')).toBe(false)
    expect(service.registry.listUiCapabilities().find((t) => t.id === def.id)?.archived).toBe(true)
    expect(() => service.registry.startTask('archiveReview.run', {}, 'manual')).toThrow(
      'ai_tool_not_found_or_disabled',
    )
    await expect(enable(archived)).rejects.toThrow('tool_archived')
    await expect(change('restore', def)).rejects.toThrow('tool_version_conflict')
    expect(await service.tasks.wait(task.id)).toMatchObject({
      status: 'completed',
      stdout: 'retained\n',
    })
    const saved = (await service.tools.request({
      action: 'save',
      payload: {
        definition: { ...archived, archived: false },
        expectedVersion: archived.version,
      },
    })) as typeof def
    expect(saved.archived).toBe(true)
    const restored = (await change('restore', saved)) as typeof def
    expect(restored).toMatchObject({ archived: false, enabled: false, status: 'draft' })
    expect(restored.runner).toEqual(def.runner)
    expect(await service.tools.request({ action: 'task', payload: { id: task.id } })).toMatchObject(
      { status: 'completed' },
    )
    expect(service.registry.listAiTools().some((t) => t.name === 'archiveReview.run')).toBe(false)
    await enable(restored)
    expect(service.registry.listAiTools().some((t) => t.name === 'archiveReview.run')).toBe(true)
  })
  it('executes configured Shell commands with public defaults and keeps variable contents out of Shell syntax', async () => {
    const def = createCapabilityDefinition({
      kind: 'terminal',
      name: '变量命令',
      namespace: 'variables',
      cwd: dir,
    })
    if (def.runner.settings.type === 'terminal')
      def.runner.settings.command = `"${process.execPath}" -e "process.stdout.write(process.env.PROJECT)"`
    def.tools[0]!.fields = [
      {
        key: 'PROJECT',
        schema: { type: 'string', default: '默认项目', description: '项目名称' },
        required: false,
        aiVisible: true,
        value: null,
        binding: { location: 'argument', key: 'PROJECT' },
      },
    ]
    const active = await enable(await save(def))
    expect(
      deriveAiToolView(active, active.tools[0]!).inputSchema.properties?.PROJECT?.default,
    ).toBe('默认项目')
    expect(await service.registry.invoke('variables.run', {})).toMatchObject({
      stdout: '默认项目',
      exitCode: 0,
    })
    const text = '$(touch should-not-exist) ; " quoted'
    expect(await service.registry.invoke('variables.run', { PROJECT: text })).toMatchObject({
      stdout: text,
      exitCode: 0,
    })
    expect(fs.existsSync(path.join(dir, 'should-not-exist'))).toBe(false)
  })
  it('encodes Form and nested JSON Body, applies nested regex allow-lists, and exposes the filtered output structure', async () => {
    let received: unknown,
      contentType = ''
    const port = await listen(
      createServer(async (req, res) => {
        let body = ''
        for await (const chunk of req) body += String(chunk)
        contentType = String(req.headers['content-type'])
        received = contentType.includes('application/json')
          ? JSON.parse(body)
          : Object.fromEntries(new URLSearchParams(body))
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            data: {
              id: 42,
              name: 'Alice',
              private: 'secret',
              items: [{ code: 'A1', extra: 'secret' }, { code: 'wrong' }],
            },
            hidden: 'secret',
          }),
        )
      }),
    )
    const def = createCapabilityDefinition({
      kind: 'http',
      name: '表单请求',
      namespace: 'forms',
      url: `http://127.0.0.1:${port}`,
      method: 'POST',
    })
    if (def.runner.settings.type === 'http') {
      def.runner.settings.bodyMode = 'form'
      def.runner.settings.responseMode = 'json'
      def.runner.settings.responseFilter = {
        data: { id: '^\\d+$', name: '^Alice$', items: [{ code: '^A\\d$' }] },
      }
    }
    def.tools[0]!.fields = [
      {
        key: 'query',
        schema: { type: 'string', default: 'a & b' },
        required: false,
        aiVisible: true,
        value: null,
        binding: { location: 'body', key: 'query' },
      },
    ]
    const active = await enable(await save(def))
    expect(deriveAiToolView(active, active.tools[0]!).outputSchema.properties).toHaveProperty(
      'data',
    )
    expect(await service.registry.invoke('forms.request', {})).toEqual({
      data: { id: 42, name: 'Alice', items: [{ code: 'A1' }, {}] },
    })
    expect(contentType).toContain('application/x-www-form-urlencoded')
    expect(received).toEqual({ query: 'a & b' })
    const json = structuredClone(def)
    json.id = crypto.randomUUID()
    json.namespace = 'jsonBody'
    if (json.runner.settings.type === 'http') {
      json.runner.settings.bodyMode = 'json'
      json.runner.settings.body = { nested: { enabled: true } }
    }
    await enable(await save(json))
    await service.registry.invoke('jsonBody.request', { query: 'override' })
    expect(received).toEqual({ nested: { enabled: true }, query: 'override' })
    const invalid = structuredClone(def)
    invalid.id = crypto.randomUUID()
    if (invalid.runner.settings.type === 'http')
      invalid.runner.settings.responseFilter = { data: '[' }
    await expect(save(invalid)).rejects.toThrow('tool_config_invalid')
  })
  it('bounds pathological response regex in a worker instead of blocking Core', async () => {
    await expect(
      filterResponse({ text: 'a'.repeat(60000) + '!' }, { text: '^(a+)+$' }),
    ).rejects.toThrow('tool_response_filter_timeout')
    expect(await filterResponse({ text: 'hello', hidden: 'secret' }, { text: '^hello$' })).toEqual({
      text: 'hello',
    })
  })

  it('runs a minimal named Terminal without directory or Shell configuration and preserves explicit directory validation', async () => {
    const def = createCapabilityDefinition({
      kind: 'terminal',
      name: '开发助手',
      namespace: 'minimal',
    })
    if (def.runner.settings.type === 'terminal') {
      def.runner.settings.cwd = ''
      def.runner.settings.shell = ''
    }
    await enable(await save(def))
    const result = await service.registry.invoke('minimal.run', {
      command: `"${process.execPath}" -e "process.stdout.write(process.cwd())"`,
    })
    expect(result).toMatchObject({ stdout: fs.realpathSync(os.homedir()), exitCode: 0 })
    const invalid = createCapabilityDefinition({
      kind: 'terminal',
      name: 'explicitDirectory',
      namespace: 'explicit',
      cwd: path.join(dir, 'missing'),
    })
    await expect(enable(await save(invalid))).rejects.toThrow('tool_config_incomplete')
  })
  it('returns useful status and text for minimal HTTP configuration while redacting fixed credentials', async () => {
    const port = await listen(
      createServer((req, res) => res.end(`response ${req.headers.authorization}`)),
    )
    const def = createCapabilityDefinition({
      kind: 'http',
      name: '接口查询',
      namespace: 'minimalHttp',
      url: `http://127.0.0.1:${port}`,
    })
    if (def.runner.settings.type === 'http') {
      def.runner.settings.responseMode = 'text'
      def.runner.settings.fixedHeaders = { Authorization: canary }
    }
    def.tools[0]!.fields = []
    def.tools[0]!.outputSchema = {
      type: 'object',
      properties: { status: { type: 'integer' }, body: { type: 'string' } },
      additionalProperties: false,
    }
    const saved = await enable(await save(def))
    expect(await service.registry.invoke('minimalHttp.request', {})).toEqual({
      status: 200,
      body: 'response [已隐藏]',
    })
    const alternatePort = await listen(
      createServer((req, res) => res.end(`alternate ${req.method} ${req.headers.authorization}`)),
    )
    const manual = (await service.tools.request({
      action: 'run',
      payload: {
        name: 'minimalHttp.request',
        arguments: {},
        expectedVersion: saved.version,
        overrides: {
          settings: {
            ...saved.runner.settings,
            url: `http://127.0.0.1:${alternatePort}`,
            method: 'POST',
            fixedHeaders: { Authorization: 'MANUAL-HTTP-SECRET' },
          },
          fixedParameters: {},
        },
      },
    })) as ToolTask
    expect((await service.tasks.wait(manual.id)).result).toEqual({
      status: 200,
      body: 'alternate POST [已隐藏]',
    })
    expect(service.repository.getById(saved.id)).toEqual(saved)
    expect(await service.registry.invoke('minimalHttp.request', {})).toEqual({
      status: 200,
      body: 'response [已隐藏]',
    })
    expect(JSON.stringify(service.tasks.list())).not.toContain('MANUAL-HTTP-SECRET')
    expect(JSON.stringify(service.tasks.list())).not.toContain(canary)
  })
  it('authenticates complete definitions, preserves configuration, rejects stale saves and revokes new calls after editing', async () => {
    const url = `http://127.0.0.1:${service.port}/app/tools`
    expect(
      (await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'list' }) })).status,
    ).toBe(401)
    const def = createCapabilityDefinition({ kind: 'terminal', name: 'localTask', cwd: dir })
    if (def.runner.settings.type === 'terminal')
      def.runner.settings.environment = { SECRET: canary }
    const saved = await save(def)
    expect(await service.tools.request({ action: 'get', payload: { id: saved.id } })).toEqual(saved)
    const active = await enable(saved)
    const updated = (await service.tools.request({
      action: 'save',
      payload: {
        definition: { ...active, description: 'Changed' },
        expectedVersion: active.version,
      },
    })) as CapabilityDefinition
    expect(updated).toMatchObject({ enabled: false, status: 'draft', version: 2 })
    expect(() => service.registry.startTask('local.run', { command: 'echo no' }, 'manual')).toThrow(
      'ai_tool_not_found_or_disabled',
    )
    await expect(
      service.tools.request({ action: 'save', payload: { definition: saved, expectedVersion: 1 } }),
    ).rejects.toThrow('tool_version_conflict')
    const invalid = await fetch(url, {
      method: 'POST',
      headers: { [SESSION_TOKEN_HEADER]: token },
      body: JSON.stringify({
        action: 'save',
        payload: { definition: { runner: { settings: { secret: canary } } }, expectedVersion: 0 },
      }),
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).not.toContain(canary)
  })
  it('blocks incomplete configuration, reserved namespaces and conflicting public operations', async () => {
    const def = await save(
      createCapabilityDefinition({ kind: 'http', name: 'incomplete', url: '' }),
    )
    await expect(enable(def)).rejects.toThrow('tool_config_incomplete')
    const terminal = await save(
      createCapabilityDefinition({ kind: 'terminal', name: 'first', cwd: dir }),
    )
    await enable(terminal)
    const second = await save(
      createCapabilityDefinition({ kind: 'terminal', name: 'second', cwd: dir }),
    )
    await expect(enable(second)).rejects.toThrow('public_tool_name_conflict')
    const reserved = { ...terminal, id: 'another', namespace: 'Lumi' }
    await expect(save(reserved)).rejects.toThrow('reserved_tool_namespace')
  })
  it.skipIf(process.platform === 'win32')(
    'runs manual and real MCP client calls through the same configuration and bounded redacted tasks',
    async () => {
      const def = createCapabilityDefinition({
        kind: 'terminal',
        name: 'shellTask',
        namespace: 'shell',
        cwd: dir,
      })
      if (def.runner.settings.type === 'terminal')
        def.runner.settings.environment = { SECRET: canary }
      const enabled = await enable(await save(def))
      const task = service.registry.startTask(
        'shell.run',
        { command: 'printf "%s" "$SECRET"' },
        'manual',
      )
      const result = await service.tasks.wait(task.id)
      expect(result.events?.map((event) => event.message)).toEqual([
        '任务已创建',
        '命令进程已启动',
        '执行完成',
      ])
      expect(service.tasks.get(task.id).canRestart).toBe(true)
      expect(service.tasks.metadata(enabled.id)[0]?.events).toBeUndefined()
      expect(result).toMatchObject({
        status: 'completed',
        source: 'manual',
        version: enabled.version,
        stdout: '[已隐藏]',
      })
      const client = new Client({ name: 'tools-real-client', version: '1' })
      clients.push(client)
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.port}/mcp`), {
          requestInit: { headers: { [SESSION_TOKEN_HEADER]: token } },
        }),
      )
      const ai = await client.callTool({
        name: 'shell.run',
        arguments: { command: 'printf "AI executed"' },
      })
      expect(ai.isError).not.toBe(true)
      expect(ai.structuredContent).toMatchObject({ stdout: 'AI executed', exitCode: 0 })
      expect(service.tasks.list(enabled.id).map((t) => t.source)).toEqual(['ai', 'manual'])
      expect(JSON.stringify(service.tasks.list())).not.toContain(canary)
      const huge = service.registry.startTask(
        'shell.run',
        { command: 'yes X | head -c 200000' },
        'manual',
      )
      const limited = await service.tasks.wait(huge.id)
      expect(limited.truncated).toBe(true)
      expect(limited.stdout.length).toBeLessThanOrEqual(65536)
    },
  )
  it.skipIf(process.platform === 'win32')(
    'terminates descendants, keeps existing tasks after disable and records cancellation only after process exit',
    async () => {
      const def = await enable(
        await save(createCapabilityDefinition({ kind: 'terminal', name: 'treeTask', cwd: dir })),
      )
      const marker = path.join(dir, 'should-not-exist')
      const script = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive'),1200);setInterval(()=>{},1000)`
      const command = `'${process.execPath.replaceAll("'", "'\\''")}' -e '${script.replaceAll("'", "'\\''")}' & wait`
      const task = service.registry.startTask('local.run', { command }, 'manual')
      await new Promise((resolve) => setTimeout(resolve, 150))
      service.registry.disable(def.id, 'ui')
      expect(service.tasks.get(task.id).status).toBe('running')
      expect(service.tasks.stop(task.id).status).toBe('stopping')
      expect((await service.tasks.wait(task.id)).status).toBe('cancelled')
      await new Promise((resolve) => setTimeout(resolve, 1300))
      expect(fs.existsSync(marker)).toBe(false)
      expect(() => service.registry.startTask('local.run', { command: 'echo no' }, 'ai')).toThrow(
        'ai_tool_not_found_or_disabled',
      )
    },
  )
  it('binds HTTP inputs and fixed fields, clips nested responses, sanitizes echoes and reports timeout without retry', async () => {
    let calls = 0
    const port = await listen(
      createServer((req, res) => {
        calls++
        if (req.url === '/slow') {
          setTimeout(() => {
            res.end('{}')
          }, 500)
          return
        }
        expect(req.headers.authorization).toBe(canary)
        expect(req.url).toBe('/api/item-42?q=search')
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            ok: true,
            nested: { public: 'yes', private: canary },
            echo: canary,
            unlisted: 'hidden',
          }),
        )
      }),
    )
    const def = createCapabilityDefinition({
      kind: 'http',
      name: 'requestTask',
      namespace: 'http',
      url: `http://127.0.0.1:${port}/api/{id}`,
    })
    if (def.runner.settings.type === 'http')
      def.runner.settings.fixedHeaders = { Authorization: canary }
    def.tools[0]!.fields = [
      {
        key: 'id',
        schema: { type: 'string' },
        required: true,
        aiVisible: true,
        value: null,
        binding: { location: 'path', key: 'id' },
      },
      {
        key: 'q',
        schema: { type: 'string' },
        required: false,
        aiVisible: true,
        value: null,
        binding: { location: 'query', key: 'q' },
      },
    ]
    def.tools[0]!.outputSchema = {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        nested: { type: 'object', properties: { public: { type: 'string' } } },
        echo: { type: 'string' },
      },
      additionalProperties: false,
    }
    const active = await enable(await save(def))
    const output = await service.registry.invoke('http.request', { id: 'item-42', q: 'search' })
    expect(output).toEqual({ ok: true, nested: { public: 'yes' }, echo: '[已隐藏]' })
    expect(service.tasks.list(active.id)[0]?.events?.map((event) => event.message)).toEqual([
      '任务已创建',
      '开始发送请求',
      '收到响应（HTTP 200）',
      '响应读取完成',
      '执行完成',
    ])
    expect(calls).toBe(1)
    expect(JSON.stringify(service.tasks.list())).not.toContain(canary)
    const slow = structuredClone(active)
    slow.id = 'slow-http'
    slow.name = 'slow'
    slow.namespace = 'slow'
    if (slow.runner.settings.type === 'http') {
      slow.runner.settings.url = `http://127.0.0.1:${port}/slow`
      slow.runner.settings.timeoutMs = 100
      slow.runner.settings.fixedHeaders = {}
    }
    await enable(await save(slow))
    const task = service.registry.startTask('slow.request', { id: 'ignored' }, 'manual')
    const finished = await service.tasks.wait(task.id)
    expect(finished.status).toBe('timed_out')
    expect(finished.cancellationUncertain).toBe(true)
    expect(finished.events?.at(-1)?.message).toBe('执行超时')
    expect(calls).toBe(2)
  })
  it('discovers and invokes a real upstream HTTP MCP, preserves private bindings, and revokes changed catalogs before execution', async () => {
    let changed = false,
      calls = 0
    const upstreamTools = (): Tool[] => [
      {
        name: 'echo/input',
        description: 'Upstream echo',
        inputSchema: {
          type: 'object' as const,
          properties: { text: { type: 'string' as const }, secret: { type: 'string' as const } },
          required: ['text', 'secret'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object' as const,
          properties: { text: { type: 'string' as const }, secret: { type: 'string' as const } },
          required: ['text', 'secret'],
          additionalProperties: false,
        },
      },
      ...(changed
        ? [{ name: 'added', inputSchema: { type: 'object' as const, properties: {} } }]
        : []),
    ]
    const port = await listen(
      createServer((req, res) => {
        const server = new Server(
          { name: 'fixture-upstream', version: '1' },
          { capabilities: { tools: {} } },
        )
        server.setRequestHandler('tools/list', async () => ({ tools: upstreamTools() }))
        server.setRequestHandler('tools/call', async (r) => {
          calls++
          return {
            content: [{ type: 'text', text: 'echo' }],
            structuredContent: {
              text: String(r.params.arguments?.text),
              secret: String(r.params.arguments?.secret),
            },
          }
        })
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        res.once('close', () => void server.close())
        void server.connect(transport).then(() => transport.handleRequest(req, res))
      }),
    )
    const def = createCapabilityDefinition({
      kind: 'mcp',
      name: 'upstream',
      namespace: 'remote',
      transport: 'streamable-http',
      url: `http://127.0.0.1:${port}/mcp`,
    })
    const operations = (await service.tools.request({
      action: 'discover',
      payload: { definition: def },
    })) as CapabilityTool[]
    expect(operations[0]!.upstreamName).toBe('echo/input')
    expect(operations[0]!.upstreamSignature).toBeTruthy()
    if (def.runner.settings.type === 'mcp') {
      def.runner.settings.toolName = 'missing-tool'
      await expect(
        service.tools.request({ action: 'discover', payload: { definition: def } }),
      ).rejects.toThrow('tool_config_incomplete')
      def.runner.settings.toolName = 'echo/input'
      expect(
        (await service.tools.request({
          action: 'discover',
          payload: { definition: def },
        })) as CapabilityTool[],
      ).toHaveLength(1)
      def.runner.settings.toolName = undefined
    }

    operations[0]!.fields[1] = {
      ...operations[0]!.fields[1]!,
      aiVisible: false,
      required: false,
      value: canary,
    }
    operations[0]!.outputSchema = {
      type: 'object',
      properties: { text: { type: 'string' } },
      additionalProperties: false,
    }
    def.tools = operations
    const saved = await enable(await save(def))
    const publicView = deriveAiToolView(saved, saved.tools[0]!)
    expect(publicView.inputSchema.properties).not.toHaveProperty('secret')
    expect(await service.registry.invoke(publicView.name, { text: 'hello' })).toEqual({
      text: 'hello',
    })
    expect(service.tasks.list(saved.id)[0]?.events?.map((event) => event.message)).toEqual([
      '任务已创建',
      '正在获取服务连接',
      '服务连接已就绪，开始校验操作',
      '操作校验通过，开始调用',
      '已收到操作结果',
      '执行完成',
    ])
    expect(calls).toBe(1)
    changed = true
    const task = service.registry.startTask(publicView.name, { text: 'never run' }, 'manual')
    expect((await service.tasks.wait(task.id)).error).toBe('tool_mcp_changed')
    expect(calls).toBe(1)
    expect(service.repository.getById(saved.id)?.enabled).toBe(false)
  })
  it('discovers and executes a real stdio upstream without exposing fixed environment', async () => {
    const file = path.join(dir, 'upstream.cjs')
    fs.writeFileSync(
      file,
      `const rl=require('node:readline').createInterface({input:process.stdin});
const tool={name:'echo',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}};
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result;if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture-stdio',version:'1'}};else if(m.method==='tools/list')result={tools:[tool,{...tool,name:'ignored'}]};else if(m.method==='tools/call')result={content:[{type:'text',text:'stdio'}],structuredContent:{text:(process.env.SECRET===${JSON.stringify(canary)}?'stdio ':'changed ')+process.env.SECRET}};else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`,
    )
    const def = createCapabilityDefinition({
      kind: 'mcp',
      name: 'stdioTool',
      namespace: 'stdio',
      command: process.execPath,
      args: [file],
    })
    if (def.runner.settings.type === 'mcp') {
      def.runner.settings.environment = { SECRET: canary }
      def.runner.settings.toolName = 'echo'
    }
    def.tools = (await service.tools.request({
      action: 'discover',
      payload: { definition: def },
    })) as CapabilityTool[]
    const saved = await enable(await save(def))
    expect(await service.registry.invoke('stdio.echo', {})).toEqual({ text: 'stdio [已隐藏]' })
    const manual = (await service.tools.request({
      action: 'run',
      payload: {
        name: 'stdio.echo',
        arguments: {},
        expectedVersion: saved.version,
        overrides: {
          settings: { ...saved.runner.settings, environment: { SECRET: 'MANUAL-MCP-SECRET' } },
          fixedParameters: {},
        },
      },
    })) as ToolTask
    expect((await service.tasks.wait(manual.id)).result).toEqual({ text: 'changed [已隐藏]' })
    expect(await service.registry.invoke('stdio.echo', {})).toEqual({ text: 'stdio [已隐藏]' })
    expect(service.repository.getById(saved.id)).toEqual(saved)
    expect(JSON.stringify(service.tasks.list())).not.toContain('MANUAL-MCP-SECRET')
    expect(JSON.stringify(service.tasks.list())).not.toContain(canary)
  })
  it.skipIf(process.platform === 'win32')(
    'starts background tasks for AI, exposes safe live logs, and restarts only the same enabled version',
    async () => {
      const def = createCapabilityDefinition({
        kind: 'terminal',
        name: 'background',
        namespace: 'background',
        cwd: dir,
      })
      def.tools.push({
        ...structuredClone(def.tools[0]!),
        name: 'start',
        outputSchema: {
          type: 'object',
          properties: { taskId: { type: 'string' }, status: { type: 'string' } },
        },
      })
      const active = await enable(await save(def))
      const output = await service.registry.invoke('background.start', {
        command: 'printf "started\\n"; sleep 30',
      })
      const id = output.taskId as string
      await expect.poll(() => service.tasks.get(id).stdout).toBe('started\n')
      expect(service.tasks.get(id)).toMatchObject({
        status: 'running',
        stdout: 'started\n',
        source: 'ai',
      })
      service.tasks.stop(id)
      await service.tasks.wait(id)
      const restarted = service.registry.restartTask(id, 'manual')
      expect(restarted.source).toBe('manual')
      service.tasks.stop(restarted.id)
      await service.tasks.wait(restarted.id)
      service.repository.saveDraft(active)
      expect(() => service.registry.restartTask(id, 'manual')).toThrow(
        'ai_tool_not_found_or_disabled',
      )
    },
  )
  it.skipIf(process.platform === 'win32')(
    'uses editable manual settings and fixed values only for this run and its same-session replay',
    async () => {
      const def = createCapabilityDefinition({
        kind: 'terminal',
        name: 'manual',
        namespace: 'manual',
        cwd: dir,
        command: 'printf "saved"',
      })
      def.tools[0]!.fields = [
        {
          key: 'SECRET',
          schema: { type: 'string' },
          required: false,
          aiVisible: false,
          value: canary,
          binding: null,
        },
        {
          key: 'COUNT',
          schema: { type: 'integer', default: 1 },
          required: true,
          aiVisible: true,
          value: null,
          binding: null,
        },
      ]
      const saved = await enable(await save(def))
      const settings = {
        ...saved.runner.settings,
        cwd: os.tmpdir(),
        command: 'printf "%s|%s|%s" "$PWD" "$COUNT" "$SECRET"',
      }
      const overrides = { settings, fixedParameters: { SECRET: 'NEW-MANUAL-SECRET' } }
      const payload = {
        name: 'manual.run',
        arguments: { COUNT: 0 },
        expectedVersion: saved.version,
        overrides,
      }
      expect(await service.tools.request({ action: 'prepare', payload })).toMatchObject({
        ok: true,
        effective: { COUNT: 0 },
      })
      expect(
        await service.tools.request({
          action: 'prepare',
          payload: {
            ...payload,
            overrides: {
              settings: { ...settings, cwd: path.join(dir, 'missing') },
              fixedParameters: {},
            },
          },
        }),
      ).toMatchObject({ ok: false, key: 'runner.cwd' })
      expect(
        await service.tools.request({
          action: 'prepare',
          payload: { ...payload, overrides: { settings, fixedParameters: { SECRET: 3 } } },
        }),
      ).toMatchObject({ ok: false, key: 'SECRET' })
      const task = (await service.tools.request({ action: 'run', payload })) as ToolTask
      const finished = await service.tasks.wait(task.id)
      expect(finished.status).toBe('completed')
      expect(finished.stdout).toContain('|0|[已隐藏]')
      expect(finished.stdout).not.toContain('NEW-MANUAL-SECRET')
      expect(service.repository.getById(saved.id)).toEqual(saved)
      const restarted = (await service.tools.request({
        action: 'restart',
        payload: { id: task.id },
      })) as ToolTask
      expect((await service.tasks.wait(restarted.id)).stdout).toBe(finished.stdout)
      expect(() => service.registry.restartTask(task.id, 'ai')).toThrow('tool_request_invalid')
      const regular = service.registry.startTask('manual.run', {}, 'ai')
      expect((await service.tasks.wait(regular.id)).stdout).toBe('saved')
      await expect(
        service.tools.request({
          action: 'run',
          payload: { ...payload, expectedVersion: saved.version + 1 },
        }),
      ).rejects.toThrow('tool_version_conflict')
      await expect(
        service.tools.request({
          action: 'run',
          payload: { ...payload, overrides: { settings, fixedParameters: { COUNT: 2 } } },
        }),
      ).rejects.toThrow('invalid_tool_arguments')
      await expect(
        service.tools.request({
          action: 'run',
          payload: { ...payload, overrides: { settings, fixedParameters: { SECRET: 3 } } },
        }),
      ).rejects.toThrow('tool_config_incomplete')
      expect(JSON.stringify(service.tasks.list())).not.toContain('NEW-MANUAL-SECRET')
    },
  )
  it('recovers persisted results, marks orphaned running tasks interrupted and prevents replay after restart', async () => {
    const task: ToolTask = {
      id: 'orphan',
      capabilityId: 'tool',
      capabilityName: 'tool',
      operation: 'local.run',
      version: 1,
      runnerType: 'terminal',
      source: 'manual',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
      stdout: 'safe logs',
      stderr: '',
      truncated: false,
      cancellationUncertain: false,
    }
    service.database.raw
      .prepare('INSERT INTO tool_tasks VALUES(?,?,?,?)')
      .run(task.id, task.capabilityId, task.startedAt, JSON.stringify(task))
    const manager = new TaskManager(service.database.raw, new McpConnections(() => {}))
    expect(manager.get('orphan')).toMatchObject({ status: 'interrupted', stdout: 'safe logs' })
    expect(() => manager.restartInput('orphan')).toThrow('task_restart_unavailable')
    await manager.close()
  })
})
