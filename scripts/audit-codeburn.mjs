// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { CodeburnCollector, codeburnRecord } = require(
  path.join(root, 'packages/core/dist/usage/codeburn.js'),
)
const reader = require(path.join(root, 'packages/core/vendor/codeburn/reader.cjs'))
const privateCache = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-codeburn-audit-'))
process.env.LUMI_CODEBURN_CACHE_DIR = privateCache
const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'total']
const sumRecords = (rows) =>
  Object.fromEntries(
    fields.map((key) => [key, rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)]),
  )
const collector = new CodeburnCollector()
collector.begin()
const rows = []
try {
  for (const provider of await collector.providers()) {
    const started = Date.now(),
      result = await collector.collect(provider)
    const row = {
      provider: provider.name,
      ...result.status,
      complete: result.complete,
      totals: sumRecords(result.records),
      ms: Date.now() - started,
    }
    if (result.status.state === 'ready' && !provider.network && provider.name !== 'claude') {
      // One independent upstream summary and Lumi's row map from the exact same parsed snapshot.
      const sources = await provider.discoverSessions()
      const projects = await reader.parseProviderSources(
        provider.name,
        sources,
        new Set(),
        reader.emptyCache(),
      )
      const reference = Object.fromEntries(fields.map((key) => [key, 0])),
        normalized = new Map()
      for (const project of projects)
        for (const session of project.sessions) {
          reference.input += session.totalInputTokens
          reference.output +=
            session.totalOutputTokens +
            (['claude', 'codex', 'copilot', 'dsh'].includes(provider.name)
              ? 0
              : session.totalReasoningTokens)
          reference.cacheRead += session.totalCacheReadTokens
          reference.cacheWrite += session.totalCacheWriteTokens
          for (const turn of session.turns)
            for (const call of turn.assistantCalls) {
              const record = codeburnRecord(call, session.sessionId, session.title)
              if (record) normalized.set(record.id, record)
            }
        }
      reference.total =
        reference.input + reference.output + reference.cacheRead + reference.cacheWrite
      const lumi = sumRecords([...normalized.values()])
      row.comparison = {
        sameSnapshot: true,
        reference,
        lumi,
        differences: fields.filter((key) => reference[key] !== lumi[key]),
        records: normalized.size,
      }
    }
    rows.push(row)
    process.stdout.write(`${provider.name}: ${row.state}, ${row.records} records\n`)
  }
  await fs.mkdir(path.join(root, 'reports'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'reports/codeburn-local-audit.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), rows }, null, 2) + '\n',
  )
  if (rows.some((row) => row.comparison?.differences.length))
    throw new Error('codeburn_accounting_comparison_failed')
} finally {
  await fs.rm(privateCache, { recursive: true, force: true })
}
