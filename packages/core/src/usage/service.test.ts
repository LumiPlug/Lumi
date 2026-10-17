// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoreDatabase } from '../db/database'
import { UsageService } from './service'
import { discover, standardRoots } from './discovery'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0)) await clean()
})
async function setup() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-usage-')))
  const database = new CoreDatabase(path.join(home, 'usage.sqlite'))
  const roots = standardRoots(home)
  await fs.mkdir(roots[0]!.directory, { recursive: true })
  await fs.mkdir(roots[2]!.directory, { recursive: true })
  const service = new UsageService(database.raw, roots)
  cleanups.push(async () => {
    await service.close()
    database.close()
    await fs.rm(home, { recursive: true, force: true })
  })
  return {
    home,
    database,
    service,
    roots,
    report: () =>
      service.query({
        start: '2026-10-09T00:00:00Z',
        end: '2026-10-12T00:00:00Z',
        timezone: 'UTC',
      }),
  }
}
async function fixture(name: string) {
  return fs.readFile(path.join(__dirname, `fixtures/${name}.jsonl`), 'utf8')
}
describe('local usage collection', () => {
  it('reports nested depth limits and permission errors instead of silently dropping them', async () => {
    const { service, roots, report } = await setup()
    const deep = path.join(roots[0]!.directory, 'a/b/c/d/e/f')
    await fs.mkdir(deep, { recursive: true })
    await fs.writeFile(path.join(deep, 'unscanned.jsonl'), await fixture('codex'))
    await service.scan()
    expect(report().sources.find((source) => source.software === 'codex')).toMatchObject({
      state: 'partial',
      problems: ['limit'],
    })
    const original = fs.opendir.bind(fs)
    vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      if (args[0] === path.join(roots[0]!.directory, 'a'))
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return original(...args)
    })
    await service.scan()
    expect(report().sources.find((source) => source.software === 'codex')).toMatchObject({
      state: 'denied',
      problems: ['denied'],
    })
  })
  it('cancels directory discovery when pause is requested during enumeration', async () => {
    const { service, roots, report } = await setup()
    await fs.mkdir(path.join(roots[0]!.directory, 'nested'))
    let entered!: () => void, release!: () => void
    const began = new Promise<void>((resolve) => {
        entered = resolve
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
    const original = fs.opendir.bind(fs)
    const opening = vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      entered()
      await gate
      return original(...args)
    })
    const scan = service.scan()
    await began
    const pause = service.setPaused(true)
    release()
    await Promise.all([scan, pause])
    expect(opening).toHaveBeenCalledTimes(1)
    expect(report().paused).toBe(true)
    expect(report().matched).toBe(0)
    expect(await discover(roots[0]!, () => true)).toMatchObject({ files: [], issues: 0 })
  })
  it('starts one automatic timer and clears it permanently when closed', async () => {
    const { service } = await setup()
    vi.useFakeTimers()
    const scan = vi.spyOn(service, 'scan').mockResolvedValue(undefined)
    service.start()
    service.start()
    expect(scan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(scan).toHaveBeenCalledTimes(2)
    await service.close()
    service.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(scan).toHaveBeenCalledTimes(2)
  })
  it('persists no Codex instructions, response bodies or tool arguments', async () => {
    const { service, database, roots } = await setup()
    const lines = (await fixture('codex')).trim().split('\n'),
      header = JSON.parse(lines[0]!)
    header.payload.instructions = 'PRIVATE_SYNTHETIC_INSTRUCTIONS'
    lines[0] = JSON.stringify(header)
    lines.splice(
      1,
      0,
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', arguments: 'PRIVATE_SYNTHETIC_TOOL_ARGUMENTS' },
      }),
    )
    await fs.writeFile(path.join(roots[0]!.directory, 'privacy.jsonl'), lines.join('\n') + '\n')
    await service.scan()
    const persisted = ['usage_records', 'usage_files', 'usage_lineage', 'usage_state'].map(
      (table) => database.raw.prepare(`SELECT * FROM ${table}`).all(),
    )
    expect(JSON.stringify(persisted)).not.toContain('PRIVATE_SYNTHETIC')
  })
  it('scans incrementally; duplicate, restart, rotation and fork copies do not double count', async () => {
    const { database, service, roots, report } = await setup(),
      file = path.join(roots[0]!.directory, 'session.jsonl')
    const data = await fixture('codex')
    await fs.writeFile(file, data)
    await service.scan()
    await service.scan()
    expect(report().totals.total).toBe(160)
    await fs.rename(file, `${file}.rotated.jsonl`)
    await fs.writeFile(
      file,
      data.replace(
        data.split('\n')[0]!,
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'fork-session', forked_from_id: 'synthetic-session' },
        }),
      ),
    )
    const restarted = new UsageService(database.raw, roots)
    await restarted.scan()
    await restarted.close()
    expect(report().totals.total).toBe(160)
    await fs.writeFile(
      path.join(roots[0]!.directory, 'tail.jsonl'),
      data.trim().split('\n').at(-1)! + '\n',
    )
    await service.scan()
    expect(report().totals.total).toBe(160)
  })
  it('updates Claude stream once, merges repeated snapshots, persists no private body', async () => {
    const { database, service, roots, report } = await setup(),
      lines = (await fixture('claude')).trim().split('\n')
    const file = path.join(roots[2]!.directory, 'session.jsonl')
    await fs.writeFile(file, lines[0] + '\n')
    await service.scan()
    expect(report().totals.total).toBe(61)
    await fs.appendFile(file, lines[1] + '\n' + lines[0] + '\n')
    await service.scan()
    expect(report().totals.total).toBe(100)
    expect(report().matched).toBe(1)
    const persisted =
      JSON.stringify(database.raw.prepare('SELECT * FROM usage_records').all()) +
      JSON.stringify(database.raw.prepare('SELECT * FROM usage_files').all())
    expect(persisted).not.toContain('PRIVATE_CONTENT')
    expect(persisted).not.toContain('requestId')
    expect(persisted).not.toContain('session.jsonl')
  })
  it('retries incomplete lines, isolates malformed files and handles truncation', async () => {
    const { service, roots, report } = await setup(),
      data = await fixture('codex'),
      file = path.join(roots[0]!.directory, 'session.jsonl')
    await fs.writeFile(file, data.slice(0, -12))
    await fs.writeFile(path.join(roots[2]!.directory, 'bad.jsonl'), 'invalid JSON\n')
    await service.scan()
    expect(report().totals.total).toBe(100)
    await fs.appendFile(file, data.slice(-12))
    await service.scan()
    expect(report().totals.total).toBe(160)
    await fs.writeFile(file, data)
    await service.scan()
    expect(report().totals.total).toBe(160)
    expect(report().sources.find((x) => x.software === 'claude')?.state).toBe('incompatible')
  })
  it('persists pause and resumes with no manual source setup', async () => {
    const { database, service, roots, report } = await setup()
    await service.setPaused(true)
    await fs.writeFile(path.join(roots[0]!.directory, 'session.jsonl'), await fixture('codex'))
    await service.scan()
    expect(report().matched).toBe(0)
    const restarted = new UsageService(database.raw, roots)
    expect(restarted.paused).toBe(true)
    await restarted.close()
    await service.setPaused(false)
    expect(report().totals.total).toBe(160)
  })
  it('does not follow symbolic links and reports unavailable sources', async () => {
    const { home, service, roots, report } = await setup()
    await fs.symlink(home, path.join(roots[0]!.directory, 'escape'))
    await service.scan()
    expect(report().sources.find((x) => x.software === 'codex')?.issues).toBe(1)
    expect(report().sources.find((x) => x.software === 'cursor')?.state).toBe('absent')
  })
  it('distinguishes permission denial from incompatible formats without retrying with more privileges', async () => {
    const { service, roots, report } = await setup(),
      file = path.join(roots[0]!.directory, 'denied.jsonl')
    await fs.writeFile(file, await fixture('codex'))
    const original = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (args[0] === file) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return original(...args)
    })
    await service.scan()
    expect(report().sources.find((x) => x.software === 'codex')?.state).toBe('denied')
    expect(report().matched).toBe(0)
  })
  it('does not collapse unrelated sessions with identical timestamps and counters', async () => {
    const { service, roots, report } = await setup(),
      data = await fixture('codex')
    await fs.writeFile(path.join(roots[0]!.directory, 'a.jsonl'), data)
    await fs.writeFile(
      path.join(roots[0]!.directory, 'b.jsonl'),
      data.replace('synthetic-session', 'independent-session'),
    )
    await service.scan()
    expect(report().totals.total).toBe(320)
  })
  it('resolves nested fork ancestry before parsing regardless of discovery order', async () => {
    const { service, roots, report } = await setup(),
      data = await fixture('codex'),
      lines = data.trim().split('\n')
    const header = (id: string, parent: string | null, started: string) =>
      JSON.stringify({
        type: 'session_meta',
        timestamp: started,
        payload: { id, forked_from_id: parent },
      })
    const event = (total: number, at: string) =>
      JSON.stringify({
        type: 'event_msg',
        timestamp: at,
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: total - 30,
              output_tokens: 30,
              cached_input_tokens: 50,
              total_tokens: total,
            },
          },
        },
      })
    const original = [header('parent', null, '2026-10-10T00:00:00Z'), lines[2], lines[3]]
    const fork = [
      header('child', 'parent', '2026-10-10T03:00:00Z'),
      lines[2],
      lines[3],
      event(200, '2026-10-10T04:00:00Z'),
    ]
    const nested = [
      header('grandchild', 'child', '2026-10-10T05:00:00Z'),
      ...fork.slice(1),
      event(240, '2026-10-10T06:00:00Z'),
    ]
    await fs.writeFile(
      path.join(roots[0]!.directory, 'a-grandchild.jsonl'),
      nested.join('\n') + '\n',
    )
    await fs.writeFile(path.join(roots[0]!.directory, 'b-child.jsonl'), fork.join('\n') + '\n')
    await fs.writeFile(path.join(roots[0]!.directory, 'z-parent.jsonl'), original.join('\n') + '\n')
    await service.scan()
    expect(report().totals.total).toBe(240)
  })
  it('reports incomplete usage when input/output exist but cache semantics are absent', async () => {
    const { service, roots, report } = await setup()
    const data = JSON.parse((await fixture('claude')).trim().split('\n')[1]!)
    delete data.message.usage.cache_read_input_tokens
    await fs.writeFile(path.join(roots[2]!.directory, 'partial.jsonl'), JSON.stringify(data) + '\n')
    await service.scan()
    expect(report().totals.total).toBeNull()
    expect(report().sources.find((source) => source.software === 'claude')).toMatchObject({
      state: 'missing_usage',
      problems: ['missing_usage'],
    })
  })
  it('prefers final Claude values even when a later snapshot corrects a counter down', async () => {
    const { service, roots, report } = await setup(),
      data = await fixture('claude'),
      last = JSON.parse(data.trim().split('\n')[1]!)
    last.timestamp = '2026-10-10T01:00:02Z'
    last.message.usage.output_tokens = 25
    await fs.writeFile(
      path.join(roots[2]!.directory, 'final.jsonl'),
      data + JSON.stringify(last) + '\n',
    )
    await service.scan()
    expect(report().totals.total).toBe(85)
    await fs.writeFile(path.join(roots[2]!.directory, 'copied.jsonl'), data)
    await service.scan()
    expect(report().totals.total).toBe(85)
  })
  it('reports the Cursor row cap and still reads another available source', async () => {
    const { service, roots, report } = await setup()
    const first = roots[3]!.directory,
      second = path.join(path.dirname(first), 'second.vscdb')
    await fs.mkdir(path.dirname(first), { recursive: true })
    const database = new DatabaseSync(first)
    database.exec(`CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value TEXT);
      WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<100000)
      INSERT INTO cursorDiskKV SELECT 'bubbleId:synthetic:' || x,'{}' FROM n;`)
    database.close()
    const extra = new DatabaseSync(second)
    extra.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value TEXT)')
    extra
      .prepare('INSERT INTO cursorDiskKV VALUES (?,?)')
      .run(
        'bubbleId:second:one',
        JSON.stringify({
          createdAt: '2026-10-10T00:00:00Z',
          tokenCount: { inputTokens: 12, outputTokens: 8 },
        }),
      )
    extra.close()
    roots.push({ software: 'cursor', directory: second, sqlite: true })
    await service.scan()
    expect(report().totals.total).toBe(20)
    expect(report().sources.find((source) => source.software === 'cursor')).toMatchObject({
      state: 'partial',
      files: 2,
      problems: ['limit'],
    })
  })
  it('reads only Cursor usage columns read-only; context and zero placeholders stay unknown', async () => {
    const { service, roots, report } = await setup(),
      file = roots[3]!.directory
    await fs.mkdir(path.dirname(file), { recursive: true })
    const cursor = new DatabaseSync(file)
    cursor.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value TEXT)')
    const insert = cursor.prepare('INSERT INTO cursorDiskKV VALUES (?,?)')
    insert.run(
      'bubbleId:s:1',
      JSON.stringify({
        type: 2,
        createdAt: '2026-10-10T00:00:00Z',
        tokenCount: { inputTokens: 0, outputTokens: 0 },
        text: 'SYNTHETIC_PRIVATE',
      }),
    )
    insert.run(
      'composerData:s',
      JSON.stringify({ createdAt: '2026-10-10T00:00:00Z', contextTokensUsed: 90000 }),
    )
    cursor.close()
    const before = await fs.readFile(file)
    await service.scan()
    expect(report().totals.total).toBeNull()
    expect(report().matched).toBe(1)
    expect(report().sources.find((x) => x.software === 'cursor')?.state).toBe('missing_usage')
    expect(await fs.readFile(file)).toEqual(before)
  })
  it('uses exclusive UTC ranges, local timezone day boundaries and complete aggregates with paginated details', async () => {
    const { database, service, roots } = await setup()
    const lines = (await fixture('claude')).trim().split('\n'),
      base = JSON.parse(lines[1]!)
    const data =
      Array.from({ length: 205 }, (_, i) =>
        JSON.stringify({
          ...base,
          timestamp: '2026-10-10T00:30:00Z',
          message: { ...base.message, id: `synthetic-${i}` },
        }),
      ).join('\n') + '\n'
    await fs.writeFile(path.join(roots[2]!.directory, 'many.jsonl'), data)
    await service.scan()
    const report = service.query({
      start: '2026-10-10T00:00:00Z',
      end: '2026-10-11T00:00:00Z',
      timezone: 'America/Los_Angeles',
    })
    expect(report.totals.total).toBe(20500)
    expect(report.records).toHaveLength(200)
    expect(report.truncated).toBe(true)
    expect(report.daily[0]?.key).toBe('2026-10-09')
    expect(
      service.query({ start: '2026-10-10T00:30:00Z', end: '2026-10-10T00:31:00Z', offset: 200 })
        .records,
    ).toHaveLength(5)
    expect(database.raw.prepare('SELECT count(*) AS n FROM usage_records').get()?.n).toBe(205)
    expect(() => service.query({ start: 'invalid' })).toThrow()
  })
})
