// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto'
import type { UsageRecord, UsageSoftware } from '@lumiplug/shared'
export type Counter = {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  total: number | null
}
export interface ParserState {
  scope?: string
  recognized?: boolean
  session?: string
  model?: string
  previous?: Counter
  responseRecords?: boolean
}
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
export function model(value: unknown): string | null {
  return typeof value === 'string' && /^[\w./:+-]{1,120}$/.test(value) ? value : null
}
function time(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
const empty: Counter = { input: null, output: null, cacheRead: null, cacheWrite: null, total: null }
function codexCounter(value: unknown): Counter {
  const u = object(value),
    input = count(u.input_tokens),
    output = count(u.output_tokens)
  return {
    input,
    output,
    cacheRead: count(u.cached_input_tokens),
    cacheWrite: null,
    total: count(u.total_tokens) ?? (input !== null && output !== null ? input + output : null),
  }
}
function record(
  software: UsageSoftware,
  timestamp: string,
  session: string,
  selectedModel: string | null,
  key: string,
  counters: Counter,
  includesCache: boolean | null,
): UsageRecord {
  return {
    id: hash(`${software}:${key}`),
    software,
    time: timestamp,
    session: hash(session).slice(0, 24),
    model: selectedModel,
    ...counters,
    inputIncludesCache: includesCache,
    quality: Object.values(counters).some((x) => x !== null) ? 'reported' : 'missing',
  }
}
/** Minimal hashed lineage only; never retains the source metadata object. */
export function codexSessionMeta(
  line: string,
): { id: string; parent: string | null; started: string | null } | null {
  const e = object(JSON.parse(line)),
    p = object(e.payload)
  if (e.type !== 'session_meta') return null
  const id = p.id ?? p.session_id
  if (typeof id !== 'string') return null
  const parent =
    p.forked_from_id ??
    p.parent_thread_id ??
    object(object(object(p.source).subagent).thread_spawn).parent_thread_id
  return {
    id: hash(id),
    parent: typeof parent === 'string' ? hash(parent) : null,
    started: time(e.timestamp),
  }
}
export function parseLine(
  software: 'codex' | 'claude',
  line: string,
  state: ParserState,
  fileId: string,
  scope?: (id: string, at?: string) => string,
): UsageRecord[] {
  const e = object(JSON.parse(line)),
    p = object(e.payload)
  if (
    (software === 'codex' &&
      ['session_meta', 'turn_context', 'event_msg', 'response_item', 'token_usage_record'].includes(
        String(e.type),
      )) ||
    (software === 'claude' &&
      ['assistant', 'user', 'summary', 'system', 'progress', 'file-history-snapshot'].includes(
        String(e.type),
      ))
  )
    state.recognized = true
  if (software === 'codex') {
    if (e.type === 'session_meta') {
      const meta = codexSessionMeta(line)
      if (meta) {
        state.session = meta.id
        state.scope = scope?.(meta.id) ?? meta.parent ?? meta.id
      }
      return []
    }
    if (e.type === 'turn_context') {
      state.model = model(p.model) ?? state.model
      return []
    }
    const timestamp = time(e.timestamp)
    if (!timestamp) return []
    const origin = scope?.(state.session ?? fileId, timestamp) ?? state.scope ?? fileId
    if (e.type === 'token_usage_record') {
      const u = codexCounter(p.usage)
      if (u.total === null && u.input === null && u.output === null) return []
      state.responseRecords = true
      return [
        record(
          software,
          timestamp,
          state.session ?? fileId,
          model(p.model) ?? state.model ?? null,
          typeof p.response_id === 'string'
            ? `response:${p.response_id}`
            : `${origin}:${timestamp}:${JSON.stringify(u)}`,
          u,
          true,
        ),
      ]
    }
    if (e.type !== 'event_msg' || p.type !== 'token_count' || state.responseRecords) return []
    const info = object(p.info),
      cumulative = object(info.total_token_usage)
    let counters: Counter, identity: string
    let basis: UsageRecord['counterBasis'] = 'last'
    if (Object.keys(cumulative).length) {
      const current = codexCounter(cumulative)
      const previous = state.previous
      const keys = ['input', 'output', 'cacheRead', 'total'] as const
      const reset =
        previous &&
        (current.total !== null && previous.total !== null
          ? current.total < previous.total
          : (['input', 'output'] as const).some(
              (k) => current[k] !== null && previous[k] !== null && current[k]! < previous[k]!,
            ))
      basis = reset ? 'reset' : previous ? 'delta' : 'initial'
      state.previous = current
      if (previous && !reset && keys.every((k) => current[k] === previous[k])) return []
      counters = { ...current }
      if (previous && !reset)
        for (const k of keys)
          counters[k] =
            current[k] !== null && previous[k] !== null && current[k]! >= previous[k]!
              ? current[k]! - previous[k]!
              : null
      // Replayed fork history preserves the timestamp and cumulative vector.
      identity = `${origin}:${timestamp}:${JSON.stringify(current)}`
    } else {
      counters = Object.keys(object(info.last_token_usage)).length
        ? codexCounter(info.last_token_usage)
        : { ...empty }
      identity = `${origin}:${timestamp}:${JSON.stringify(counters)}`
    }
    return [
      {
        ...record(
          software,
          timestamp,
          state.session ?? fileId,
          model(info.model) ?? state.model ?? null,
          identity,
          counters,
          true,
        ),
        counterBasis: basis,
      },
    ]
  }
  const message = object(e.message)
  if (e.type !== 'assistant' || typeof message.id !== 'string') return []
  const timestamp = time(e.timestamp)
  if (!timestamp) return []
  const u = object(message.usage)
  const counters: Counter = {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
    total: null,
  }
  const values = [counters.input, counters.output, counters.cacheRead, counters.cacheWrite]
  if (values.every((x) => x !== null)) counters.total = values.reduce<number>((a, b) => a + b!, 0)
  return [
    record(
      software,
      timestamp,
      typeof e.sessionId === 'string' ? e.sessionId : fileId,
      model(message.model),
      `message:${message.id}`,
      counters,
      false,
    ),
  ]
}
export function cursorRecord(row: Record<string, unknown>): UsageRecord | null {
  const timestamp = time(row.time)
  if (!timestamp || typeof row.key !== 'string') return null
  const context = count(row.context)
  const input = count(row.input),
    output = count(row.output)
  // Current Cursor versions use zero-filled tokenCount placeholders.
  const known = (input ?? 0) > 0 || (output ?? 0) > 0
  const counters = {
    ...empty,
    input: known ? input : null,
    output: known ? output : null,
    total: known && input !== null && output !== null ? input + output : null,
  }
  const result = record(
    'cursor',
    timestamp,
    row.key.split(':')[1] ?? row.key,
    model(row.model),
    row.key,
    counters,
    null,
  )
  if (context !== null) result.quality = 'context_snapshot'
  return result
}
