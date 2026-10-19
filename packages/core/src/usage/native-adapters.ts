// SPDX-License-Identifier: MPL-2.0
import path from 'node:path'
import type { NativeUsageSoftware, UsageRecord } from '@lumiplug/shared'
import { count, hash, model } from './adapters'

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000 ? value : null
}
export function displayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return (
    value
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 200) || undefined
  )
}
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
/** Qoder transcripts use ISO strings or Unix seconds/milliseconds, never locale guesses. */
function qoderTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^\d+$/.test(text)) value = Number(text)
    else if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return timestamp(text)
    else return null
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return timestamp(value < 1e12 ? value * 1000 : value)
}
function sum(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null
  return count(values.reduce<number>((total, value) => total + value!, 0))
}
function tokens(
  software: NativeUsageSoftware,
  usage: Record<string, unknown>,
  qoderJsonl = false,
): Pick<
  UsageRecord,
  'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'total' | 'inputIncludesCache' | 'quality'
> {
  const exclusive = software === 'qoderwork' || qoderJsonl
  const prompt = count(
    exclusive || software === 'qwenwork' ? usage.input_tokens : usage.prompt_tokens,
  )
  const output = count(
    exclusive || software === 'qwenwork' ? usage.output_tokens : usage.completion_tokens,
  )
  const cached = count(
    software === 'workbuddy'
      ? usage.prompt_cache_hit_tokens
      : software === 'qoder' && !qoderJsonl
        ? usage.cached_tokens
        : usage.cache_read_input_tokens,
  )
  const cacheRead =
    cached !== null && prompt !== null && !exclusive && cached > prompt ? null : cached
  const cacheWrite =
    software === 'workbuddy'
      ? (count(usage.prompt_cache_write_tokens) ?? count(usage.cache_creation_input_tokens))
      : count(usage.cache_creation_input_tokens)
  const input = exclusive
    ? prompt
    : prompt !== null && cacheRead !== null
      ? prompt - cacheRead
      : prompt
  // OpenAI-style input contains its cache subset; Anthropic-style input excludes it.
  const total = exclusive
    ? (sum([input, output, cacheRead, cacheWrite]) ?? count(usage.total_tokens))
    : software === 'qwenwork'
      ? (sum([prompt, output, cacheWrite]) ?? count(usage.total_tokens))
      : (sum([prompt, output]) ?? count(usage.total_tokens))
  const fields = { input, output, cacheRead, cacheWrite, total }
  // These products can emit placeholder zeros when their exposure gate is disabled.
  const hidden =
    (software === 'qoderwork' || software === 'qwenwork' || qoderJsonl) &&
    Object.values(fields).every((value) => value === null || value === 0)
  return {
    ...(hidden
      ? { input: null, output: null, cacheRead: null, cacheWrite: null, total: null }
      : fields),
    inputIncludesCache: exclusive || cacheRead !== null ? false : true,
    quality:
      hidden || Object.values(fields).every((value) => value === null) ? 'missing' : 'reported',
  }
}
export interface ParsedNativeLine {
  recognized: boolean
  record?: UsageRecord
  title?: { session: string; name: string }
}
export function nativeRecord(
  software: NativeUsageSoftware,
  session: string,
  request: string,
  at: unknown,
  selectedModel: unknown,
  usage: Record<string, unknown>,
  title?: unknown,
): UsageRecord | null {
  const time = timestamp(at)
  if (!time || !session || !request) return null
  const name = displayName(title)
  return {
    id: hash(`native:${software}:${JSON.stringify([session, request])}`),
    reader: 'native',
    software,
    time,
    session: hash(`native:${software}:${session}`).slice(0, 24),
    model: model(selectedModel),
    ...(name ? { sessionName: name } : {}),
    ...tokens(software, usage),
  }
}
/** Only explicit title metadata is retained; message bodies and tool arguments are ignored. */
export function parseNativeLine(
  software: NativeUsageSoftware,
  value: unknown,
  filename: string,
): ParsedNativeLine {
  const e = object(value),
    message = object(e.message),
    pd = object(e.providerData)
  if (software === 'qoder') {
    if (e.type !== 'assistant' || (message.role != null && message.role !== 'assistant'))
      return { recognized: typeof e.type === 'string' }
    const session = identifier(e.sessionId) ?? identifier(e.session_id)
    const request = identifier(message.id) ?? identifier(e.uuid) ?? identifier(e.id)
    const time = qoderTimestamp(e.timestamp)
    // Without a stable pair, copies/rotation cannot safely be reconciled.
    if (!session || !request || !time) return { recognized: true }
    const usage = object(message.usage)
    const record = nativeRecord(software, session, request, time, message.model ?? e.model, {})!
    return {
      recognized: true,
      record: {
        ...record,
        id: hash(`native:qoder:jsonl:${record.id}`),
        qoderFormat: 'jsonl',
        qoderRequest: record.id,
        ...tokens(software, usage, true),
      },
    }
  }
  const segment = software === 'qwenwork'
  const fallback = segment
    ? path.basename(path.dirname(path.dirname(filename)))
    : path.basename(filename, '.jsonl')
  const session = identifier(e.sessionId) ?? identifier(e.session_id) ?? fallback
  const name = displayName(e.customTitle ?? e.aiTitle ?? e.title)
  const title =
    name && ['custom-title', 'ai-title', 'session_meta', 'session-title'].includes(String(e.type))
      ? { session: hash(`native:${software}:${session}`).slice(0, 24), name }
      : undefined
  let usage: Record<string, unknown>, request: string | null, at: unknown, selectedModel: unknown
  if (segment) {
    if (path.basename(path.dirname(filename)) !== 'segments') return { recognized: false }
    if (e.type !== 'model.response.completed')
      return { recognized: typeof e.type === 'string', title }
    usage = object(e.data)
    request = identifier(e.request_id)
    at = e.ts
    selectedModel = usage.model
  } else if (software === 'workbuddy') {
    if (!['message', 'function_call', 'assistant'].includes(String(e.type)) || e.role === 'user')
      return { recognized: typeof e.type === 'string', title }
    if (!pd.rawUsage || typeof pd.rawUsage !== 'object') return { recognized: true, title }
    usage = object(pd.rawUsage)
    // A turn/conversationRequestId may cover many model calls; never use it as request identity.
    request = identifier(pd.messageId) ?? identifier(message.id) ?? identifier(e.id)
    at = e.timestamp
    selectedModel = pd.model ?? pd.requestModelId ?? message.model
  } else {
    if (e.type !== 'assistant') return { recognized: typeof e.type === 'string', title }
    usage = object(message.usage)
    request = identifier(message.id) ?? identifier(e.uuid) ?? identifier(e.id)
    at = e.timestamp
    selectedModel = message.model
  }
  const record = request ? nativeRecord(software, session, request, at, selectedModel, usage) : null
  return { recognized: true, ...(record ? { record } : {}), title }
}
/** Prefer complete/highest stream snapshots, independently of file traversal order. */
export function mergeNativeRecord(
  previous: UsageRecord | undefined,
  next: UsageRecord,
): UsageRecord {
  if (!previous) return next
  const score = (row: UsageRecord) =>
    (row.quality === 'reported' ? 1 : 0) * 10 +
    ['input', 'output', 'cacheRead', 'cacheWrite', 'total'].filter(
      (key) => row[key as keyof UsageRecord] !== null,
    ).length
  const crossFormat =
    previous.software === 'qoder' &&
    (previous.qoderFormat === 'jsonl') !== (next.qoderFormat === 'jsonl')
  const preferNext =
    score(next) > score(previous) ||
    (score(next) === score(previous) &&
      (crossFormat
        ? next.qoderFormat === 'jsonl'
        : (next.total ?? -1) > (previous.total ?? -1) ||
          (next.total === previous.total && next.time >= previous.time)))
  const selected = preferNext ? next : previous
  return {
    ...selected,
    ...((next.sessionName ?? previous.sessionName)
      ? { sessionName: next.sessionName ?? previous.sessionName }
      : {}),
  }
}
