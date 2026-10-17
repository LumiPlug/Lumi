// SPDX-License-Identifier: MPL-2.0
import type { UsageSession } from '@lumiplug/shared'

function cell(value: string | number | null | undefined): string {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  // Spreadsheet programs interpret formula prefixes even in quoted CSV fields.
  const safe = /^[\s]*[=+@-]/u.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
export function sessionsCsv(sessions: UsageSession[]): string {
  const rows = [
    'session_name,session_id,software,models,last_activity,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,record_count,upstream_estimated_record_count',
  ]
  let bytes = 0
  for (const session of sessions) {
    const row = [
      session.sessionName ?? '',
      session.session,
      session.software,
      (session.models ?? []).map((model) => model ?? '未知模型').join(' | '),
      session.latestTime,
      session.input,
      session.output,
      session.cacheRead,
      session.cacheWrite,
      session.total,
      session.count,
      session.estimatedCount ?? 0,
    ]
      .map(cell)
      .join(',')
    bytes += Buffer.byteLength(row)
    if (bytes > 16 * 1024 * 1024) throw new Error('usage_export_too_large')
    rows.push(row)
  }
  return '\ufeff' + rows.join('\r\n') + '\r\n'
}
