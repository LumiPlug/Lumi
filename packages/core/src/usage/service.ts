// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import type {
  UsageRecord,
  UsageSource,
  UsageReport,
  UsageTotals,
  UsageGroup,
  UsageSoftware,
  UsageSession,
  UsageSessionPage,
} from '@lumiplug/shared'
import { codexSessionMeta, cursorRecord, hash, parseLine, type ParserState } from './adapters'
import { discover, safeStat, standardRoots, type UsageRoot } from './discovery'
import { readCodexSessionNames } from './session-names'
import { sessionsCsv } from './csv'
import type { CodeburnCollector } from './codeburn'
import { UsageCollector } from './collector'
import { mergeNativeRecord } from './native-adapters'
import type { Cache } from '../../vendor/codeburn/reader.cjs'
interface Checkpoint {
  offset: number
  inode: string
  prefix: string
  prefixBytes: number
  parser: ParserState
  issues?: number
}
const softwareNames: UsageSoftware[] = ['codex', 'claude', 'cursor']
const zero = (): UsageTotals => ({
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
  total: null,
  count: 0,
})
function add(target: UsageTotals, record: UsageRecord) {
  target.count++
  if (record.quality !== 'reported' && record.quality !== 'estimated') return
  if (record.quality === 'estimated') target.estimatedCount = (target.estimatedCount ?? 0) + 1
  if (record.reader === 'codeburn' || record.reader === 'native') {
    const includesCache = record.reader === 'codeburn' ? false : record.inputIncludesCache
    target.inputIncludesCache =
      target.inputIncludesCache === undefined
        ? includesCache
        : target.inputIncludesCache === includesCache
          ? target.inputIncludesCache
          : null
  }
  for (const key of ['input', 'output', 'total', 'cacheRead', 'cacheWrite'] as const)
    if (record[key] !== null) target[key] = (target[key] ?? 0) + record[key]!
}
export class UsageService {
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private readonly roots: UsageRoot[]
  private readonly codeburn: CodeburnCollector | null
  private sessionNames = new Map<string, string>()
  constructor(
    private readonly db: DatabaseSync,
    roots?: UsageRoot[],
    collector?: CodeburnCollector,
  ) {
    this.roots = roots ?? standardRoots(os.homedir())
    this.codeburn =
      collector ??
      (roots === undefined
        ? new UsageCollector(this.state<Cache>('codeburn-cache') ?? undefined)
        : null)
  }
  get paused(): boolean {
    return this.state<boolean>('paused') ?? false
  }
  private state<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM usage_state WHERE key=?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : null
  }
  private saveState(key: string, value: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO usage_state VALUES (?,?)')
      .run(key, JSON.stringify(value))
  }
  start() {
    if (this.timer || this.stopped) return
    void this.scan().catch(() => {})
    this.timer = setInterval(() => {
      void this.scan().catch(() => {})
    }, 60000)
    this.timer.unref()
  }
  async close() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    await this.running
  }
  async setPaused(paused: boolean) {
    this.saveState('paused', paused)
    if (paused) await this.running
    else await this.scan()
  }
  scan(): Promise<void> {
    if (this.running) return this.running
    if (this.paused || this.stopped) return Promise.resolve()
    this.running = this.collect().finally(() => {
      this.running = null
    })
    return this.running
  }
  private saveRecord(record: UsageRecord) {
    const previous = this.db.prepare('SELECT data FROM usage_records WHERE id=?').get(record.id) as
      { data: string } | undefined
    if (previous && record.software === 'codex') {
      const old = JSON.parse(previous.data) as UsageRecord
      if (record.counterBasis !== 'delta' || old.counterBasis === 'delta') return
    }
    if (previous && record.software !== 'codex') {
      const old = JSON.parse(previous.data) as UsageRecord
      if (record.time < old.time) return
      // Prefer the latest stream snapshot, retaining fields omitted in a partial update.
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const)
        record[key] ??= old[key]
      record.model ??= old.model
      if (record.software === 'claude') {
        const parts = [record.input, record.output, record.cacheRead, record.cacheWrite]
        record.total = parts.every((x) => x !== null)
          ? parts.reduce<number>((a, b) => a + b!, 0)
          : null
      } else if (record.input !== null && record.output !== null)
        record.total = record.input + record.output
      if (
        [record.input, record.output, record.cacheRead, record.cacheWrite].some(
          (value) => value !== null,
        )
      )
        record.quality = 'reported'
    }
    this.db
      .prepare(
        'INSERT INTO usage_records (id,software,time,model,data) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET time=excluded.time,model=excluded.model,data=excluded.data',
      )
      .run(record.id, record.software, record.time, record.model, JSON.stringify(record))
  }
  private async collect() {
    if (!this.codeburn) return this.collectLegacy()
    this.codeburn.begin()
    const sources: UsageSource[] = []
    for (const provider of await this.codeburn.providers()) {
      if (this.paused || this.stopped) return
      const result = await this.codeburn.collect(provider, () => this.paused || this.stopped)
      if (this.paused || this.stopped) return
      // Only a complete source read may replace legacy IDs or remove reconciled rollups.
      // A failed refresh preserves its last good snapshot, never a mixed accounting generation.
      if (
        (result.complete || result.persistence === 'upsert') &&
        result.status.state !== 'absent'
      ) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
          if (result.persistence !== 'upsert')
            this.db.prepare('DELETE FROM usage_records WHERE software=?').run(provider.name)
          const insert = this.db.prepare(
            'INSERT INTO usage_records (id,software,time,model,data) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET time=excluded.time,model=excluded.model,data=excluded.data',
          )
          const previous =
            result.persistence === 'upsert'
              ? this.db.prepare('SELECT data FROM usage_records WHERE id=?')
              : null
          for (let record of result.records) {
            if (result.persistence === 'upsert') {
              const old = previous!.get(record.id)
              record = mergeNativeRecord(
                old ? (JSON.parse(old.data as string) as UsageRecord) : undefined,
                record,
              )
            }
            insert.run(
              record.id,
              record.software,
              record.time,
              record.model,
              JSON.stringify(record),
            )
          }
          this.db.exec('COMMIT')
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
      }
      sources.push(result.status)
      // Publish source discovery progressively so one slow tool doesn't hide all the others.
      const known = this.state<UsageSource[]>('sources') ?? []
      this.saveState('sources', [
        ...sources,
        ...known.filter(
          (source) => !sources.some((current) => current.software === source.software),
        ),
      ])
    }
    const codex = (await this.codeburn.providers()).find((provider) => provider.name === 'codex')
    const codexRoots = ((await codex?.probeRoots?.()) ?? []).map((root) => ({
      software: 'codex' as const,
      directory: root.path,
    }))
    this.sessionNames = await readCodexSessionNames(
      codexRoots,
      () => this.paused || this.stopped,
      (id) => hash(`codeburn:codex:${id}`).slice(0, 24),
    )
    if (!this.paused && !this.stopped) {
      this.saveState('codeburn-cache', this.codeburn.snapshot())
      this.saveState('sources', sources)
      this.saveState('updatedAt', new Date().toISOString())
    }
  }
  private async collectLegacy() {
    const sources: UsageSource[] = []
    for (const software of softwareNames) {
      if (this.paused || this.stopped) break
      const status: UsageSource = {
        software,
        state: 'absent',
        files: 0,
        records: 0,
        issues: 0,
        experimental: software === 'cursor',
      }
      let exists = false,
        denied = false,
        incompatible = false,
        limited = false
      const files: Array<{ filename: string; sqlite: boolean }> = []
      for (const root of this.roots.filter((x) => x.software === software)) {
        if (this.paused || this.stopped) break
        try {
          const result = await discover(root, () => this.paused || this.stopped)
          exists = true
          status.files += result.files.length
          status.issues += result.issues
          limited ||= result.limited
          denied ||= result.denied
          for (const filename of result.files) files.push({ filename, sqlite: !!root.sqlite })
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ENOENT') {
            status.issues++
            if (code === 'EACCES' || code === 'EPERM') denied = true
            else incompatible = true
          }
        }
      }
      // Resolve all known parent links before parsing any history, including nested forks.
      if (software === 'codex')
        for (const { filename } of files) {
          if (this.paused || this.stopped) break
          try {
            await this.registerLineage(filename)
          } catch {
            /* The read below reports failures. */
          }
        }
      for (const { filename, sqlite } of files) {
        if (this.paused || this.stopped) break
        try {
          if (sqlite) {
            const cursorLimited = await this.readCursor(filename)
            limited ||= cursorLimited
          } else {
            const result = await this.readLog(filename, software as 'codex' | 'claude')
            status.issues += result.issues
            incompatible ||= result.incompatible
            limited ||= result.limited
          }
        } catch (error) {
          status.issues++
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'EACCES' || code === 'EPERM') denied = true
          else incompatible = true
        }
      }
      status.records = (
        this.db
          .prepare('SELECT count(*) AS n FROM usage_records WHERE software=?')
          .get(software) as { n: number }
      ).n
      const reported = (
        this.db
          .prepare(
            "SELECT count(*) AS n FROM usage_records WHERE software=? AND json_extract(data,'$.quality')='reported'",
          )
          .get(software) as { n: number }
      ).n
      const complete = (
        this.db
          .prepare(
            "SELECT count(*) AS n FROM usage_records WHERE software=? AND json_extract(data,'$.total') IS NOT NULL AND json_extract(data,'$.quality')='reported'",
          )
          .get(software) as { n: number }
      ).n
      status.problems = [
        ...(denied ? ['denied' as const] : []),
        ...(incompatible ? ['incompatible' as const] : []),
        ...(limited ? ['limit' as const] : []),
        ...(status.records > complete ? ['missing_usage' as const] : []),
      ]
      status.state = denied
        ? reported
          ? 'partial'
          : 'denied'
        : incompatible
          ? reported
            ? 'partial'
            : 'incompatible'
          : status.issues || limited
            ? 'partial'
            : !exists
              ? 'absent'
              : !status.files
                ? 'empty'
                : status.records === 0
                  ? 'empty'
                  : complete === 0
                    ? 'missing_usage'
                    : complete < status.records
                      ? 'partial'
                      : 'ready'
      sources.push(status)
    }
    const names = await readCodexSessionNames(this.roots, () => this.paused || this.stopped)
    if (!this.paused && !this.stopped) {
      this.sessionNames = names
      this.saveState('sources', sources)
      this.saveState('updatedAt', new Date().toISOString())
    }
  }
  private async registerLineage(filename: string) {
    await safeStat(filename)
    const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      let head = Buffer.alloc(0),
        position = 0
      while (head.length <= 4 * 1024 * 1024 && !this.paused && !this.stopped) {
        const buffer = Buffer.alloc(65536),
          { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) return
        position += bytesRead
        head = Buffer.concat([head, buffer.subarray(0, bytesRead)])
        if (head.indexOf(10) >= 0) break
      }
      const newline = head.indexOf(10)
      if (newline < 0 || this.paused || this.stopped) return
      const meta = codexSessionMeta(head.subarray(0, newline).toString('utf8'))
      if (meta)
        this.db
          .prepare('INSERT OR REPLACE INTO usage_lineage VALUES (?,?,?)')
          .run(meta.id, meta.parent, meta.started)
    } finally {
      await handle.close()
    }
  }
  private lineageRoot(id: string, at?: string): string {
    const visited = new Set<string>()
    let current = id
    while (!visited.has(current) && visited.size < 64) {
      visited.add(current)
      const row = this.db
        .prepare('SELECT parent,started FROM usage_lineage WHERE id=?')
        .get(current) as { parent: string | null; started: string | null } | undefined
      if (!row?.parent || (at && row.started && at >= row.started)) return current
      current = row.parent
    }
    return [...visited].sort()[0] ?? id
  }
  private async readLog(filename: string, software: 'codex' | 'claude') {
    const stat = await safeStat(filename)
    const fileId = hash(filename)
    const row = this.db.prepare('SELECT data FROM usage_files WHERE id=?').get(fileId) as
      { data: string } | undefined
    let checkpoint = row ? (JSON.parse(row.data) as Checkpoint) : null
    const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let issues = 0,
      limited = false
    try {
      const inode = `${stat.dev}:${stat.ino}`
      const prefixBytes = checkpoint?.prefixBytes || Math.min(stat.size, 256)
      const prefixBuffer = Buffer.alloc(prefixBytes)
      await handle.read(prefixBuffer, 0, prefixBytes, 0)
      if (
        !checkpoint ||
        checkpoint.inode !== inode ||
        checkpoint.offset > stat.size ||
        checkpoint.prefixBytes !== prefixBytes ||
        checkpoint.prefix !== hash(prefixBuffer.toString('hex'))
      )
        checkpoint = {
          offset: 0,
          inode,
          prefix: hash(prefixBuffer.toString('hex')),
          prefixBytes,
          parser: {},
        }
      let position = checkpoint.offset,
        pending = Buffer.alloc(0),
        consumed = 0,
        oversized = false
      while (position < stat.size && !this.paused && !this.stopped) {
        if (consumed >= 16 * 1024 * 1024) {
          limited = true
          break
        }
        const buffer = Buffer.alloc(Math.min(65536, stat.size - position))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (!bytesRead || this.paused || this.stopped) break
        position += bytesRead
        consumed += bytesRead
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)])
        let newline: number
        while ((newline = pending.indexOf(10)) >= 0) {
          const line = pending.subarray(0, newline)
          checkpoint.offset = position - pending.length + newline + 1
          pending = pending.subarray(newline + 1)
          if (oversized) {
            oversized = false
            continue
          }
          try {
            for (const record of parseLine(
              software,
              line.toString('utf8'),
              checkpoint.parser,
              fileId,
              (id, at) => this.lineageRoot(id, at),
            ))
              if (software !== 'codex' || checkpoint.parser.session) this.saveRecord(record)
              else issues++
          } catch {
            issues++
          }
        }
        if (pending.length > 4 * 1024 * 1024) {
          issues++
          oversized = true
          pending = Buffer.alloc(0)
        }
      }
      // Only checkpoint complete lines. A partial final JSON object is retried next scan.
      checkpoint.issues = (checkpoint.issues ?? 0) + issues
      issues = checkpoint.issues
      this.db
        .prepare('INSERT OR REPLACE INTO usage_files VALUES (?,?)')
        .run(fileId, JSON.stringify(checkpoint))
    } finally {
      await handle.close()
    }
    return {
      issues,
      limited,
      incompatible: !checkpoint?.parser.recognized && (checkpoint?.offset ?? 0) > 0,
    }
  }
  private async readCursor(filename: string): Promise<boolean> {
    await safeStat(filename)
    const source = new DatabaseSync(filename, { readOnly: true })
    try {
      source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100;')
      // Projection excludes text, tools, credentials, and all unrelated SQLite tables.
      const rows = source
        .prepare(
          `SELECT key, json_extract(value,'$.tokenCount.inputTokens') AS input,
        json_extract(value,'$.tokenCount.outputTokens') AS output, json_extract(value,'$.modelInfo.modelName') AS model,
        json_extract(value,'$.createdAt') AS time FROM cursorDiskKV
        WHERE key >= 'bubbleId:' AND key < 'bubbleId;' AND json_valid(value) LIMIT 100001`,
        )
        .all()
      for (const row of rows.slice(0, 100000)) {
        if (this.paused || this.stopped) break
        const record = cursorRecord(row)
        if (record) this.saveRecord(record)
      }
      // Context meters are deliberately not read or converted into consumption.
      return rows.length > 100000
    } finally {
      source.close()
    }
  }
  private queryPeriod(payload: Record<string, unknown>) {
    const start =
      typeof payload.start === 'string'
        ? new Date(payload.start)
        : new Date(Date.now() - 30 * 86400000)
    const end = typeof payload.end === 'string' ? new Date(payload.end) : new Date()
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      end.getTime() - start.getTime() > 367 * 86400000
    )
      throw new Error('usage_invalid_range')
    const timezone =
      typeof payload.timezone === 'string'
        ? payload.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return { start, end, formatter }
  }
  validateQuery(payload: Record<string, unknown>) {
    this.queryPeriod(payload)
  }
  private *filteredRecords(
    payload: Record<string, unknown>,
    start: Date,
    end: Date,
  ): Generator<UsageRecord> {
    const clauses = ['time>=?', 'time<?'],
      params: string[] = [start.toISOString(), end.toISOString()]
    if (payload.detectedOnly === true) {
      const detected = (this.state<UsageSource[]>('sources') ?? [])
        .filter((source) => source.state !== 'absent')
        .map((source) => source.software)
      if (detected.length === 0) return
      clauses.push(`software IN (${detected.map(() => '?').join(',')})`)
      params.push(...detected)
    }
    for (const key of ['software', 'model'] as const)
      if (typeof payload[key] === 'string') {
        clauses.push(`${key}=?`)
        params.push(payload[key])
      }
    if (payload.model === null) clauses.push('model IS NULL')
    if (payload.software !== 'vercel-gateway') clauses.push("software != 'vercel-gateway'")
    for (const row of this.db
      .prepare(
        `SELECT data FROM usage_records WHERE ${clauses.join(' AND ')} ORDER BY time DESC,id`,
      )
      .iterate(...params)) {
      const record = JSON.parse(row.data as string) as UsageRecord
      if (typeof payload.session !== 'string' || record.session === payload.session) yield record
    }
  }
  private queryOffset(payload: Record<string, unknown>): number {
    return typeof payload.offset === 'number' &&
      Number.isSafeInteger(payload.offset) &&
      payload.offset >= 0
      ? payload.offset
      : 0
  }
  private sessionSummaries(payload: Record<string, unknown>): UsageSession[] {
    const { start, end } = this.queryPeriod(payload)
    const groups = new Map<string, UsageSession>()
    for (const record of this.filteredRecords(payload, start, end)) {
      const key = `${record.software}:${record.session}`
      const group = groups.get(key) ?? {
        ...zero(),
        key,
        software: record.software,
        session: record.session,
        latestTime: record.time,
        models: [],
        ...(record.software === 'codex' && this.sessionNames.has(record.session)
          ? { sessionName: this.sessionNames.get(record.session) }
          : record.sessionName
            ? { sessionName: record.sessionName }
            : {}),
      }
      add(group, record)
      if (!group.models!.includes(record.model)) group.models!.push(record.model)
      groups.set(key, group)
    }
    const search =
      typeof payload.search === 'string'
        ? payload.search.trim().slice(0, 200).toLocaleLowerCase()
        : ''
    return [...groups.values()]
      .filter(
        (group) =>
          !search ||
          [group.sessionName, group.session, group.software, ...(group.models ?? [])].some(
            (value) => value?.toLocaleLowerCase().includes(search),
          ),
      )
      .sort(
        (a, b) =>
          (payload.sort === 'tokens'
            ? (b.total ?? -1) - (a.total ?? -1)
            : b.latestTime.localeCompare(a.latestTime)) || a.key.localeCompare(b.key),
      )
  }
  exportSessions(payload: Record<string, unknown> = {}): { csv: string } {
    return { csv: sessionsCsv(this.sessionSummaries(payload)) }
  }
  querySessions(payload: Record<string, unknown> = {}): UsageSessionPage {
    const ordered = this.sessionSummaries(payload)
    const offset = this.queryOffset(payload)
    const limit =
      typeof payload.limit === 'number' && Number.isSafeInteger(payload.limit) && payload.limit > 0
        ? Math.min(200, payload.limit)
        : 200
    return {
      sessions: ordered.slice(offset, offset + limit),
      matched: ordered.length,
      truncated: ordered.length > offset + limit,
    }
  }
  query(payload: Record<string, unknown> = {}): UsageReport {
    const { start, end, formatter } = this.queryPeriod(payload)
    const totals = zero(),
      daily = new Map<string, UsageGroup & { software: UsageSoftware }>(),
      hourly =
        payload.granularity === 'hour'
          ? new Map<string, UsageGroup & { software: UsageSoftware }>()
          : null,
      software = new Map<string, UsageGroup>(),
      models = new Map<string, UsageGroup & { software: UsageSoftware; model: string | null }>()
    const records: UsageRecord[] = [],
      offset = this.queryOffset(payload)
    let matched = 0
    for (const record of this.filteredRecords(payload, start, end)) {
      if (matched++ >= offset && records.length < 200) {
        const sessionName =
          record.software === 'codex' ? this.sessionNames.get(record.session) : undefined
        const { sessionName: storedName, ...fields } = record
        const name = record.software === 'codex' ? sessionName : storedName
        records.push(name ? { ...fields, sessionName: name } : fields)
      }
      add(totals, record)
      if (hourly) {
        const key = new Date(
          start.getTime() +
            Math.floor((Date.parse(record.time) - start.getTime()) / 3600000) * 3600000,
        ).toISOString()
        const groupKey = `${key}:${record.software}`
        const group = hourly.get(groupKey) ?? { ...zero(), key, software: record.software }
        add(group, record)
        hourly.set(groupKey, group)
      }
      const day = formatter.format(new Date(record.time)),
        dayKey = `${day}:${record.software}`,
        modelKey = `${record.software}:${record.model ?? ''}`
      const d = daily.get(dayKey) ?? { ...zero(), key: day, software: record.software }
      add(d, record)
      daily.set(dayKey, d)
      const s = software.get(record.software) ?? { ...zero(), key: record.software }
      add(s, record)
      software.set(record.software, s)
      const m = models.get(modelKey) ?? {
        ...zero(),
        key: modelKey,
        software: record.software,
        model: record.model,
      }
      add(m, record)
      models.set(modelKey, m)
    }
    return {
      records,
      totals,
      daily: [...daily.values()],
      ...(hourly ? { hourly: [...hourly.values()] } : {}),
      software: [...software.values()],
      models: [...models.values()],
      matched,
      sources: this.state<UsageSource[]>('sources') ?? [],
      paused: this.paused,
      updatedAt: this.state<string>('updatedAt'),
      truncated: matched > offset + records.length,
    }
  }
}
