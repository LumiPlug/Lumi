// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { CoreDatabase } from '../db/database'
import { standardRoots } from './discovery'
import { readCodexSessionNames } from './session-names'
import { UsageService } from './service'
import { hash } from './adapters'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const clean of cleanups.splice(0)) await clean()
})
async function setup() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-usage-names-')))
  const roots = standardRoots(home)
  const codex = path.dirname(roots[0]!.directory)
  await fs.mkdir(roots[0]!.directory, { recursive: true })
  const database = new CoreDatabase(':memory:')
  const service = new UsageService(database.raw, roots)
  const index = path.join(codex, 'session_index.jsonl')
  cleanups.push(async () => {
    await service.close()
    database.close()
    await fs.rm(home, { recursive: true, force: true })
  })
  return { home, roots, codex, database, service, index }
}
const key = (id: string) => hash(hash(id)).slice(0, 24)
const named = (id: string, thread_name: string, updated_at?: string) =>
  JSON.stringify({ id, thread_name, updated_at })
function writeDatabase(filename: string, rows: Array<[string, string]>) {
  const db = new DatabaseSync(filename)
  db.exec('CREATE TABLE threads (id TEXT, title TEXT, private_body TEXT)')
  for (const [id, name] of rows)
    db.prepare('INSERT INTO threads VALUES (?,?,?)').run(id, name, 'PRIVATE_BODY_NEVER_READ')
  db.close()
}
const period = { start: '2026-10-09T00:00:00Z', end: '2026-10-12T00:00:00Z', timezone: 'UTC' }

describe('Codex display-only session names', () => {
  it('uses latest timestamps, append order for ties and legacy entries, sanitizing display text', async () => {
    const { roots, index } = await setup()
    await fs.writeFile(
      index,
      [
        named('same', 'original', '2026-10-01'),
        named('same', 'renamed', '2026-10-03'),
        named('same', 'stale', '2026-10-02'),
        named('legacy', 'old'),
        named('legacy', 'latest'),
        named('tie', 'old', '2026-10-03'),
        named('tie', 'latest', '2026-10-03'),
        named('same', ' \t\n '),
        'broken',
        'null',
        '[]',
        '{}',
        JSON.stringify({ id: 12, thread_name: 'invalid' }),
        JSON.stringify({ id: 'bad', thread_name: [] }),
        named('safe', '\u001b[31mLong\n' + 'x'.repeat(300)),
      ].join('\n'),
    )
    const names = await readCodexSessionNames(roots)
    expect(names.size).toBe(4)
    expect(names.get(key('same'))).toBe('renamed')
    expect(names.get(key('legacy'))).toBe('latest')
    expect(names.get(key('tie'))).toBe('latest')
    expect(names.get(key('safe'))).toHaveLength(200)
    expect(names.get(key('safe'))).not.toMatch(/\p{Cc}/u)
  })

  it('prefers index titles, then the newest compatible read-only database, without modifying sources', async () => {
    const { roots, index, codex } = await setup()
    await fs.writeFile(index, named('index', 'index name'))
    writeDatabase(path.join(codex, 'state_4.sqlite'), [
      ['index', 'old'],
      ['db', 'old db'],
    ])
    const filename = path.join(codex, 'state_5.sqlite')
    writeDatabase(filename, [
      ['index', 'database name'],
      ['db', 'new db'],
      ['blank', '  '],
    ])
    // A newer incompatible schema must not suppress a readable fallback version.
    const incompatible = new DatabaseSync(path.join(codex, 'state_6.sqlite'))
    incompatible.exec('CREATE TABLE unrelated (body TEXT)')
    incompatible.close()
    const before = await fs.readFile(filename)
    const names = await readCodexSessionNames(roots)
    expect(names.get(key('index'))).toBe('index name')
    expect(names.get(key('db'))).toBe('new db')
    expect(names.has(key('blank'))).toBe(false)
    expect(JSON.stringify([...names])).not.toContain('PRIVATE_BODY')
    expect(await fs.readFile(filename)).toEqual(before)
    expect(await fs.readFile(index, 'utf8')).toBe(named('index', 'index name'))
  })

  it('refreshes names for active and archived records without changing usage identities, totals or storage', async () => {
    const { service, database, roots, index } = await setup()
    const data = await fs.readFile(path.join(__dirname, 'fixtures/codex.jsonl'), 'utf8')
    await fs.writeFile(path.join(roots[0]!.directory, 'active.jsonl'), data)
    await fs.mkdir(roots[1]!.directory, { recursive: true })
    await fs.writeFile(
      path.join(roots[1]!.directory, 'archived.jsonl'),
      data.replace('synthetic-session', 'archived-session'),
    )
    await service.scan()
    const before = service.query(period)
    const stored = database.raw.prepare('SELECT * FROM usage_records ORDER BY id').all()
    await fs.writeFile(
      index,
      [named('synthetic-session', 'original'), named('archived-session', 'archive name')].join(
        '\n',
      ),
    )
    await service.scan()
    expect(service.query(period).records.map((r) => r.sessionName)).toContain('archive name')
    await fs.appendFile(index, '\n' + named('synthetic-session', 'renamed'))
    await service.scan()
    const after = service.query(period)
    expect(
      service.querySessions(period).sessions.find((s) => s.session === key('synthetic-session'))
        ?.sessionName,
    ).toBe('renamed')
    expect(
      after.records.filter((r) => r.session === key('synthetic-session')).map((r) => r.sessionName),
    ).toEqual(['renamed', 'renamed'])
    expect(
      after.records.map((record) => {
        const row = { ...record }
        delete row.sessionName
        return row
      }),
    ).toEqual(before.records)
    for (const field of ['totals', 'daily', 'software', 'models', 'matched'] as const)
      expect(after[field]).toEqual(before[field])
    expect(database.raw.prepare('SELECT * FROM usage_records ORDER BY id').all()).toEqual(stored)
    expect(JSON.stringify(database.raw.prepare('SELECT * FROM usage_files').all())).not.toContain(
      'renamed',
    )
    const nextPage = service.query({ ...period, offset: 1 })
    expect(nextPage.records.every((r) => !!r.sessionName)).toBe(true)
    // Names are display data; old query results must not be mutated in place.
    expect(before.records.every((r) => r.sessionName === undefined)).toBe(true)
  })

  it('falls back to database then the existing hash when metadata disappears, without leaking names to other software', async () => {
    const { service, database, roots, index, codex } = await setup()
    await fs.copyFile(
      path.join(__dirname, 'fixtures/codex.jsonl'),
      path.join(roots[0]!.directory, 'session.jsonl'),
    )
    writeDatabase(path.join(codex, 'state_5.sqlite'), [['synthetic-session', 'database fallback']])
    await fs.writeFile(index, named('synthetic-session', 'preferred'))
    await service.scan()
    expect(service.query(period).records[0]?.sessionName).toBe('preferred')
    const row = service.query(period).records[0]!
    database.raw
      .prepare('INSERT INTO usage_records VALUES (?,?,?,?,?)')
      .run(
        'other',
        'claude',
        row.time,
        row.model,
        JSON.stringify({ ...row, id: 'other', software: 'claude', sessionName: undefined }),
      )
    expect(service.query({ ...period, software: 'claude' }).records[0]?.sessionName).toBeUndefined()
    await fs.rm(index)
    await service.scan()
    expect(service.query({ ...period, software: 'codex' }).records[0]?.sessionName).toBe(
      'database fallback',
    )
    await fs.rm(path.join(codex, 'state_5.sqlite'))
    await service.scan()
    const fallback = service.query({ ...period, software: 'codex' }).records[0]!
    expect(fallback.sessionName).toBeUndefined()
    expect(fallback.session).toBe(key('synthetic-session'))
  })

  it('ignores symlink and oversized sources and respects isolated roots and cancellation', async () => {
    const { home, roots, index, codex } = await setup()
    const outside = path.join(home, 'outside.jsonl')
    await fs.writeFile(outside, named('unsafe', 'must not appear'))
    await fs.symlink(outside, index)
    const outsideDb = path.join(home, 'outside.sqlite')
    writeDatabase(outsideDb, [['unsafe', 'must not appear']])
    await fs.symlink(outsideDb, path.join(codex, 'state_9.sqlite'))
    expect((await readCodexSessionNames(roots)).size).toBe(0)
    await fs.rm(index)
    await fs.copyFile(outside, index)
    await fs.truncate(index, 16 * 1024 * 1024 + 1)
    expect((await readCodexSessionNames(roots)).size).toBe(0)
    expect((await readCodexSessionNames([])).size).toBe(0)
    expect((await readCodexSessionNames(roots, () => true)).size).toBe(0)
  })
})
