// SPDX-License-Identifier: MPL-2.0
import { expect, it, vi } from 'vitest'
import {
  cacheRatio,
  detectedUsageSoftware,
  usageTrend,
  usageBucketRange,
  dashboardTotals,
  overallCacheRatio,
  compactTokens,
  percentLabel,
  previousUsageRange,
} from './usage-dashboard'
import { usageRange } from './usage'

it('excludes absent clients even when their historical usage remains', () => {
  expect(detectedUsageSoftware(null)).toEqual([])
  expect(
    detectedUsageSoftware({
      sources: [
        {
          software: 'claude',
          state: 'absent',
          files: 0,
          records: 0,
          issues: 0,
          experimental: false,
        },
        { software: 'codex', state: 'empty', files: 0, records: 0, issues: 0, experimental: false },
      ],
      software: [
        { key: 'claude', total: 9, input: 9, output: 0, cacheRead: 0, cacheWrite: 0, count: 1 },
      ],
    }),
  ).toEqual(['codex'])
})
it('builds hourly zero slots across DST and separates repeated local hours', () => {
  vi.stubEnv('TZ', 'America/New_York')
  try {
    for (const [date, count] of [
      ['2026-03-08', 23],
      ['2026-11-01', 25],
    ] as const) {
      const range = usageRange('custom', date, date, null)
      const trend = usageTrend(null, range, true, ['codex'])
      expect(trend).toHaveLength(count)
      expect(trend.every((slot) => slot.values.codex === 0)).toBe(true)
      expect(new Set(trend.map((slot) => slot.date)).size).toBe(count)
      if (count === 25) {
        const repeated = trend.filter((slot) => slot.label === '01:00')
        expect(repeated).toHaveLength(2)
        expect(repeated[0]?.detail).not.toBe(repeated[1]?.detail)
        const bucket = usageBucketRange(range, repeated[1]!.date)
        expect(Date.parse(bucket.end) - Date.parse(bucket.start)).toBe(3600000)
      }
    }
  } finally {
    vi.unstubAllEnvs()
  }
})

it('shows zeros for a real empty API report while preserving unknown measurements in existing records', () => {
  const unknown = {
    total: null,
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    count: 0,
  }
  expect(dashboardTotals({ matched: 0, totals: unknown })).toEqual({
    total: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    count: 0,
  })
  expect(dashboardTotals({ matched: 1, totals: { ...unknown, count: 1 } }).total).toBeNull()
  expect(dashboardTotals({ matched: 1, totals: { ...unknown, total: 0, count: 1 } }).total).toBe(0)
})

it('respects different cache semantics without counting cache writes as reuse', () => {
  expect(cacheRatio({ software: 'codex', input: 100, cacheRead: 60, cacheWrite: null })).toBe(0.6)
  expect(cacheRatio({ software: 'claude', input: 20, cacheRead: 60, cacheWrite: 20 })).toBe(0.6)
  expect(cacheRatio({ software: 'claude', input: 20, cacheRead: 60, cacheWrite: null })).toBeNull()
  expect(
    cacheRatio({ software: 'cursor', input: 100, cacheRead: null, cacheWrite: null }),
  ).toBeNull()
  expect(cacheRatio({ software: 'codex', input: 10, cacheRead: 20, cacheWrite: null })).toBeNull()
  expect(overallCacheRatio([])).toBe(0)
  expect(compactTokens(18419204)).toBe('18.42M')
  expect(compactTokens(null)).toBe('未知')
  expect(percentLabel(0.684)).toBe('68.4%')
})
it('compares preceding calendar days across daylight-saving transitions', () => {
  vi.stubEnv('TZ', 'America/New_York')
  try {
    const selected = usageRange('custom', '2026-03-09', '2026-03-09', null)
    const previous = previousUsageRange(selected)
    expect(previous.end).toBe(selected.start)
    expect(new Date(previous.start).getDate()).toBe(8)
    expect((Date.parse(previous.end) - Date.parse(previous.start)) / 3600000).toBe(23)
  } finally {
    vi.unstubAllEnvs()
  }
})

it('keeps gateway UTC days, selected buckets and comparisons independent of the system timezone and DST', () => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
  try {
    const range = {
      start: '2026-03-08T00:00:00.000Z',
      end: '2026-03-10T00:00:00.000Z',
      timezone: 'UTC',
    }
    expect(usageTrend(null, range, false, ['vercel-gateway']).map((row) => row.date)).toEqual([
      '2026-03-08',
      '2026-03-09',
    ])
    expect(usageBucketRange(range, '2026-03-08')).toMatchObject({
      start: range.start,
      end: '2026-03-09T00:00:00.000Z',
    })
    expect(previousUsageRange(range)).toMatchObject({
      start: '2026-03-06T00:00:00.000Z',
      end: range.start,
    })
  } finally {
    vi.unstubAllEnvs()
  }
})
