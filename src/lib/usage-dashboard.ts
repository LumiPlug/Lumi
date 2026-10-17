// SPDX-License-Identifier: MPL-2.0
import type { UsageGroup, UsageTotals, UsageSoftware, UsageReport } from '@lumiplug/shared'
import { usageSoftwareIds } from '@lumiplug/shared'
import { localDate } from './usage'
import type { BarDay } from '../components/ui/StackedBars'

export function detectedUsageSoftware(
  report: Pick<UsageReport, 'sources' | 'software'> | null,
): UsageSoftware[] {
  const found = new Set<UsageSoftware>()
  for (const source of report?.sources ?? [])
    if (source.state !== 'absent') found.add(source.software)
  return usageSoftwareIds.filter((key) => found.has(key))
}
export function usageTrend(
  report: UsageReport | null,
  range: { start: string; end: string; timezone: string } | null,
  hourly: boolean,
  software: UsageSoftware[],
): BarDay[] {
  if (!range) return []
  const buckets = new Map<string, Record<string, number | null>>()
  for (const group of (hourly ? report?.hourly : report?.daily) ?? []) {
    if (!software.includes(group.software)) continue
    const values = buckets.get(group.key) ?? {}
    values[group.software] = group.total
    buckets.set(group.key, values)
  }
  const end = new Date(range.end)
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: range.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const full = new Intl.DateTimeFormat('zh-CN', {
    timeZone: range.timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  })
  const result: BarDay[] = []
  for (
    let date = new Date(range.start);
    date < end;
    hourly
      ? date.setTime(date.getTime() + 3600000)
      : range.timezone === 'UTC'
        ? date.setUTCDate(date.getUTCDate() + 1)
        : date.setDate(date.getDate() + 1)
  ) {
    const key = hourly
      ? date.toISOString()
      : range.timezone === 'UTC'
        ? date.toISOString().slice(0, 10)
        : localDate(date)
    const values = buckets.get(key) ?? {}
    for (const name of software) if (!(name in values)) values[name] = 0
    result.push({
      date: key,
      values,
      ...(hourly ? { label: formatter.format(date), detail: full.format(date) } : {}),
    })
  }
  return result
}
export function usageBucketRange(
  range: { start: string; end: string; timezone: string },
  bucket: string,
) {
  if (!bucket.includes('T')) {
    const first = new Date(`${bucket}T00:00:00${range.timezone === 'UTC' ? 'Z' : ''}`),
      last = new Date(first)
    if (range.timezone === 'UTC') last.setUTCDate(last.getUTCDate() + 1)
    else last.setDate(last.getDate() + 1)
    return { ...range, start: first.toISOString(), end: last.toISOString() }
  }
  return {
    ...range,
    start: bucket,
    end: new Date(Math.min(Date.parse(range.end), Date.parse(bucket) + 3600000)).toISOString(),
  }
}

/** No records means zero consumption; a missing measurement in existing records stays unknown. */
export function dashboardTotals(
  report: Pick<UsageReport, 'matched' | 'totals'> | null,
): UsageTotals {
  return report && report.matched > 0
    ? report.totals
    : { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 0 }
}

export function compactTokens(value: number | null | undefined): string {
  if (value == null) return '未知'
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(
    value,
  )
}
export function tokenShare(value: number | null, total: number | null): number | null {
  if (value === null || total === null) return null
  return total > 0 ? value / total : 0
}
export function percentLabel(value: number | null): string {
  return value === null ? '未知' : `${(value * 100).toFixed(1)}%`
}
export function cacheRatio(
  group: Pick<UsageTotals, 'input' | 'cacheRead' | 'cacheWrite' | 'inputIncludesCache'> & {
    software: UsageSoftware
  },
): number | null {
  if (group.input === null || group.cacheRead === null) return null
  let denominator = group.input
  if (group.inputIncludesCache === false || group.software === 'claude') {
    if (group.cacheWrite === null) return null
    denominator += group.cacheRead + group.cacheWrite
  } else if (group.software !== 'codex') return null
  return group.cacheRead > denominator ? null : denominator > 0 ? group.cacheRead / denominator : 0
}
export function overallCacheRatio(groups: UsageGroup[]): number | null {
  let read = 0,
    denominator = 0
  for (const group of groups) {
    const source = { ...group, software: group.key as UsageSoftware }
    if (cacheRatio(source) === null) return null
    read += group.cacheRead ?? 0
    denominator +=
      (group.input ?? 0) +
      (source.inputIncludesCache === false || source.software === 'claude'
        ? (group.cacheRead ?? 0) + (group.cacheWrite ?? 0)
        : 0)
  }
  return denominator > 0 ? read / denominator : 0
}
/** Previous local calendar interval, preserving DST boundaries and the chosen inclusive dates. */
export function previousUsageRange(range: { start: string; end: string; timezone: string }) {
  const first = new Date(range.start),
    last = new Date(range.end)
  if (range.timezone === 'UTC')
    return {
      ...range,
      start: new Date(2 * first.getTime() - last.getTime()).toISOString(),
      end: range.start,
    }
  const days = Math.round(
    (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
      Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) /
      86400000,
  )
  const previous = new Date(first)
  previous.setDate(previous.getDate() - days)
  return { ...range, start: previous.toISOString(), end: range.start }
}
