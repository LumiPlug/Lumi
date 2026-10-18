// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import { usageSoftwareIds } from '@lumiplug/shared'
import type { UsageRecord, UsageSoftware, UsageSource } from '@lumiplug/shared'
import * as reader from '../../vendor/codeburn/reader.cjs'
import type { Cache, Call, Provider, Source } from '../../vendor/codeburn/reader.cjs'
import { count, hash, model } from './adapters'

export const CODEBURN_COMMIT = '9a40cc603fcd194caca9daa8c5134a61ea7e0e2b'
function displayName(value: unknown) {
  if (typeof value !== 'string') return undefined
  return (
    value
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 200) || undefined
  )
}
/** Cache-read is not added twice via its cachedInputTokens alias. Reasoning follows upstream. */
export function codeburnRecord(call: Call, sessionId: string, title?: string): UsageRecord | null {
  if (!usageSoftwareIds.includes(call.provider as UsageSoftware)) return null
  const time = new Date(call.timestamp)
  if (!Number.isFinite(time.getTime()) || !call.deduplicationKey || !sessionId) return null
  const input = count(call.usage.inputTokens),
    output = count(
      reader.billableOutputTokens(
        call.provider,
        call.usage.outputTokens,
        call.usage.reasoningTokens,
      ),
    ),
    cacheRead = count(call.usage.cacheReadInputTokens),
    cacheWrite = count(call.usage.cacheCreationInputTokens)
  const parts = [input, output, cacheRead, cacheWrite]
  const total = parts.every((part) => part !== null)
    ? parts.reduce<number>((sum, part) => sum + part!, 0)
    : null
  const sessionName = displayName(
    call.provider === 'vercel-gateway'
      ? `${time.toISOString().slice(0, 10)} · ${call.model} · 日汇总`
      : title,
  )
  return {
    id: hash(`codeburn:${call.provider}:${call.deduplicationKey}`),
    reader: 'codeburn',
    software: call.provider as UsageSoftware,
    time: time.toISOString(),
    session: hash(`codeburn:${call.provider}:${sessionId}`).slice(0, 24),
    model: model(call.model),
    ...(sessionName ? { sessionName } : {}),
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    inputIncludesCache: false,
    quality: total === null ? 'missing' : call.isEstimated ? 'estimated' : 'reported',
    ...(call.requestCount ? { requestCount: call.requestCount } : {}),
  }
}
export interface CollectedProvider {
  status: UsageSource
  records: UsageRecord[]
  complete: boolean
  /** Local request ledgers survive source rotation/retention; upstream uses reconciliation. */
  persistence?: 'upsert'
}
/** The same full-file cache/reconciliation path as CodeBurn, retained only in memory. */
export class CodeburnCollector {
  private cache: Cache
  private seen = new Set<string>()
  constructor(cache?: Cache) {
    this.cache =
      cache && cache.version === reader.emptyCache().version ? cache : reader.emptyCache()
  }
  begin() {
    this.seen.clear()
  }
  snapshot(): Cache {
    return JSON.parse(
      JSON.stringify(this.cache, (key, value) => {
        if (key === 'userMessage') return ''
        // Incremental Codex estimates require only this length, never the prompt text.
        if (key === 'pendingUserMessage' && typeof value === 'string')
          return ' '.repeat(value.length)
        if (
          [
            'bashCommands',
            'toolSequence',
            'pendingTools',
            'pendingToolSequence',
            'pendingSkills',
            'tools',
            'skills',
            'subagentTypes',
            'mcpInventory',
            'prRefs',
            'prLinks',
          ].includes(key)
        )
          return []
        return value
      }),
    ) as Cache
  }
  async providers() {
    return reader.getAllProviders()
  }
  async collect(
    provider: Provider,
    stopped: () => boolean = () => false,
  ): Promise<CollectedProvider> {
    const status: UsageSource = {
      software: provider.name as UsageSoftware,
      state: 'absent',
      files: 0,
      records: 0,
      issues: 0,
      experimental: false,
    }
    const records = new Map<string, UsageRecord>()
    const seen = this.seen
    let complete = true
    reader.clearProviderIssue(provider.name, 'locate')
    reader.clearProviderIssue(provider.name, 'parse')
    try {
      const sources = await provider.discoverSessions()
      if (stopped()) return { status, records: [], complete: false }
      const roots = (await provider.probeRoots?.()) ?? []
      const exists =
        sources.length > 0 ||
        (
          await Promise.all(
            roots.map((root) =>
              fs.stat(root.path).then(
                () => true,
                () => false,
              ),
            ),
          )
        ).some(Boolean)
      status.files = sources.length
      status.state = exists ? 'empty' : 'absent'
      const regular: Source[] = []
      function save(call: Call, session: string, title?: string) {
        const row = codeburnRecord(call, session, title)
        if (row) records.set(row.id, row)
      }
      for (const source of sources) {
        if (stopped()) {
          complete = false
          break
        }
        if (provider.name !== 'claude' || source.sourceKind === 'claude-desktop-ledger') {
          regular.push(source)
          continue
        }
        const files = await reader.collectJsonlFiles(source.path)
        status.files += Math.max(0, files.length - 1)
        for (const file of files) {
          if (stopped()) {
            complete = false
            break
          }
          const result = await reader.parseClaudeFileFull(file, seen)
          if (!result) {
            status.issues++
            complete = false
            continue
          }
          for (const turn of result.turns)
            for (const call of turn.calls) save(call, path.basename(file, '.jsonl'), result.title)
        }
      }
      if ((regular.length || provider.name !== 'claude') && !stopped()) {
        const projects = await reader.parseProviderSources(
          provider.name,
          regular,
          seen,
          this.cache,
          provider.network
            ? { start: new Date(Date.now() - 367 * 86400000), end: new Date() }
            : undefined,
        )
        for (const project of projects)
          for (const session of project.sessions)
            for (const turn of session.turns)
              for (const call of turn.assistantCalls) save(call, session.sessionId, session.title)
      }
      const issues = reader.providerIssues().filter((issue) => issue.provider === provider.name)
      status.issues += issues.length
      complete &&= issues.length === 0 && !stopped()
      status.records = records.size
      status.experimental = [...records.values()].some((row) => row.quality === 'estimated')
      if (status.records && exists) status.state = complete ? 'ready' : 'partial'
      else if (status.issues)
        status.state = issues.some((issue) => issue.kind === 'eacces') ? 'denied' : 'incompatible'
    } catch (error) {
      complete = false
      status.issues++
      status.state = (error as NodeJS.ErrnoException).code === 'EACCES' ? 'denied' : 'incompatible'
    }
    return { status, records: [...records.values()], complete }
  }
}
