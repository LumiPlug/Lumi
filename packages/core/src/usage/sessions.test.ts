// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageRecord } from '@lumiplug/shared'
import { CoreDatabase } from '../db/database'
import { UsageService } from './service'

const databases: CoreDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
const period = { start: '2026-10-10T00:00:00Z', end: '2026-10-12T00:00:00Z', timezone: 'UTC' }
function setup() {
  const database = new CoreDatabase(':memory:')
  databases.push(database)
  const service = new UsageService(database.raw, [])
  function insert(id: string, overrides: Partial<UsageRecord> = {}) {
    const record: UsageRecord = {
      id,
      software: 'codex',
      session: 'hashed-session',
      time: '2026-10-10T01:00:00Z',
      model: 'model-a',
      input: 80,
      output: 20,
      cacheRead: 30,
      cacheWrite: null,
      total: 100,
      inputIncludesCache: true,
      quality: 'reported',
      ...overrides,
    }
    database.raw
      .prepare('INSERT INTO usage_records VALUES (?,?,?,?,?)')
      .run(record.id, record.software, record.time, record.model, JSON.stringify(record))
  }
  return { service, insert, database }
}
describe('complete usage session summaries', () => {
  it('uses the discovered software scope consistently for totals, trends, sessions, details and exports', () => {
    const { service, insert, database } = setup()
    insert('current')
    insert('historical', { software: 'claude', session: 'old-client', total: 9000 })
    const scope = { ...period, detectedOnly: true, granularity: 'hour' }
    expect(service.query(scope).matched).toBe(0)
    const source = (software: string, state: string) => ({
      software,
      state,
      files: 1,
      records: 1,
      issues: 0,
      experimental: false,
    })
    database.raw
      .prepare('INSERT OR REPLACE INTO usage_state VALUES (?,?)')
      .run('sources', JSON.stringify([source('codex', 'ready'), source('claude', 'absent')]))
    const report = service.query(scope)
    expect(report.totals.total).toBe(100)
    expect(report.software.map((group) => group.key)).toEqual(['codex'])
    expect(report.models.every((group) => group.software === 'codex')).toBe(true)
    expect(report.daily.every((group) => group.software === 'codex')).toBe(true)
    expect(report.hourly?.every((group) => group.software === 'codex')).toBe(true)
    expect(service.querySessions(scope).sessions.map((row) => row.session)).toEqual([
      'hashed-session',
    ])
    expect(
      service.query({ ...scope, software: 'claude', session: 'old-client' }).records,
    ).toHaveLength(0)
    expect(service.exportSessions(scope).csv).not.toContain('old-client')
    expect(service.query(period).matched).toBe(2)
    database.raw
      .prepare('UPDATE usage_state SET value=? WHERE key=?')
      .run(JSON.stringify([source('codex', 'absent')]), 'sources')
    expect(service.querySessions(scope).matched).toBe(0)
  })
  it('supports bounded session pages and keeps exports independent of paging', () => {
    const { service, insert } = setup()
    for (let i = 0; i < 23; i++)
      insert(`page-${i}`, { session: `session-${String(i).padStart(2, '0')}` })
    const pages = [0, 10, 20].map((offset) =>
      service.querySessions({ ...period, offset, limit: 10 }),
    )
    expect(pages.map((page) => page.sessions.length)).toEqual([10, 10, 3])
    expect(pages.map((page) => page.truncated)).toEqual([true, true, false])
    expect(new Set(pages.flatMap((page) => page.sessions.map((session) => session.key))).size).toBe(
      23,
    )
    expect(pages.every((page) => page.matched === 23)).toBe(true)
    expect(
      service.exportSessions({ ...period, offset: 20, limit: 10 }).csv.split('\r\n'),
    ).toHaveLength(25)
  })
  it('aggregates hourly over all records, respects exclusive boundaries and local-midnight anchoring', () => {
    const { service, insert } = setup()
    const range = {
      start: '2026-10-09T18:30:00Z',
      end: '2026-10-10T18:30:00Z',
      timezone: 'Asia/Kolkata',
      granularity: 'hour',
    }
    for (let i = 0; i < 405; i++) insert(`hour-${i}`, { time: '2026-10-09T18:59:00Z' })
    insert('next-hour', { time: '2026-10-09T19:30:00Z' })
    insert('outside-hour', { time: range.end })
    const report = service.query(range)
    expect(report.records).toHaveLength(200)
    expect(report.hourly?.find((group) => group.key === '2026-10-09T18:30:00.000Z')).toMatchObject({
      total: 40500,
      count: 405,
    })
    expect(report.hourly?.find((group) => group.key === '2026-10-09T19:30:00.000Z')?.total).toBe(
      100,
    )
    expect(report.hourly?.reduce((total, group) => total + (group.total ?? 0), 0)).toBe(
      report.totals.total,
    )
    expect(service.query(period).hourly).toBeUndefined()
  })
  it('aggregates beyond the 200-record detail page and paginates the expanded session independently', () => {
    const { service, insert } = setup()
    for (let i = 0; i < 405; i++) insert(`record-${i}`)
    insert('other', { session: 'other-session', time: '2026-10-11T01:00:00Z' })
    const page = service.querySessions(period)
    expect(page.matched).toBe(2)
    expect(page.truncated).toBe(false)
    expect(page.sessions.map((s) => s.session)).toEqual(['other-session', 'hashed-session'])
    const summary = page.sessions[1]!
    expect(summary).toMatchObject({
      total: 40500,
      input: 32400,
      output: 8100,
      cacheRead: 12150,
      count: 405,
    })
    const first = service.query({ ...period, software: 'codex', session: summary.session })
    const second = service.query({
      ...period,
      software: 'codex',
      session: summary.session,
      offset: 200,
    })
    const last = service.query({
      ...period,
      software: 'codex',
      session: summary.session,
      offset: 400,
    })
    expect([first.records.length, second.records.length, last.records.length]).toEqual([
      200, 200, 5,
    ])
    expect(
      new Set([...first.records, ...second.records, ...last.records].map((r) => r.id)).size,
    ).toBe(405)
    expect(first.totals.total).toBe(summary.total)
    expect(last.truncated).toBe(false)
    expect(service.querySessions(period)).toEqual(page)
  })
  it('returns one summary per session across paginated session lists, with stable tie ordering', () => {
    const { service, insert } = setup()
    for (let i = 0; i < 205; i++) {
      const session = `hash-${String(i).padStart(3, '0')}`
      insert(`a-${i}`, { session })
      insert(`b-${i}`, { session })
    }
    const first = service.querySessions(period)
    const last = service.querySessions({ ...period, offset: 200 })
    expect(first.sessions).toHaveLength(200)
    expect(last.sessions).toHaveLength(5)
    expect(first.matched).toBe(205)
    expect(first.truncated).toBe(true)
    expect(last.truncated).toBe(false)
    const combined = [...first.sessions, ...last.sessions]
    expect(new Set(combined.map((s) => s.key)).size).toBe(205)
    expect(combined.every((s) => s.total === 200 && s.count === 2)).toBe(true)
    expect(combined.map((s) => s.key)).toEqual(combined.map((s) => s.key).sort())
  })
  it('groups by software plus session identity, preserves the same filters and distinguishes unknown from zero', () => {
    const { service, insert } = setup()
    insert('one', { sessionName: 'same name' })
    insert('same-name', { session: 'other-hash', sessionName: 'same name', model: null })
    insert('other-app', { software: 'claude', model: 'model-b' })
    insert('next-day', { time: '2026-10-11T01:00:00Z', model: 'model-b' })
    insert('outside', { time: period.end })
    insert('unknown', {
      session: 'unknown-hash',
      quality: 'missing',
      total: null,
      input: null,
      output: null,
      cacheRead: null,
    })
    insert('zero', { session: 'zero-hash', total: 0, input: 0, output: 0, cacheRead: 0 })
    const page = service.querySessions(period)
    expect(page.matched).toBe(5)
    expect(page.sessions.find((s) => s.key === 'codex:hashed-session')).toMatchObject({
      total: 200,
      count: 2,
    })
    expect(page.sessions.find((s) => s.key === 'claude:hashed-session')?.total).toBe(100)
    expect(page.sessions.find((s) => s.session === 'unknown-hash')?.total).toBeNull()
    expect(page.sessions.find((s) => s.session === 'zero-hash')?.total).toBe(0)
    for (const filter of [
      { software: 'codex', model: 'model-a' },
      { model: null },
      { software: 'claude', session: 'hashed-session' },
      { end: '2026-10-11T00:00:00Z', model: 'model-a' },
    ]) {
      const payload = { ...period, ...filter }
      const sessions = service.querySessions(payload)
      const raw = service.query(payload)
      expect(sessions.sessions.reduce((sum, s) => sum + (s.total ?? 0), 0)).toBe(
        raw.totals.total ?? 0,
      )
      expect(sessions.sessions.reduce((sum, s) => sum + s.count, 0)).toBe(raw.matched)
    }
    expect(service.querySessions({ ...period, software: 'cursor' })).toEqual({
      sessions: [],
      matched: 0,
      truncated: false,
    })
    expect(() => service.querySessions({ start: 'invalid' })).toThrow()
  })
  it('searches complete session summaries before paging and exports filtered CSV safely', () => {
    const { service, insert } = setup()
    for (let i = 0; i < 205; i++) insert(`ordinary-${i}`, { session: `ordinary-${i}` })
    insert('special-a', { session: 'special', model: 'rare-model', total: 1000 })
    insert('special-b', { session: 'special', model: 'second-model', total: 2000 })
    const matches = service.querySessions({ ...period, search: 'RARE-MODEL' })
    expect(matches).toMatchObject({
      matched: 1,
      truncated: false,
      sessions: [
        { session: 'special', models: ['rare-model', 'second-model'], total: 3000, count: 2 },
      ],
    })
    expect(service.querySessions({ ...period, sort: 'tokens' }).sessions[0]?.session).toBe(
      'special',
    )
    const csv = service.exportSessions({ ...period, search: 'special' }).csv
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('rare-model | second-model')
    expect(csv).toContain(',3000,2')
    expect(csv).not.toContain('ordinary-')
  })
})
