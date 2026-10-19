// SPDX-License-Identifier: MPL-2.0
import { t, getLocale } from '../i18n'
export { usageSoftwareNames as usageNames } from '@lumiplug/shared'
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function validUsageDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isFinite(parsed.getTime()) && localDate(parsed) === value
}
export function usageRange(
  preset: string,
  start: string,
  end: string,
  day: string | null,
  now = new Date(),
) {
  function date(value: string) {
    const d = new Date(`${value}T00:00:00`)
    if (!Number.isFinite(d.getTime()) || localDate(d) !== value)
      throw new Error(t('请选择有效日期。'))
    return d
  }
  let first: Date, last: Date
  if (day) {
    first = date(day)
    last = date(day)
    last.setDate(last.getDate() + 1)
  } else if (preset === 'custom') {
    first = date(start)
    last = date(end)
    last.setDate(last.getDate() + 1)
  } else {
    first = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    last = new Date(first)
    last.setDate(last.getDate() + 1)
    first.setDate(first.getDate() - (Number(preset) - 1))
  }
  if (last <= first || last.getTime() - first.getTime() > 367 * 86400000)
    throw new Error(t('结束日期不得早于开始日期，时间范围最多一年。'))
  return {
    start: first.toISOString(),
    end: last.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
export function tokenNumber(value: number | null | undefined) {
  return value == null ? t('未知') : value.toLocaleString(getLocale())
}

/** Calendar inputs use inclusive dates; the API range has an exclusive end. */
export function usageCalendarDates(range: { start: string; end: string; timezone?: string }) {
  const date = (value: Date) =>
    range.timezone === 'UTC' ? value.toISOString().slice(0, 10) : localDate(value)
  return { start: date(new Date(range.start)), end: date(new Date(Date.parse(range.end) - 1)) }
}

export function usageCustomRange(start: string, end: string, timezone?: string) {
  const range = usageRange('custom', start, end, null)
  if (timezone !== 'UTC') return range
  const exclusiveEnd = new Date(`${end}T00:00:00.000Z`)
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1)
  return { start: `${start}T00:00:00.000Z`, end: exclusiveEnd.toISOString(), timezone: 'UTC' }
}
