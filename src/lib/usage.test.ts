// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { StackedBars } from '../components/ui/StackedBars'
import { usageCalendarDates, usageCustomRange, usageRange, tokenNumber } from './usage'
import UsagePage from '../components/UsagePage'
import UsageRecordCard, { UsageRecordTable } from '../components/UsageRecordCard'
import UsageSessionCard, { UsageSessionHeading } from '../components/UsageSessionCard'
import type { UsageRecord } from '@lumiplug/shared'
import { IconButton } from '../components/ui/controls'
vi.mock('../components/ToastProvider', () => ({ useToast: () => () => {} }))
describe('usage filters and accessible chart', () => {
  it('round-trips inclusive calendar dates through local DST and UTC API boundaries', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    try {
      const local = usageCustomRange('2026-03-08', '2026-03-08')
      expect(Date.parse(local.end) - Date.parse(local.start)).toBe(23 * 3600000)
      expect(usageCalendarDates(local)).toEqual({ start: '2026-03-08', end: '2026-03-08' })
      const utc = usageCustomRange('2026-03-08', '2026-03-08', 'UTC')
      expect(utc).toEqual({
        start: '2026-03-08T00:00:00.000Z',
        end: '2026-03-09T00:00:00.000Z',
        timezone: 'UTC',
      })
      expect(usageCalendarDates(utc)).toEqual({ start: '2026-03-08', end: '2026-03-08' })
      expect(() => usageCustomRange('2026-10-17', '2026-10-16', 'UTC')).toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('rolls presets to the current local day and preserves 23/25-hour DST days', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      const before = usageRange('1', '', '', null, new Date(2026, 9, 16, 23, 59)),
        after = usageRange('1', '', '', null, new Date(2026, 9, 17, 0, 1))
      expect(after.start).toBe(before.end)
      for (const [date, hours] of [
        ['2026-03-08', 23],
        ['2026-11-01', 25],
      ] as const) {
        const range = usageRange('custom', date, date, null)
        expect((Date.parse(range.end) - Date.parse(range.start)) / 3600000).toBe(hours)
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('uses local midnight, inclusive custom end and exclusive API end', () => {
    const now = new Date(2026, 9, 16, 14),
      today = usageRange('1', '', '', null, now),
      week = usageRange('7', '', '', null, now)
    expect(new Date(today.start).getHours()).toBe(0)
    expect(new Date(today.end).getDate()).toBe(17)
    expect(new Date(week.start).getDate()).toBe(10)
    expect(usageRange('custom', '2026-10-10', '2026-10-10', null).end).toBe(
      usageRange('7', '', '', '2026-10-10').end,
    )
    expect(() => usageRange('custom', '2026-02-30', '2026-03-01', null)).toThrow()
    expect(() => usageRange('custom', '2026-10-10', '2026-10-09', null)).toThrow()
    expect(() => usageRange('custom', '2024-01-01', '2026-10-09', null)).toThrow()
    expect(tokenNumber(null)).toBe('未知')
    expect(tokenNumber(0)).toBe('0')
  })
  it('keeps unknowns distinct, provides keyboard targets, tooltip text and legend labels', () => {
    const html = renderToStaticMarkup(
      createElement(StackedBars, {
        series: [{ key: 'codex', label: 'Codex' }],
        days: [{ date: '2026-10-10', values: { codex: null } }],
        onSelect: () => {},
      }),
    )
    expect(html).toContain('Codex 未知')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('查看明细')
    expect(html).toContain('ui-chart-target')
    expect(html).toContain('暂无已报告用量')
  })
})

it('retains the zero-data dashboard with software logos and a single refresh action', () => {
  const html = renderToStaticMarkup(createElement(UsagePage, { active: true, coreReady: true }))
  expect(html).not.toContain('<h1')
  for (const removed of [
    '数据源状态',
    '暂停采集',
    '重新扫描</',
    '未经账单核验',
    '此范围暂无可用记录',
  ])
    expect(html).not.toContain(removed)
  expect(html).toContain('总 Token 吞吐')
  expect(html).toContain('Prompt 缓存复用')
  expect(html).toContain('活跃设备')
  expect(html).toContain('aria-label="0 款软件有记录"')
  expect(html).toContain('0.0%')
  expect(html).toContain('aria-label="刷新用量"')
  expect(html).toContain('role="tablist" aria-label="软件筛选"')
  expect(html).not.toContain('aria-label="模型筛选"')
  expect(html).toContain('ui-dashboard-toolbar--bare')
  expect(html).toContain('ui-data-table-scroll--fixed')
  expect(html).toContain('aria-label="会话分页"')
  expect(html).toContain('输入 Token')
  expect(html).toContain('输出 Token')
  expect(html).toContain('缓存读取 Token')
  expect(html).toContain('缓存写入 Token')
  expect(html).not.toContain('ui-metric-footer')
  expect(html).not.toContain('查看模型明细')
  expect(html).toContain('aria-label="会话用量明细"')
  expect(html).toContain('搜索会话名称 / 编号 / 模型')
  expect(html).toContain('aria-label="导出 CSV"')
  expect(html).not.toContain('>导出 CSV<')
  expect(html).toContain('0 Token')
  expect(html).not.toContain('暂无已报告用量')
  expect(html.match(/aria-label="软件筛选"/g)).toHaveLength(1)
  expect(html).not.toContain('Codex 0')
  expect(html.indexOf('会话排序')).toBeLessThan(html.indexOf('aria-expanded="false"'))
  expect(html).toContain('最近互动优先')
})
it('keeps the refresh icon visible and accessible while scanning', () => {
  const html = renderToStaticMarkup(
    createElement(
      IconButton,
      {
        label: '刷新用量',
        loading: true,
        loadingAnimation: 'spin',
      },
      createElement('svg'),
    ),
  )
  expect(html).toContain('disabled=""')
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('刷新用量，处理中')
  expect(html).toContain('ui-icon-button--spinning')
  expect(html).toContain('<svg')
})

it('renders a session name as plain text and retains the hash when it is missing or blank', () => {
  const row: UsageRecord = {
    id: 'synthetic',
    software: 'codex',
    time: '2026-10-10T00:00:00Z',
    model: 'test',
    session: 'a1b2c3d4e5f6',
    input: 80,
    output: 20,
    total: 100,
    cacheRead: 30,
    cacheWrite: null,
    inputIncludesCache: true,
    quality: 'reported',
  }
  const named = renderToStaticMarkup(
    createElement(UsageRecordCard, {
      row: { ...row, sessionName: '<img src=x onerror=bad> 会话名称' },
    }),
  )
  const table = renderToStaticMarkup(createElement(UsageRecordTable, { records: [row] }))
  const headers = [...table.matchAll(/role="columnheader"[^>]*><span[^>]*>([^<]+)</g)].map(
    (match) => match[1],
  )
  expect(headers).toEqual(['时间', '模型', '输入', '输出', '缓存读取', '缓存写入', '总计', '来源'])
  expect(table).toContain('role="table"')
  expect(table).toContain('role="rowgroup"')
  expect(table).toContain('aria-label="输入（含缓存） 80 Token"')
  const body = table.slice(table.indexOf('role="rowgroup"'))
  expect(body).not.toMatch(/>(输入|输出|缓存读取|缓存写入|总计)</)
  expect(body).toContain('>已报告</span>')
  expect(body).not.toContain('来源已报告')
  expect(body.match(/role="cell"/g)).toHaveLength(8)
  expect(named).toContain('&lt;img src=x onerror=bad&gt; 会话名称')
  expect(named).not.toContain('<img')
  expect(named).not.toContain(row.session)
  for (const sessionName of [undefined, '', '  ']) {
    const fallback = renderToStaticMarkup(
      createElement(UsageRecordCard, { row: { ...row, sessionName } }),
    )
    expect(fallback).toContain(row.session)
    expect(fallback).toContain('<dd>100</dd>')
  }
})

it('shows one collapsed session summary with the complete total and accessible expansion state', () => {
  const session = {
    key: 'codex:hash',
    session: 'hash',
    sessionName: '会话名称',
    software: 'codex' as const,
    latestTime: '2026-10-10T00:00:00Z',
    input: 32400,
    output: 8100,
    total: 40500,
    cacheRead: 12150,
    cacheWrite: null,
    count: 405,
  }
  const html = renderToStaticMarkup(
    createElement(UsageSessionCard, { session, filter: {}, revision: 0 }),
  )
  expect(html).toContain('aria-expanded="false"')
  expect(html.match(/会话名称<\/span>/g)).toHaveLength(1)
  expect(html).toContain('40,500 Token')
  expect(html).toContain('hidden=""')
  expect(html).not.toContain('输入（含缓存）')
  const open = renderToStaticMarkup(
    createElement(UsageSessionHeading, {
      session: { ...session, sessionName: undefined },
      expanded: true,
      panelId: 'session-records',
      onToggle: () => {},
    }),
  )
  expect(open).toContain('aria-expanded="true"')
  expect(open).toContain('aria-controls="session-records"')
  expect(open).toContain('hash</span>')
})
