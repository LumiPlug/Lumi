// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  nativeUsageSoftwareIds,
  type NativeUsageSoftware,
  type UsageRecord,
  type UsageSource,
} from '@lumiplug/shared'
import type { CollectedProvider } from './codeburn'
import { discover, safeStat } from './discovery'
import {
  displayName,
  mergeNativeRecord,
  nativeRecord,
  object,
  parseNativeLine,
} from './native-adapters'

export interface NativeUsageRoot {
  software: NativeUsageSoftware
  directory: string
  sqlite?: boolean
  origin?: 'international' | 'cn'
}
export function nativeUsageRoots(home: string, platform = process.platform): NativeUsageRoot[] {
  const support =
    platform === 'darwin'
      ? path.join(home, 'Library/Application Support')
      : platform === 'win32'
        ? path.join(home, 'AppData/Roaming')
        : path.join(home, '.config')
  return [
    {
      software: 'qoder',
      directory: path.join(support, 'Qoder/SharedClientCache/cache/db/local.db'),
      sqlite: true,
    },
    { software: 'qoder', directory: path.join(home, '.qoder/projects'), origin: 'international' },
    { software: 'qoder', directory: path.join(home, '.qoder-cn/projects'), origin: 'cn' },
    { software: 'qoderwork', directory: path.join(home, '.qoderwork/projects') },
    { software: 'workbuddy', directory: path.join(home, '.workbuddy/projects') },
    { software: 'qwenwork', directory: path.join(home, '.qwenworkcn/logs/sessions') },
  ]
}
interface FileResult {
  records: UsageRecord[]
  titles: Map<string, string>
  recognized: boolean
  issues: number
  limited: boolean
}
interface CachedFile {
  stamp: string
  result: FileResult
}
const MAX_BYTES = 64 * 1024 * 1024
const MAX_SCAN_BYTES = 128 * 1024 * 1024
const MAX_RECORDS = 100000
const MAX_LINE = 4 * 1024 * 1024
const CACHE_SETTLE_MS = 2000

async function fileState(filename: string, sqlite = false) {
  const stat = await safeStat(filename)
  let stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  let latestChange = Math.max(stat.mtimeMs, stat.ctimeMs)
  if (sqlite) {
    for (const suffix of ['-shm', '-wal']) {
      try {
        const sidecar = await safeStat(filename + suffix)
        if (suffix === '-wal') {
          stamp += `:${sidecar.ino}:${sidecar.size}:${sidecar.mtimeMs}:${sidecar.ctimeMs}`
          latestChange = Math.max(latestChange, sidecar.mtimeMs, sidecar.ctimeMs)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  return { stat, stamp, latestChange }
}

/** Read-only, bounded sources. The cache contains counters/explicit titles, never raw JSON. */
export class NativeUsageCollector {
  private cache = new Map<string, CachedFile>()
  private cachedRows = 0
  constructor(private readonly roots: NativeUsageRoot[]) {}
  private forget(filename: string) {
    const previous = this.cache.get(filename)
    if (previous)
      this.cachedRows -= previous.result.records.length + previous.result.titles.size + 1
    this.cache.delete(filename)
  }
  private remember(filename: string, cached: CachedFile) {
    this.forget(filename)
    const rows = cached.result.records.length + cached.result.titles.size + 1
    if (rows > MAX_RECORDS) return
    while (this.cachedRows + rows > MAX_RECORDS && this.cache.size)
      this.forget(this.cache.keys().next().value!)
    this.cache.set(filename, cached)
    this.cachedRows += rows
  }
  async collect(
    software: NativeUsageSoftware,
    stopped: () => boolean = () => false,
    onProgress?: (source: UsageSource) => void,
  ): Promise<CollectedProvider> {
    const status: UsageSource = {
      software,
      state: 'absent',
      files: 0,
      records: 0,
      issues: 0,
      experimental: false,
      filesProgress: {
        stage: 'discovering',
        discovered: 0,
        checked: 0,
        read: 0,
        cached: 0,
        deferred: 0,
        limited: 0,
        failed: 0,
        discoveryLimited: false,
      },
    }
    const records = new Map<string, UsageRecord>(),
      titles = new Map<string, string>()
    const problems = new Set<NonNullable<UsageSource['problems']>[number]>()
    let exists = false,
      recognized = false,
      bytes = 0,
      missing = false
    const active = new Set<string>()
    const progress = status.filesProgress!
    const publish = () => {
      status.records = records.size
      onProgress?.({ ...status, filesProgress: { ...progress }, problems: [...problems] })
    }
    const candidates: Array<{
      root: NativeUsageRoot
      filename: string
      latestChange: number
    }> = []
    const problem = (kind: NonNullable<UsageSource['problems']>[number]) => {
      status.issues++
      problems.add(kind)
    }
    for (const root of this.roots.filter((root) => root.software === software)) {
      if (stopped()) break
      try {
        const found = await discover(root, stopped)
        exists = true
        status.issues += found.issues
        if (found.denied) problems.add('denied')
        if (found.limited) problems.add('limit')
        progress.discoveryLimited ||= found.limited
        if (found.issues && !found.denied) problems.add('incompatible')
        const files =
          root.sqlite || software !== 'qwenwork'
            ? found.files
            : found.files.filter((filename) => path.basename(path.dirname(filename)) === 'segments')
        for (const filename of files) {
          if (stopped()) break
          status.files++
          progress.discovered++
          active.add(filename)
          try {
            const { latestChange } = await fileState(filename, root.sqlite)
            candidates.push({ root, filename, latestChange })
          } catch (error) {
            progress.checked++
            progress.failed++
            const code = (error as NodeJS.ErrnoException).code
            problem(code === 'EACCES' || code === 'EPERM' ? 'denied' : 'incompatible')
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          exists = true
          problem(code === 'EACCES' || code === 'EPERM' ? 'denied' : 'incompatible')
        }
      }
      publish()
    }
    progress.stage = 'reading'
    // Recent changes from either Qoder root get a chance within the same bounded round.
    candidates.sort((a, b) => b.latestChange - a.latestChange || (a.filename < b.filename ? -1 : 1))
    publish()
    for (const { root, filename } of candidates) {
      if (stopped()) break
      try {
        // A file/WAL can change while the other candidates are being discovered.
        const { stat, stamp, latestChange } = await fileState(filename, root.sqlite)
        const cached = this.cache.get(filename)
        // Coarse filesystem clocks can give rapid same-size rewrites identical stamps.
        const settled = Date.now() - latestChange > CACHE_SETTLE_MS
        let result = settled && cached?.stamp === stamp ? cached.result : undefined
        if (!result) {
          if (!root.sqlite && stat.size > MAX_BYTES) {
            progress.limited++
            problem('limit')
            continue
          }
          if (!root.sqlite && bytes + stat.size > MAX_SCAN_BYTES) {
            progress.deferred++
            problem('limit')
            continue
          }
          bytes += root.sqlite ? 0 : stat.size
          result = root.sqlite
            ? this.readQoder(filename, stopped)
            : await this.readJsonl(software, filename, stopped, root.origin)
          progress.read++
          const after = await safeStat(filename)
          // A changing/partial file is retried; normalized completed rows can still be upserted.
          if (
            !stopped() &&
            after.size === stat.size &&
            after.mtimeMs === stat.mtimeMs &&
            !result.limited
          )
            this.remember(filename, { stamp, result })
        } else progress.cached++
        status.issues += result.issues
        if (result.issues) problems.add('incompatible')
        if (result.limited) problems.add('limit')
        if (result.limited) progress.limited++
        recognized ||= result.recognized
        for (const [id, title] of result.titles) titles.set(id, title)
        for (const record of result.records) {
          if (!records.has(record.id) && records.size >= MAX_RECORDS) {
            progress.limited++
            problem('limit')
            break
          }
          records.set(record.id, mergeNativeRecord(records.get(record.id), record))
        }
      } catch (error) {
        progress.failed++
        const code = (error as NodeJS.ErrnoException).code
        problem(code === 'EACCES' || code === 'EPERM' ? 'denied' : 'incompatible')
      } finally {
        progress.checked++
        publish()
      }
    }
    // Remove only this source's dead file caches; the persistent request ledger retains history.
    for (const filename of this.cache.keys())
      if (
        this.roots.some(
          (root) =>
            root.software === software &&
            (filename === root.directory || filename.startsWith(root.directory + path.sep)),
        ) &&
        !active.has(filename)
      )
        this.forget(filename)
    for (const record of records.values()) {
      const title = titles.get(record.session)
      if (title) record.sessionName = title
      missing ||= record.quality === 'missing'
    }
    if (missing) problems.add('missing_usage')
    if (status.files && !recognized && !records.size && !problems.size) problem('incompatible')
    status.records = records.size
    progress.stage = stopped() ? progress.stage : 'done'
    status.problems = [...problems]
    status.state = problems.has('denied')
      ? 'denied'
      : problems.has('limit') || problems.has('incompatible')
        ? records.size
          ? 'partial'
          : 'incompatible'
        : missing
          ? [...records.values()].some((record) => record.quality === 'reported')
            ? 'partial'
            : 'missing_usage'
          : records.size
            ? 'ready'
            : exists
              ? 'empty'
              : 'absent'
    return {
      status,
      records: [...records.values()],
      complete: !stopped() && !problems.size,
      persistence: 'upsert',
    }
  }
  private async readJsonl(
    software: NativeUsageSoftware,
    filename: string,
    stopped: () => boolean,
    origin: 'international' | 'cn' = 'international',
  ): Promise<FileResult> {
    const result: FileResult = {
      records: [],
      titles: new Map(),
      recognized: false,
      issues: 0,
      limited: false,
    }
    const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const rows = new Map<string, UsageRecord>()
    let pending = Buffer.alloc(0),
      consumed = 0,
      oversized = false
    try {
      while (!stopped()) {
        const buffer = Buffer.alloc(65536)
        const { bytesRead } = await handle.read(buffer)
        if (!bytesRead) break
        consumed += bytesRead
        if (consumed > MAX_BYTES) {
          result.limited = true
          break
        }
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)])
        let newline: number
        while ((newline = pending.indexOf(10)) >= 0) {
          const line = pending.subarray(0, newline)
          pending = pending.subarray(newline + 1)
          if (oversized) {
            oversized = false
            continue
          }
          if (line.length > MAX_LINE) {
            result.issues++
            continue
          }
          if (!line.toString('utf8').trim()) continue
          try {
            const parsed = parseNativeLine(
              software,
              JSON.parse(line.toString('utf8')),
              filename,
              origin,
            )
            result.recognized ||= parsed.recognized
            if (parsed.title && result.titles.size < MAX_RECORDS)
              result.titles.set(parsed.title.session, parsed.title.name)
            if (parsed.record)
              rows.set(
                parsed.record.id,
                mergeNativeRecord(rows.get(parsed.record.id), parsed.record),
              )
            if (rows.size >= MAX_RECORDS) {
              result.limited = true
              break
            }
          } catch {
            result.issues++
          }
        }
        if (result.limited) break
        if (pending.length > MAX_LINE) {
          result.issues++
          oversized = true
          pending = Buffer.alloc(0)
        }
      }
    } finally {
      await handle.close()
    }
    if (consumed === 0) result.recognized = true
    result.records = [...rows.values()]
    return result
  }
  private readQoder(filename: string, stopped: () => boolean): FileResult {
    const result: FileResult = {
      records: [],
      titles: new Map(),
      recognized: true,
      issues: 0,
      limited: false,
    }
    const db = new DatabaseSync(filename, { readOnly: true })
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100;')
      const columns = new Set(
        db
          .prepare('PRAGMA table_info(chat_message)')
          .all()
          .map((row) => String(row.name)),
      )
      if (
        !['session_id', 'gmt_create', 'role', 'token_info'].every((column) => columns.has(column))
      )
        throw new Error('qoder_schema_incompatible')
      const identity = ['message_id', 'id', 'uuid'].find((column) => columns.has(column)) ?? 'rowid'
      const rows = db
        .prepare(
          `SELECT "${identity}" AS request, session_id, gmt_create, token_info,
        ${columns.has('model_info') ? 'model_info' : 'NULL'} AS model_info
        FROM chat_message WHERE role='assistant' ORDER BY gmt_create LIMIT ${MAX_RECORDS + 1}`,
        )
        .iterate()
      for (const row of rows) {
        if (stopped()) break
        if (result.records.length >= MAX_RECORDS) {
          result.limited = true
          break
        }
        let usage: Record<string, unknown>, selectedModel: Record<string, unknown>
        try {
          usage = row.token_info ? object(JSON.parse(String(row.token_info))) : {}
          selectedModel = row.model_info ? object(JSON.parse(String(row.model_info))) : {}
        } catch {
          result.issues++
          continue
        }
        const at =
          typeof row.gmt_create === 'string' && /^\d+$/.test(row.gmt_create)
            ? Number(row.gmt_create)
            : row.gmt_create
        const record = nativeRecord(
          'qoder',
          String(row.session_id ?? ''),
          String(row.request ?? ''),
          at,
          selectedModel.model_key ?? selectedModel.model_id ?? selectedModel.model,
          usage,
        )
        if (record)
          result.records.push({
            ...record,
            qoderFormat: 'sqlite',
            qoderOrigin: 'international',
            ...(identity !== 'rowid' && typeof row.request === 'string' && row.request.length > 0
              ? { qoderRequest: record.id, qoderIdentity: record.id }
              : {}),
          })
        else result.issues++
      }
      const titleColumns = new Set(
        db
          .prepare('PRAGMA table_info(chat_session)')
          .all()
          .map((row) => String(row.name)),
      )
      if (titleColumns.has('session_id') && titleColumns.has('session_title')) {
        for (const row of db
          .prepare(`SELECT session_id, session_title FROM chat_session LIMIT ${MAX_RECORDS}`)
          .iterate()) {
          const title = displayName(row.session_title)
          if (!title) continue
          const record = nativeRecord(
            'qoder',
            String(row.session_id ?? ''),
            'title',
            0,
            null,
            {},
            title,
          )
          if (record) result.titles.set(record.session, title)
        }
      }
    } finally {
      db.close()
    }
    return result
  }
}
export { nativeUsageSoftwareIds }
