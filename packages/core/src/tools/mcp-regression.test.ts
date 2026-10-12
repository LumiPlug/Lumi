// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  createCapabilityDefinition,
  deriveAiToolView,
  SESSION_TOKEN_HEADER,
} from '@lumiplug/shared'
import type { CapabilityDefinition, CapabilityTool, JsonObject, JsonSchema } from '@lumiplug/shared'
import { CoreService } from '../service'
import { McpConnections } from './mcp'
import { applyMigrations } from '../db/migrations'

const token = 'regression-session-fixture-0123456789'
let service: CoreService, dir: string
const servers: HttpServer[] = [],
  clients: Client[] = []
const closed = { type: 'object', properties: {}, additionalProperties: false }
const textOutput: JsonSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  additionalProperties: false,
}
const fixture = String.raw`
const readline=require('node:readline'),fs=require('node:fs'),mode=process.argv[2],ledger=process.argv[3];
const closed={type:'object',properties:{},additionalProperties:false},output={type:'object',properties:{text:{type:'string'}},additionalProperties:false};
let tools=mode==='concurrent'?['fail','slow'].map(name=>({name,inputSchema:closed,outputSchema:output})):[{name:'echo',inputSchema:closed,...(mode==='result'?{}:{outputSchema:output})}];
if(mode==='constraints')tools=[{name:'echo',inputSchema:{type:'object',properties:{a:{type:'string'},b:{type:'string'},flag:{type:'boolean'}},dependentRequired:{a:['b']},if:{properties:{flag:{const:true}},required:['flag']},then:{required:['a']},minProperties:1,additionalProperties:false},outputSchema:output}];
if(mode==='private')tools=[{name:'echo',description:'ordinary upstream text',inputSchema:{type:'object',properties:{message:{type:'string',default:'public'},secret:{type:'string',description:'hidden-description-only'}},required:['message','secret'],dependentRequired:{message:['secret']},additionalProperties:false},outputSchema:output}];
const send=(id,result)=>{if(!process.stdout.destroyed)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n')};process.stdout.on('error',()=>process.exit(0));
const rl=readline.createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
if(m.method==='initialize')return send(m.id,{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'trusted regression',version:'1'}});
if(m.method==='tools/list'){if(mode==='paged'){const page=Number(m.params?.cursor||1);fs.appendFileSync(ledger,JSON.stringify({page})+'\n');return setTimeout(()=>send(m.id,page===35?{tools}:{tools:[],nextCursor:String(page+1)}),25)}return send(m.id,{tools})}
if(m.method==='tools/call'){fs.appendFileSync(ledger,JSON.stringify({call:m.params.name,mergedPrivate:typeof m.params.arguments?.secret==='string'})+'\n');return setTimeout(()=>send(m.id,m.params.name==='fail'?{isError:true,content:[{type:'text',text:'expected business failure'}]}:{content:[{type:'text',text:'raw text'}],structuredContent:mode==='result'?{answer:42,count:0,ok:false,items:[1,{nested:'kept'}]}:{text:mode==='private'?m.params.arguments.secret+' '+process.env.DUMMY_PRIVATE_ENV:'success'}}),m.params.name==='fail'?30:m.params.name==='slow'?220:10)}send(m.id,{})});rl.on('close',()=>process.exit(0));`

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-mcp-regression-'))
  fs.writeFileSync(path.join(dir, 'fixture.cjs'), fixture)
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
async function ready(mode: string): Promise<CapabilityDefinition> {
  const d = createCapabilityDefinition({
    kind: 'mcp',
    name: mode,
    namespace: mode,
    transport: 'stdio',
    command: process.execPath,
    args: [path.join(dir, 'fixture.cjs'), mode, path.join(dir, 'ledger')],
  })
  d.tools = (await service.tools.request({
    action: 'discover',
    payload: { definition: d },
  })) as CapabilityTool[]
  service.repository.saveDraft(d)
  service.registry.enable(d.id, 'ui')
  return service.repository.getById(d.id)!
}
async function listen(s: HttpServer) {
  servers.push(s)
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))
  const address = s.address()
  if (!address || typeof address === 'string') throw new Error('address')
  return address.port
}

describe('MCP regression: isolation, schemas and cancellation', () => {
  it('does not close a shared client after a tool business error', async () => {
    const d = await ready('concurrent')
    const a = service.registry.startTask('concurrent.fail', {}, 'manual')
    const b = service.registry.startTask('concurrent.slow', {}, 'manual')
    const [fail, slow] = await Promise.all([service.tasks.wait(a.id), service.tasks.wait(b.id)])
    expect(fail.error).toBe('tool_mcp_failed')
    expect(slow.status).toBe('completed')
    expect(slow.result).toEqual({ text: 'success' })
    const again = service.registry.startTask('concurrent.slow', {}, 'manual')
    expect((await service.tasks.wait(again.id)).status).toBe('completed')
    expect(d.tools).toHaveLength(2)
  })
  it('cancels one connected call without closing the connection for another caller', async () => {
    await ready('concurrent')
    const first = service.registry.startTask('concurrent.slow', {}, 'manual')
    const second = service.registry.startTask('concurrent.slow', {}, 'manual')
    await expect
      .poll(() => fs.readFileSync(path.join(dir, 'ledger'), 'utf8').trim().split('\n').length)
      .toBe(2)
    service.tasks.stop(first.id)
    expect((await service.tasks.wait(first.id)).status).toBe('cancelled')
    expect((await service.tasks.wait(second.id)).result).toEqual({ text: 'success' })
  })
  it('retains a structured result with no upstream outputSchema, including false, zero and nested values', async () => {
    const d = await ready('result')
    expect(d.tools[0]!.upstreamOutputSchemaMissing).toBe(true)
    const task = service.registry.startTask('result.echo', {}, 'manual')
    const done = await service.tasks.wait(task.id)
    expect(done.status).toBe('completed')
    expect(done.result).toEqual({ answer: 42, count: 0, ok: false, items: [1, { nested: 'kept' }] })
  })
  it('preserves root dependencies and conditionals in discovery, preflight and execution', async () => {
    const d = await ready('constraints')
    expect(d.tools[0]!.upstreamInputSchema?.dependentRequired).toEqual({ a: ['b'] })
    expect(deriveAiToolView(d, d.tools[0]!).inputSchema.dependentRequired).toEqual({ a: ['b'] })
    for (const args of [{ a: 'yes' }, { flag: true }, {}] as JsonObject[]) {
      expect(service.registry.prepareTask('constraints.echo', args).ok).toBe(false)
      expect(() => service.registry.startTask('constraints.echo', args, 'manual')).toThrow(
        'invalid_tool_arguments',
      )
    }
    expect(service.tasks.list(d.id)).toEqual([])
    const good = service.registry.startTask(
      'constraints.echo',
      { a: 'yes', b: 'yes', flag: true },
      'manual',
    )
    expect((await service.tasks.wait(good.id)).status).toBe('completed')
  })
  it('keeps explicitly hidden fields/configuration out of the catalog, merges them internally and redacts results and task logs', async () => {
    const d = await ready('private')
    const privateValue = 'HIDDEN-DUMMY-VALUES-2319',
      environmentValue = 'PRIVATE-ENV-DUMMY-729'
    const hidden = d.tools[0]!.fields.find((f) => f.key === 'secret')!
    hidden.required = false
    hidden.aiVisible = false
    hidden.value = privateValue
    if (d.runner.settings.type !== 'mcp') throw new Error('fixture')
    d.runner.settings.environment = { DUMMY_PRIVATE_ENV: environmentValue }
    service.repository.saveDraft(d)
    service.registry.enable(d.id, 'ui')
    const pub = service.registry.listAiTools().find((t) => t.name === 'private.echo')!
    for (const value of [
      privateValue,
      environmentValue,
      'hidden-description-only',
      'secret',
      'DUMMY_PRIVATE_ENV',
    ])
      expect(JSON.stringify(pub)).not.toContain(value)
    expect(service.registry.prepareTask('private.echo', {}).ok).toBe(true)
    expect(() => service.registry.startTask('private.echo', { secret: 'override' }, 'ai')).toThrow(
      'invalid_tool_arguments',
    )
    const task = service.registry.startTask('private.echo', {}, 'ai'),
      done = await service.tasks.wait(task.id)
    expect(done.status).toBe('completed')
    expect(done.result).toEqual({ text: '[已隐藏] [已隐藏]' })
    for (const value of [privateValue, environmentValue])
      expect(JSON.stringify(done)).not.toContain(value)
    expect(fs.readFileSync(path.join(dir, 'ledger'), 'utf8')).toContain('"mergedPrivate":true')
  })
  it('stops directory pagination immediately instead of finishing every page', async () => {
    const d = await ready('paged')
    fs.writeFileSync(path.join(dir, 'ledger'), '')
    const task = service.registry.startTask('paged.echo', {}, 'manual')
    await expect.poll(() => fs.readFileSync(path.join(dir, 'ledger'), 'utf8')).toContain('"page":1')
    const before = Date.now()
    service.tasks.stop(task.id)
    const done = await service.tasks.wait(task.id)
    expect(done.status).toBe('cancelled')
    expect(Date.now() - before).toBeLessThan(500)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(
      fs.readFileSync(path.join(dir, 'ledger'), 'utf8').trim().split('\n').length,
    ).toBeLessThan(35)
    expect(service.repository.getById(d.id)?.enabled).toBe(true)
  })
  it('cancels a sole pending connection, but keeps a shared connection for the remaining caller', async () => {
    let delayed = false,
      initialized = 0
    const upstream = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let raw = ''
      for await (const chunk of req) raw += chunk
      const m = JSON.parse(raw)
      const send = (result: unknown) => {
        if (!res.destroyed) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }))
        }
      }
      if (m.method === 'initialize') {
        initialized++
        return setTimeout(
          () =>
            send({
              protocolVersion: m.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'trusted delayed', version: '1' },
            }),
          delayed ? 250 : 0,
        )
      }
      if (m.id === undefined) {
        res.writeHead(202)
        return res.end()
      }
      if (m.method === 'tools/list')
        return send({ tools: [{ name: 'echo', inputSchema: closed, outputSchema: textOutput }] })
      return send({
        content: [{ type: 'text', text: 'success' }],
        structuredContent: { text: 'success' },
      })
    })
    const port = await listen(upstream)
    const d = createCapabilityDefinition({
      kind: 'mcp',
      name: 'delayed',
      namespace: 'delayed',
      transport: 'streamable-http',
      url: `http://127.0.0.1:${port}`,
    })
    const manager = new McpConnections(() => {})
    try {
      d.tools = await manager.discover(d)
      delayed = true
      const single = new AbortController(),
        start = initialized
      const cancelled = manager.call(d, d.tools[0]!, {}, single.signal).catch(() => 'cancelled')
      await expect.poll(() => initialized).toBeGreaterThan(start)
      const at = Date.now()
      single.abort()
      expect(await cancelled).toBe('cancelled')
      expect(Date.now() - at).toBeLessThan(200)
      const a = new AbortController(),
        b = new AbortController(),
        before = initialized
      const first = manager.call(d, d.tools[0]!, {}, a.signal).catch(() => 'cancelled')
      const second = manager.call(d, d.tools[0]!, {}, b.signal)
      await expect.poll(() => initialized).toBeGreaterThan(before)
      a.abort()
      expect(await first).toBe('cancelled')
      expect(await second).toEqual({ text: 'success' })
      expect(initialized - before).toBe(1)
    } finally {
      await manager.close()
    }
  })
  it('propagates external MCP cancellation into the foreground HTTP Runner', async () => {
    let started = false,
      closedEarly = false
    const target = createServer((_req, res) => {
      started = true
      let completed = false
      res.once('close', () => {
        if (!completed) closedEarly = true
      })
      setTimeout(() => {
        completed = true
        if (!res.destroyed) {
          res.writeHead(200)
          res.end('fixture')
        }
      }, 1500)
    })
    const port = await listen(target)
    const d = createCapabilityDefinition({
      kind: 'http',
      name: 'cancel',
      namespace: 'cancel',
      url: `http://127.0.0.1:${port}`,
    })
    d.tools[0]!.fields = []
    service.repository.saveDraft(d)
    service.registry.enable(d.id, 'ui')
    const client = new Client({ name: 'cancel regression', version: '1' })
    clients.push(client)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.port}/mcp`), {
        requestInit: { headers: { [SESSION_TOKEN_HEADER]: token } },
      }),
    )
    const controller = new AbortController()
    const pending = client
      .callTool({ name: 'cancel.request', arguments: {} }, { signal: controller.signal })
      .catch(() => 'cancelled')
    await expect.poll(() => started).toBe(true)
    controller.abort()
    expect(await pending).toBe('cancelled')
    await expect
      .poll(() => service.tasks.list(d.id)[0]?.status, { timeout: 1000 })
      .toBe('cancelled')
    expect(service.tasks.list(d.id)[0]?.cancellationUncertain).toBe(true)
    await expect.poll(() => closedEarly).toBe(true)
  })
  it('requires review of ambiguous legacy text schemas without dispatching or changing saved configuration', async () => {
    const d = await ready('result')
    delete d.tools[0]!.upstreamOutputSchemaMissing
    delete d.tools[0]!.upstreamInputSchema
    d.tools[0]!.outputSchema = structuredClone(textOutput)
    service.repository.saveDraft(d)
    service.registry.enable(d.id, 'ui')
    const saved = JSON.stringify(service.repository.getById(d.id))
    const task = service.registry.startTask('result.echo', {}, 'manual')
    const done = await service.tasks.wait(task.id)
    expect(done.status).toBe('failed')
    expect(done.error).toBe('tool_mcp_schema_refresh_required')
    expect(fs.existsSync(path.join(dir, 'ledger'))).toBe(false)
    expect(JSON.stringify(service.repository.getById(d.id))).toBe(saved)
  })
  it('preserves an explicit legacy and new output allow-list without upstream outputSchema', async () => {
    for (const legacy of [true, false]) {
      const d = await ready('result')
      if (legacy) delete d.tools[0]!.upstreamOutputSchemaMissing
      d.tools[0]!.outputSchema = {
        type: 'object',
        properties: { answer: { type: 'integer' } },
        additionalProperties: false,
      }
      service.repository.saveDraft(d)
      service.registry.enable(d.id, 'ui')
      const task = service.registry.startTask('result.echo', {}, 'manual')
      const done = await service.tasks.wait(task.id)
      expect(done.status).toBe('completed')
      expect(done.result).toEqual({ answer: 42 })
      service.registry.disable(d.id, 'ui')
    }
  })
  it('checks actual root constraints for legacy caches before dispatch', async () => {
    const d = await ready('constraints')
    delete d.tools[0]!.upstreamInputSchema
    service.repository.saveDraft(d)
    service.registry.enable(d.id, 'ui')
    expect(service.registry.prepareTask('constraints.echo', { a: 'yes' }).ok).toBe(true)
    const task = service.registry.startTask('constraints.echo', { a: 'yes' }, 'manual')
    expect((await service.tasks.wait(task.id)).error).toBe('invalid_tool_arguments')
    expect(fs.existsSync(path.join(dir, 'ledger'))).toBe(false)
  })
  it('upgrades a prior schema database additively without changing settings or output rules', async () => {
    const d = await ready('result'),
      db = service.database.raw
    const before = service.repository.getById(d.id)!
    db.exec(
      'ALTER TABLE capability_tools DROP COLUMN upstream_input_schema_json; ALTER TABLE capability_tools DROP COLUMN upstream_output_schema_missing; DELETE FROM schema_migrations WHERE id=9;',
    )
    applyMigrations(db)
    applyMigrations(db)
    const after = service.repository.getById(d.id)!
    expect(after.runner).toEqual(before.runner)
    expect(after.tools[0]!.fields).toEqual(before.tools[0]!.fields)
    expect(after.tools[0]!.outputSchema).toEqual(before.tools[0]!.outputSchema)
    expect(after.tools[0]!.upstreamInputSchema).toBeUndefined()
    expect(after.tools[0]!.upstreamOutputSchemaMissing).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id=9').get()).toEqual({
      n: 1,
    })
  })
  it('does not cancel unrelated calls when stateless clients reuse an ambiguous request ID', async () => {
    let started = 0
    const target = createServer((_req, res) => {
      started++
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{}')
        }
      }, 600)
    })
    const port = await listen(target)
    const d = createCapabilityDefinition({
      kind: 'http',
      name: 'collision',
      namespace: 'collision',
      url: `http://127.0.0.1:${port}`,
    })
    d.tools[0]!.fields = []
    service.repository.saveDraft(d)
    service.registry.enable(d.id, 'ui')
    const post = (body: object) =>
      fetch(`http://127.0.0.1:${service.port}/mcp`, {
        method: 'POST',
        headers: {
          [SESSION_TOKEN_HEADER]: token,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify(body),
      })
    const body = {
      jsonrpc: '2.0',
      id: 'same',
      method: 'tools/call',
      params: { name: 'collision.request', arguments: {} },
    }
    const first = post(body),
      second = post(body)
    await expect.poll(() => started).toBe(2)
    const cancelled = await post({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'same' },
    })
    expect(cancelled.status).toBe(202)
    expect(service.tasks.list(d.id).map((t) => t.status)).toEqual(['running', 'running'])
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    expect(service.tasks.list(d.id).map((t) => t.status)).toEqual(['completed', 'completed'])
  })
})
