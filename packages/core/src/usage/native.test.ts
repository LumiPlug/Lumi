// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeUsageSoftwareIds, allUsageSoftwareIds } from '@lumiplug/shared'
import { CoreDatabase } from '../db/database'
import { UsageCollector } from './collector'
import { NativeUsageCollector, nativeUsageRoots } from './native'
import { nativeRecord, parseNativeLine } from './native-adapters'
import { UsageService } from './service'
import * as discovery from './discovery'

const at = '2026-10-18T03:00:00.000Z'
const period = { start: '2026-10-18T00:00:00Z', end: '2026-10-19T00:00:00Z', timezone: 'UTC' }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-native-usage-')))
  cleanups.push(() => fs.rm(home, { recursive: true, force: true }))
  const roots = nativeUsageRoots(home)
  const collector = new UsageCollector(undefined, roots)
  const providers = (await collector.providers()).filter((provider) =>
    (nativeUsageSoftwareIds as readonly string[]).includes(provider.name),
  )
  vi.spyOn(collector, 'providers').mockResolvedValue(providers)
  const database = new CoreDatabase(':memory:')
  const service = new UsageService(database.raw, undefined, collector)
  cleanups.unshift(async () => {
    await service.close()
    database.close()
  })
  async function write(software: string, name: string, rows: unknown[]) {
    const root = roots.find((root) => root.software === software)!
    const filename = path.join(root.directory, name)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    return filename
  }
  return { home, roots, collector, database, service, write }
}
function buddy(id = 'request', type = 'function_call', usage: Record<string, unknown> = {}) {
  return {
    type,
    id: `row-${id}`,
    sessionId: 'session',
    timestamp: Date.parse(at),
    providerData: {
      messageId: id,
      conversationRequestId: 'same-turn',
      model: 'fixture-model',
      rawUsage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_cache_hit_tokens: 70,
        prompt_cache_write_tokens: 0,
        cached_tokens: 0,
        cache_read_input_tokens: 0,
        completion_thinking_tokens: 5,
        ...usage,
      },
    },
    message: { content: 'PRIVATE_RESPONSE' },
    arguments: 'PRIVATE_TOOL_ARGUMENTS',
  }
}
function work(id = 'request', output = 20) {
  return {
    type: 'assistant',
    sessionId: 'session',
    timestamp: at,
    message: {
      id,
      model: 'fixture-model',
      content: 'PRIVATE_RESPONSE',
      usage: {
        input_tokens: 30,
        output_tokens: output,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 5,
      },
    },
  }
}
function qwen(id = 'request', type = 'model.response.completed') {
  return {
    type,
    request_id: id,
    ts: at,
    data: {
      model: 'fixture-model',
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 70,
      cache_creation_input_tokens: 5,
    },
  }
}
async function qoderDb(filename: string) {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE chat_message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, gmt_create INTEGER, token_info TEXT, model_info TEXT, content TEXT);
    CREATE TABLE chat_session (session_id TEXT, session_title TEXT);`)
  db.prepare('INSERT INTO chat_session VALUES (?,?)').run('session', 'Explicit title')
  const insert = (id: string) =>
    db
      .prepare('INSERT INTO chat_message VALUES (?,?,?,?,?,?,?)')
      .run(
        id,
        'session',
        'assistant',
        Date.parse(at),
        JSON.stringify({ prompt_tokens: 100, completion_tokens: 20, cached_tokens: 70 }),
        JSON.stringify({ model_key: 'fixture-model' }),
        'PRIVATE_DB_BODY',
      )
  insert('first')
  return { db, insert }
}
describe('four local sources in the Lumi pipeline', () => {
  it('adds exactly four native readers alongside the upstream registry; Qwen remains separate', async () => {
    const providers = await new UsageCollector(undefined, []).providers()
    expect(providers.map((provider) => provider.name).sort()).toEqual([...allUsageSoftwareIds].sort())
    expect(providers).toHaveLength(47)
    expect(
      providers.filter((provider) => ['qwen', 'qwenwork'].includes(provider.name)),
    ).toHaveLength(2)
  })
  it('normalizes cache subsets, exclusive input, missing cache, invalid values and zero gates', () => {
    expect(nativeRecord('qoder', 'a:b', 'c', at, 'model', {})?.id).not.toBe(
      nativeRecord('qoder', 'a', 'b:c', at, 'model', {})?.id,
    )
    expect(
      nativeRecord('qoder', 's', 'm', at, 'model', {
        prompt_tokens: 100,
        completion_tokens: 20,
        cached_tokens: 70,
      }),
    ).toMatchObject({
      input: 30,
      output: 20,
      cacheRead: 70,
      cacheWrite: null,
      total: 120,
      inputIncludesCache: false,
    })
    expect(
      nativeRecord('qoder', 's', 'm', at, 'model', {
        prompt_tokens: 100,
        completion_tokens: 20,
      }),
    ).toMatchObject({ input: 100, cacheRead: null, total: 120, inputIncludesCache: true })
    expect(
      nativeRecord('qoder', 's', 'm', at, 'model', {
        prompt_tokens: 100,
        completion_tokens: 20,
        cached_tokens: 200,
      }),
    ).toMatchObject({ input: 100, cacheRead: null, total: 120 })
    for (const software of ['qoderwork', 'qwenwork'] as const) {
      expect(
        nativeRecord(software, 's', 'm', at, 'model', {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
      ).toMatchObject({ quality: 'missing', input: null, output: null, total: null })
    }
    expect(
      nativeRecord('qoderwork', 's', 'm', at, 'model', { input_tokens: -1, output_tokens: NaN }),
    ).toMatchObject({ input: null, output: null, total: null })
    expect(nativeRecord('qoder', 's', 'm', 'bad', 'model', {})).toBeNull()
  })
  it('accepts current function_call and legacy assistant messages; ignores user and tool-only records', () => {
    for (const type of ['function_call', 'message']) {
      expect(
        parseNativeLine(
          'workbuddy',
          { ...buddy('request', type), role: 'assistant' },
          '/session.jsonl',
        ).record,
      ).toMatchObject({ input: 30, output: 20, cacheRead: 70, total: 120 })
    }
    expect(
      parseNativeLine('workbuddy', { ...buddy(), role: 'user' }, '/session.jsonl').record,
    ).toBeUndefined()
    expect(
      parseNativeLine('workbuddy', { type: 'function_call', id: 'tool' }, '/session.jsonl').record,
    ).toBeUndefined()
  })
  it('flows all four sources through totals, models, sessions, paged details and CSV without raw content', async () => {
    const { service, roots, write, database } = await setup()
    await write('workbuddy', 'project/session.jsonl', [
      buddy('a'),
      buddy('b'),
      buddy('a', 'message'),
    ])
    await write('qoderwork', 'project/session.jsonl', [
      { type: 'user', message: { content: 'PRIVATE_PROMPT' } },
      work('a', 5),
      work('a', 20),
      { type: 'custom-title', sessionId: 'session', customTitle: 'Work title' },
    ])
    await write('qwenwork', 'session/segments/first.jsonl', [qwen(), qwen('turn', 'turn.finished')])
    await write('qwenwork', 'session/segments/replayed.jsonl', [qwen()])
    await write('qwenwork', 'session/other.jsonl', [qwen('unrelated')])
    const qoder = await qoderDb(roots.find((root) => root.software === 'qoder')!.directory)
    try {
      await service.scan()
      const report = service.query({ ...period, granularity: 'hour', detectedOnly: true })
      expect(report.matched).toBe(5)
      expect(report.totals).toMatchObject({
        input: 150,
        output: 100,
        cacheRead: 350,
        cacheWrite: 10,
        total: 610,
        inputIncludesCache: false,
      })
      expect(report.sources.map((source) => source.state)).toEqual([
        'ready',
        'ready',
        'ready',
        'ready',
      ])
      expect(report.models).toHaveLength(4)
      expect(report.hourly).toHaveLength(4)
      const sessions = service.querySessions(period)
      expect(sessions.matched).toBe(4)
      expect(sessions.sessions.find((session) => session.software === 'qoder')?.sessionName).toBe(
        'Explicit title',
      )
      expect(
        sessions.sessions.find((session) => session.software === 'qoderwork')?.sessionName,
      ).toBe('Work title')
      for (const session of sessions.sessions) {
        const detail = service.query({
          ...period,
          software: session.software,
          session: session.session,
        })
        expect(detail.totals.total).toBe(session.total)
        expect(detail.records.reduce((sum, row) => sum + row.total!, 0)).toBe(session.total)
      }
      const csv = service.exportSessions(period).csv
      expect(csv).toContain('"qwenwork"')
      expect(csv).toContain('"workbuddy"')
      await service.scan()
      expect(service.query(period).totals.total).toBe(610)
      const persisted = JSON.stringify(database.raw.prepare('SELECT * FROM usage_records').all())
      expect(persisted).not.toMatch(/PRIVATE_|same-turn|sessionId|rawUsage/)
    } finally {
      qoder.db.close()
    }
  })
  it('rereads recent same-size rewrites even when filesystem timestamps collide', async () => {
    const { service, write } = await setup()
    const filename = await write('workbuddy', 'project/session.jsonl', [buddy('a')])
    const stamp = Date.now()
    const original = discovery.safeStat
    vi.spyOn(discovery, 'safeStat').mockImplementation(async (name) => {
      const stat = await original(name)
      return name === filename ? Object.assign(stat, { mtimeMs: stamp, ctimeMs: stamp }) : stat
    })
    await service.scan()
    await fs.writeFile(filename, JSON.stringify(buddy('b')) + '\n')
    await service.scan()
    expect(service.query(period).totals.total).toBe(240)
  })
  it('persists history across file deletion, rotation, collector restart and source absence', async () => {
    const { service, write, roots, database } = await setup()
    const filename = await write('workbuddy', 'project/session.jsonl', [buddy('a')])
    await service.scan()
    await fs.writeFile(filename, JSON.stringify(buddy('b')) + '\n')
    await service.scan()
    expect(service.query(period).totals.total).toBe(240)
    await fs.rm(filename)
    await service.scan()
    expect(service.query(period).totals.total).toBe(240)
    await service.close()
    const collector = new UsageCollector(undefined, roots)
    const providers = (await collector.providers()).filter(
      (provider) => provider.name === 'workbuddy',
    )
    vi.spyOn(collector, 'providers').mockResolvedValue(providers)
    const restarted = new UsageService(database.raw, undefined, collector)
    cleanups.unshift(() => restarted.close())
    await write('workbuddy', 'project/rotated.jsonl', [buddy('b'), buddy('c')])
    await restarted.scan()
    expect(restarted.query(period).totals.total).toBe(360)
    await fs.rm(roots.find((root) => root.software === 'workbuddy')!.directory, { recursive: true })
    await restarted.scan()
    expect(restarted.query(period).totals.total).toBe(360)
    expect(restarted.query(period).sources[0]?.state).toBe('absent')
  })
  it('retries incomplete final lines, keeps valid rows during corruption and deduplicates stream snapshots', async () => {
    const { service, write } = await setup()
    const filename = await write('qoderwork', 'p/session.jsonl', [work('a', 5)])
    const next = JSON.stringify(work('a', 20))
    await fs.appendFile(filename, next.slice(0, -2))
    await service.scan()
    expect(service.query(period).totals.total).toBe(110)
    await fs.appendFile(
      filename,
      next.slice(-2) + '\nnot-json\n' + JSON.stringify(work('b')) + '\n',
    )
    await service.scan()
    expect(service.query(period).totals.total).toBe(250)
    expect(
      service.query(period).sources.find((source) => source.software === 'qoderwork')?.state,
    ).toBe('partial')
    await write('qoderwork', 'p/duplicate.jsonl', [work('a', 5)])
    await service.scan()
    expect(service.query(period).totals.total).toBe(250)
  })
  it('reports missing token exposure and upgrades the same request once real counters appear', async () => {
    const { service, write } = await setup()
    const zero = qwen()
    Object.assign(zero.data, {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    await write('qwenwork', 'session/segments/log.jsonl', [zero])
    await service.scan()
    expect(service.query(period)).toMatchObject({
      matched: 1,
      totals: { total: null, input: null },
    })
    expect(
      service.query(period).sources.find((source) => source.software === 'qwenwork'),
    ).toMatchObject({ state: 'missing_usage', problems: ['missing_usage'] })
    await write('qwenwork', 'session/segments/log.jsonl', [qwen()])
    await service.scan()
    expect(service.query(period)).toMatchObject({ matched: 1, totals: { total: 125 } })
    await write('qwenwork', 'session/segments/log.jsonl', [zero])
    await service.scan()
    expect(service.query(period).totals.total).toBe(125)
  })
  it('sees Qoder WAL updates without checkpointing or modifying the source database', async () => {
    const { service, roots } = await setup()
    const qoder = await qoderDb(roots.find((root) => root.software === 'qoder')!.directory)
    try {
      await service.scan()
      expect(service.query(period).totals.total).toBe(120)
      qoder.insert('second')
      await service.scan()
      expect(service.query(period).totals.total).toBe(240)
      expect(qoder.db.prepare('SELECT COUNT(*) AS n FROM chat_message').get()?.n).toBe(2)
    } finally {
      qoder.db.close()
    }
  })
  it('isolates incompatible databases and denied symlinks without losing good persisted counters', async () => {
    const { service, roots, write } = await setup()
    const filename = await write('workbuddy', 'p/session.jsonl', [buddy()])
    await service.scan()
    await fs.rename(filename, filename + '.old')
    await fs.symlink(filename + '.old', filename)
    const qoderPath = roots.find((root) => root.software === 'qoder')!.directory
    await fs.mkdir(path.dirname(qoderPath), { recursive: true })
    await fs.writeFile(qoderPath, 'not sqlite')
    await service.scan()
    const report = service.query(period)
    expect(report.totals.total).toBe(120)
    expect(report.sources.find((source) => source.software === 'qoder')?.state).toBe('incompatible')
    expect(report.sources.find((source) => source.software === 'workbuddy')?.problems).toContain(
      'incompatible',
    )
  })
  it('does not read files while stopped or paused, and does not persist private source data in caches', async () => {
    const { service, roots, write } = await setup()
    await write('workbuddy', 'p/session.jsonl', [buddy()])
    const native = new NativeUsageCollector(roots)
    expect(await native.collect('workbuddy', () => true)).toMatchObject({
      complete: false,
      records: [],
    })
    await service.setPaused(true)
    await service.scan()
    expect(service.query(period).matched).toBe(0)
    await service.setPaused(false)
    expect(service.query(period).totals.total).toBe(120)
    await native.collect('workbuddy')
    expect(JSON.stringify(native)).not.toContain('PRIVATE_')
  })
  it('keeps mixed cached-input semantics unknown across native and upstream software', async () => {
    const { service, write, database } = await setup()
    await write('workbuddy', 'p/session.jsonl', [
      buddy('a', 'function_call', { prompt_cache_hit_tokens: undefined }),
    ])
    await service.scan()
    const upstream = {
      ...nativeRecord('qoder', 'upstream', 'r', '2026-10-18T02:00:00Z', 'model', {
        prompt_tokens: 10,
        completion_tokens: 2,
        cached_tokens: 0,
      })!,
      reader: 'codeburn',
      software: 'codex',
      inputIncludesCache: false,
    }
    database.raw
      .prepare('INSERT INTO usage_records VALUES (?,?,?,?,?)')
      .run(upstream.id, upstream.software, upstream.time, upstream.model, JSON.stringify(upstream))
    const report = service.query(period)
    expect(report.totals).toMatchObject({ total: 132, inputIncludesCache: null })
    expect(report.software.find((group) => group.key === 'workbuddy')?.inputIncludesCache).toBe(
      true,
    )
    expect(report.software.find((group) => group.key === 'codex')?.inputIncludesCache).toBe(false)
  })
})
