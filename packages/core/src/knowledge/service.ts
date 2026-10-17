// SPDX-License-Identifier: MPL-2.0
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import Ajv from 'ajv/dist/2020'
import { KnowledgeComputer, knowledgeTokens, type KnowledgeComputation } from './compute'
import {
  KNOWLEDGE_LIMITS as LIMIT,
  KNOWLEDGE_TOOLS,
  KNOWLEDGE_VERSION,
  knowledgeDataSchema,
} from '@lumiplug/shared'
import type {
  KnowledgeData,
  KnowledgeSummary,
  KnowledgeView,
  KnowledgeOperation,
  KnowledgeEvidence,
} from '@lumiplug/shared'

interface Library {
  id: string
  name: string
  description: string
  revision: number
  archived: boolean
  projectKey: string
  branch: string
  git: boolean
  commitSha: string | null
  updatedAt: string
}
interface Build {
  id: string
  kbId: string
  commitSha: string | null
  baseRevision: number
  mode: string
  seq: number
  status: 'writing' | 'validating' | 'invalid' | 'validated' | 'published' | 'cancelled'
  content: KnowledgeData
  issues: string[]
  validationId: string | null
  validationHash: string | null
  resultRevision: number | null
  publishKey: string | null
}
export class KnowledgeError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const empty = (): KnowledgeData => ({ documents: [], nodes: [], edges: [], citations: [] })
const fail = (code: string): never => {
  throw new KnowledgeError(code)
}
const active = (build: Build) => !['published', 'cancelled'].includes(build.status)

export class KnowledgeService {
  private readonly ajv = new Ajv({ strict: false, allErrors: false })
  private readonly validateData = this.ajv.compile<KnowledgeData>(knowledgeDataSchema)
  private readonly validators = new Map(
    KNOWLEDGE_TOOLS.map((tool) => [tool.name, this.ajv.compile(tool.inputSchema)]),
  )
  private shuttingDown = false
  private readonly computer = new KnowledgeComputer()
  private readonly jobs = new Set<Promise<void>>()
  constructor(private readonly db: DatabaseSync) {
    for (const row of db
      .prepare(
        "SELECT data FROM knowledge_builds WHERE json_extract(data, '$.status') = 'validating'",
      )
      .all() as { data: string }[]) {
      const build = JSON.parse(row.data) as Build
      if (build.status === 'validating') {
        build.status = 'writing'
        build.validationId = null
        build.validationHash = null
        this.saveBuild(build)
      }
    }
  }
  async shutdown() {
    this.shuttingDown = true
    await this.close()
  }
  async close() {
    await Promise.allSettled(this.jobs)
    await this.computer.drain()
  }
  private background(work: () => Promise<void>) {
    const job = new Promise<void>((resolve) => setImmediate(resolve)).then(work)
    this.jobs.add(job)
    void job.finally(() => this.jobs.delete(job)).catch(() => {})
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private library(id: string): Library {
    const row = this.db.prepare('SELECT metadata FROM knowledge_libraries WHERE id=?').get(id) as
      { metadata: string } | undefined
    return row ? (JSON.parse(row.metadata) as Library) : fail('knowledge_not_found')
  }
  private saveLibrary(library: Library) {
    this.db
      .prepare('INSERT OR REPLACE INTO knowledge_libraries VALUES (?,?,?,?)')
      .run(library.id, library.projectKey, library.branch, JSON.stringify(library))
  }
  private build(id: string, token?: string): Build {
    const row =
      (this.db.prepare('SELECT token_hash,data FROM knowledge_builds WHERE id=?').get(id) as
        { token_hash: string; data: string } | undefined) ?? fail('knowledge_build_not_found')
    if (
      token !== undefined &&
      !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(hash(token)))
    )
      fail('knowledge_invalid_build_token')
    return JSON.parse(row.data) as Build
  }
  private saveBuild(build: Build) {
    this.db
      .prepare('UPDATE knowledge_builds SET data=? WHERE id=?')
      .run(JSON.stringify(build), build.id)
  }
  private writable(build: Build) {
    const library = this.library(build.kbId)
    if (library.archived) fail('knowledge_archived')
    if (!['writing', 'invalid', 'validated'].includes(build.status)) fail('knowledge_build_closed')
  }
  private revisions(kbId: string) {
    return (
      this.db
        .prepare(
          'SELECT revision,commit_sha,created_at,data FROM knowledge_revisions WHERE kb_id=? ORDER BY revision DESC',
        )
        .all(kbId) as {
        revision: number
        commit_sha: string | null
        created_at: string
        data: string
      }[]
    ).map((row) => ({
      revision: row.revision,
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      documentCount: (JSON.parse(row.data) as KnowledgeData).documents.length,
    }))
  }
  private data(kbId: string, revision: number): KnowledgeData {
    const row = this.db
      .prepare('SELECT data FROM knowledge_revisions WHERE kb_id=? AND revision=?')
      .get(kbId, revision) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as KnowledgeData) : fail('knowledge_revision_not_found')
  }
  private latestBuild(kbId: string) {
    const rows = this.db
      .prepare('SELECT data FROM knowledge_builds WHERE kb_id=? ORDER BY rowid DESC')
      .all(kbId) as { data: string }[]
    return rows.map((row) => JSON.parse(row.data) as Build).find(active) ?? null
  }
  private summary(library: Library): KnowledgeSummary {
    const build = this.latestBuild(library.id)
    const data = library.revision ? this.data(library.id, library.revision) : empty()
    return {
      ...library,
      documentCount: data.documents.length,
      nodeCount: data.nodes.length,
      build: build
        ? { id: build.id, status: build.status, seq: build.seq, issues: build.issues }
        : null,
    }
  }
  list(host = false): KnowledgeSummary[] {
    return (
      this.db.prepare('SELECT metadata FROM knowledge_libraries ORDER BY rowid DESC').all() as {
        metadata: string
      }[]
    )
      .map((row) => JSON.parse(row.metadata) as Library)
      .filter((library) => host || !library.archived)
      .map((library) => this.summary(library))
  }
  view(kbId: string, revision?: number): KnowledgeView {
    const library = this.library(kbId)
    const selected = revision ?? library.revision
    return {
      library: this.summary(library),
      revision: selected,
      commitSha: selected
        ? (this.revisions(kbId).find((item) => item.revision === selected)?.commitSha ?? null)
        : null,
      data: selected ? this.data(kbId, selected) : empty(),
      versions: this.revisions(kbId),
    }
  }
  private page<T>(items: T[], binding: string, cursor?: string, limit = 50) {
    const offset = this.offset(binding, cursor)
    const end = Math.min(items.length, offset + limit)
    return {
      items: items.slice(offset, end),
      cursor: end < items.length ? this.cursor(binding, end) : null,
      total: items.length,
    }
  }
  private cursor(binding: string, offset: number) {
    return Buffer.from(JSON.stringify({ binding: hash(binding), offset })).toString('base64url')
  }
  private offset(binding: string, cursor?: string): number {
    if (!cursor) return 0
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
        binding: string
        offset: number
      }
      if (
        parsed.binding !== hash(binding) ||
        !Number.isSafeInteger(parsed.offset) ||
        parsed.offset < 0
      )
        fail('knowledge_invalid_cursor')
      return parsed.offset
    } catch {
      return fail('knowledge_invalid_cursor')
    }
  }
  private chunk(
    text: string,
    binding: string,
    cursor?: string,
    maxBytes: number = LIMIT.chunkBytes,
  ) {
    const offset = this.offset(binding, cursor)
    if (offset > text.length) fail('knowledge_invalid_cursor')
    let low = offset,
      high = Math.min(text.length, offset + maxBytes)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (Buffer.byteLength(text.slice(offset, middle)) <= maxBytes) low = middle
      else high = middle - 1
    }
    let end = low
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--
    return {
      text: text.slice(offset, end),
      startLine: text.slice(0, offset).split('\n').length,
      cursor: end < text.length ? this.cursor(binding, end) : null,
    }
  }
  private publicBuild(build: Build, authorized: boolean) {
    return {
      buildId: build.id,
      kbId: build.kbId,
      status: build.status,
      seq: build.seq,
      issues: build.issues,
      validationId: build.validationId,
      resultRevision: build.resultRevision,
      baseRevision: build.baseRevision,
      commitSha: build.commitSha,
      branch: this.library(build.kbId).branch,
      projectKey: this.library(build.kbId).projectKey,
      batches: authorized
        ? this.db
            .prepare(
              'SELECT batch_id AS batchId,seq FROM knowledge_batches WHERE build_id=? ORDER BY seq',
            )
            .all(build.id)
        : [],
    }
  }
  private insertRevision(
    library: Library,
    computed: KnowledgeComputation,
    commitSha: string | null,
  ) {
    const revision = library.revision + 1
    this.db
      .prepare('INSERT INTO knowledge_revisions VALUES (?,?,?,?,?)')
      .run(library.id, revision, commitSha, computed.serialized, now())
    const insert = this.db.prepare(
      'INSERT INTO knowledge_fts(kb_id,revision,kind,target_id,title,tokens) VALUES (?,?,?,?,?,?)',
    )
    for (const [kind, id, title, tokens] of computed.rows)
      insert.run(library.id, revision, kind, id, title, tokens)
    library.revision = revision
    library.commitSha = commitSha
    library.updatedAt = now()
    this.saveLibrary(library)
    return revision
  }
  evidence(kbId: string, revision: number, citationId: string): KnowledgeEvidence {
    const citation =
      this.data(kbId, revision).citations.find((item) => item.id === citationId) ??
      fail('knowledge_citation_not_found')
    return {
      path: citation.path,
      hash: citation.fileHash,
      quoteHash: citation.quoteHash,
      commitSha: this.revisions(kbId).find((item) => item.revision === revision)?.commitSha ?? null,
      startLine: citation.startLine,
      endLine: citation.endLine,
    }
  }
  private createGroup(args: Record<string, unknown>) {
    const projectKey = String(args.projectKey).trim(),
      name = String(args.name).trim()
    const git = args.git as boolean,
      branch = git ? String(args.branch ?? '').trim() : 'main'
    if (
      !projectKey ||
      !name ||
      !branch ||
      branch.includes('\0') ||
      (!git && args.branch !== undefined && args.branch !== 'main')
    )
      fail('knowledge_invalid_project')
    const groups = this.list(true).filter((item) => item.projectKey === projectKey)
    if (groups.some((item) => item.git !== git)) fail('knowledge_project_conflict')
    const existing = groups.find((item) => item.branch === branch)
    if (existing) return { kbId: existing.id, ...existing }
    const library: Library = {
      id: randomUUID(),
      projectKey,
      branch,
      git,
      name,
      description: String(args.description ?? ''),
      revision: 0,
      commitSha: null,
      archived: false,
      updatedAt: now(),
    }
    this.saveLibrary(library)
    return { kbId: library.id, ...this.summary(library) }
  }
  async invoke(name: string, args: Record<string, unknown>, host = false): Promise<unknown> {
    if (this.shuttingDown) fail('knowledge_operation_failed')
    const validate = this.validators.get(name)
    if (!validate || !validate(args)) fail('knowledge_invalid_arguments')
    const str = (key: string) => args[key] as string
    const num = (key: string) => args[key] as number
    const cursor = args.cursor as string | undefined
    const action = name.replace('Lumi.knowledge_', '')
    if (action === 'get_contract')
      return {
        version: KNOWLEDGE_VERSION,
        limits: LIMIT,
        dataSchema: knowledgeDataSchema,
        workflow: [
          '外部 AI 自行读取项目与 Git 元信息；create(projectKey,name,git,branch) 定位分组；无 Git 固定 main',
          'list(projectKey,branch) → compare(kbId,latestCommitSha)；SHA 不同由 AI git diff 定位变化',
          'prepare_build → begin_build(commitSha,expectedRevision,mode) → write_batch',
          'validate_build → get_build(status=validated) → publish_build(latestCommitSha)',
          'read/search/graph 固定项目＋分支分组 kbId 和 revision',
        ],
        evidence:
          '引用只保存相对路径、文件 SHA256、行号与片段 SHA256。元信息由外部 AI 提交；Lumi 不读取源码、不核实 Git 或引用真实性，只校验结构。禁止提交项目原文快照。',
        publication:
          '每组独立版本号和写锁。增量只继承同分支旧版本。commitSha 固定在构建内，发布时 latestCommitSha 必须相等；无 Git 均为 null。SHA 对比不涵盖未提交修改，不同 SHA 不证明差异范围或先后关系。',
        identity:
          'projectKey 为稳定项目标识，同项目 worktree 使用同一标识；branch 为实际分支。Git 元信息由调用方保证真实。resumeToken 控制构建写入。',
      }
    if (action === 'create') return this.createGroup(args)
    if (action === 'list')
      return this.page(
        this.list().filter(
          (item) =>
            (!args.projectKey || item.projectKey === args.projectKey) &&
            (!args.branch || item.branch === args.branch) &&
            (!args.query ||
              `${item.name} ${item.description} ${item.branch}`
                .toLowerCase()
                .includes(str('query').toLowerCase())),
        ),
        `libraries:${args.projectKey ?? ''}:${args.branch ?? ''}:${args.query ?? ''}`,
        cursor,
        args.limit as number | undefined,
      )
    if (action === 'compare') {
      const library = this.library(str('kbId'))
      if (library.archived) fail('knowledge_archived')
      const latestCommitSha = args.latestCommitSha as string | null
      if (!library.git && latestCommitSha !== null) fail('knowledge_invalid_commit')
      const status = !library.revision
        ? 'unpublished'
        : !library.git
          ? 'no_git'
          : !library.commitSha || !latestCommitSha
            ? 'unknown'
            : library.commitSha === latestCommitSha
              ? 'current'
              : 'update_required'
      return {
        kbId: library.id,
        projectKey: library.projectKey,
        branch: library.branch,
        revision: library.revision,
        commitSha: library.commitSha,
        latestCommitSha,
        status,
        needsUpdate:
          status === 'unpublished' || status === 'update_required'
            ? true
            : status === 'current'
              ? false
              : null,
      }
    }
    if (action === 'prepare_build') {
      const library = this.library(str('kbId'))
      if (library.archived) fail('knowledge_archived')
      this.db.prepare('DELETE FROM knowledge_preparations WHERE expires_at<?').run(Date.now())
      const token = randomBytes(32).toString('base64url')
      this.db
        .prepare('INSERT INTO knowledge_preparations VALUES (?,?,?)')
        .run(library.id, hash(token), Date.now() + 10 * 60 * 1000)
      return { resumeToken: token, expiresInSeconds: 600 }
    }
    if (action === 'begin_build') {
      const library = this.library(str('kbId'))
      if (library.archived) fail('knowledge_archived')
      const existing = this.db
        .prepare('SELECT id FROM knowledge_builds WHERE kb_id=? AND request_key=?')
        .get(library.id, str('requestKey')) as { id: string } | undefined
      if (existing) {
        const build = this.build(existing.id, str('resumeToken'))
        if (
          build.commitSha !== args.commitSha ||
          build.baseRevision !== num('expectedRevision') ||
          build.mode !== str('mode')
        )
          fail('knowledge_request_conflict')
        return this.publicBuild(build, true)
      }
      if (library.revision !== num('expectedRevision')) fail('knowledge_revision_conflict')
      const preparation = this.db
        .prepare('SELECT kb_id,expires_at FROM knowledge_preparations WHERE token_hash=?')
        .get(hash(str('resumeToken'))) as { kb_id: string; expires_at: number } | undefined
      if (!preparation || preparation.kb_id !== library.id || preparation.expires_at < Date.now())
        fail('knowledge_invalid_build_token')
      if (this.latestBuild(library.id)) fail('knowledge_build_busy')
      if (!library.git && args.commitSha !== null) fail('knowledge_invalid_commit')
      const build: Build = {
        id: randomUUID(),
        kbId: library.id,
        commitSha: args.commitSha as string | null,
        baseRevision: library.revision,
        mode: str('mode'),
        seq: 0,
        status: 'writing',
        content:
          str('mode') === 'incremental' && library.revision
            ? this.data(library.id, library.revision)
            : empty(),
        issues: [],
        validationId: null,
        validationHash: null,
        resultRevision: null,
        publishKey: null,
      }
      this.transaction(() => {
        this.db
          .prepare('INSERT INTO knowledge_builds VALUES (?,?,?,?,?)')
          .run(
            build.id,
            library.id,
            hash(str('resumeToken')),
            str('requestKey'),
            JSON.stringify(build),
          )
        this.db
          .prepare('DELETE FROM knowledge_preparations WHERE token_hash=?')
          .run(hash(str('resumeToken')))
      })
      return this.publicBuild(build, true)
    }
    if (
      ['get_build', 'write_batch', 'validate_build', 'publish_build', 'cancel_build'].includes(
        action,
      )
    ) {
      const build = this.build(str('buildId'), args.resumeToken as string | undefined)
      if (action === 'get_build') return this.publicBuild(build, Boolean(args.resumeToken))
      const library = this.library(build.kbId)
      if (library.archived) fail('knowledge_archived')
      if (action === 'cancel_build') {
        if (build.status === 'published') fail('knowledge_build_closed')
        build.status = 'cancelled'
        this.saveBuild(build)
        return this.publicBuild(build, true)
      }
      if (action === 'write_batch') {
        const serialized = JSON.stringify(args.operations)
        if (Buffer.byteLength(serialized) > LIMIT.batchBytes) fail('knowledge_batch_limit')
        const payloadHash = hash(
          JSON.stringify({ operations: args.operations, expectedSeq: args.expectedSeq }),
        )
        const previous = this.db
          .prepare('SELECT hash,seq FROM knowledge_batches WHERE build_id=? AND batch_id=?')
          .get(build.id, str('batchId')) as { hash: string; seq: number } | undefined
        if (previous) {
          if (previous.hash !== payloadHash) fail('knowledge_batch_conflict')
          return { buildId: build.id, seq: previous.seq, duplicate: true }
        }
        this.writable(build)
        if (build.seq !== num('expectedSeq')) fail('knowledge_sequence_conflict')
        for (const operation of args.operations as KnowledgeOperation[]) {
          const key =
            `${operation.kind === 'delete' ? operation.target : operation.kind}s` as keyof KnowledgeData
          const items = build.content[key] as { id: string }[]
          const id = operation.kind === 'delete' ? operation.id : operation.value.id
          const index = items.findIndex((item) => item.id === id)
          if (index >= 0) items.splice(index, 1)
          if (operation.kind !== 'delete') items.push(operation.value)
        }
        if (
          !this.validateData(build.content) ||
          Buffer.byteLength(JSON.stringify(build.content)) > LIMIT.revisionBytes
        )
          fail('knowledge_content_limit')
        build.seq++
        build.status = 'writing'
        build.validationId = null
        build.validationHash = null
        build.issues = []
        this.transaction(() => {
          this.saveBuild(build)
          this.db
            .prepare('INSERT INTO knowledge_batches VALUES (?,?,?,?)')
            .run(build.id, str('batchId'), payloadHash, build.seq)
        })
        return { buildId: build.id, seq: build.seq, duplicate: false }
      }
      if (action === 'validate_build') {
        if (build.status === 'validating' && build.seq === num('expectedSeq'))
          return { validationId: build.validationId }
        this.writable(build)
        if (build.seq !== num('expectedSeq')) fail('knowledge_sequence_conflict')
        build.status = 'validating'
        build.validationId = randomUUID()
        build.validationHash = hash(JSON.stringify(build.content))
        this.saveBuild(build)
        this.background(async () => {
          const current = this.build(build.id)
          if (current.status !== 'validating' || current.validationId !== build.validationId) return
          let issues: string[]
          try {
            issues = this.validateData(current.content)
              ? (await this.computer.run(current.content)).issues
              : ['invalid_content_schema']
          } catch {
            issues = ['knowledge_operation_failed']
          }
          const latest = this.build(build.id)
          if (latest.status !== 'validating' || latest.validationId !== current.validationId) return
          latest.issues = issues
          latest.status = issues.length ? 'invalid' : 'validated'
          this.saveBuild(latest)
        })
        return { validationId: build.validationId }
      }
      if (action === 'publish_build') {
        if (build.status === 'published') {
          if (
            build.publishKey !== str('requestKey') ||
            build.validationId !== str('validationId') ||
            build.baseRevision !== num('expectedRevision') ||
            build.seq !== num('expectedSeq') ||
            build.commitSha !== args.latestCommitSha
          )
            fail('knowledge_request_conflict')
          return { revision: build.resultRevision, duplicate: true }
        }
        if (library.revision !== num('expectedRevision') || build.baseRevision !== library.revision)
          fail('knowledge_revision_conflict')
        if (
          build.status !== 'validated' ||
          build.seq !== num('expectedSeq') ||
          build.validationId !== str('validationId') ||
          build.validationHash !== hash(JSON.stringify(build.content))
        )
          fail('knowledge_validation_required')
        if (args.latestCommitSha !== build.commitSha) fail('knowledge_commit_conflict')
        if (!this.validateData(build.content)) fail('knowledge_validation_required')
        const computed = await this.computer.run(build.content, true)
        if (computed.issues.length) fail('knowledge_validation_required')
        // Computation yields to concurrent cancel/write/publish/archive requests; re-authorize the snapshot.
        const latestBuild = this.build(build.id, args.resumeToken as string | undefined)
        const latestLibrary = this.library(build.kbId)
        if (latestBuild.status === 'published') {
          if (
            latestBuild.publishKey !== str('requestKey') ||
            latestBuild.validationId !== str('validationId')
          )
            fail('knowledge_request_conflict')
          return { revision: latestBuild.resultRevision, duplicate: true }
        }
        if (latestLibrary.archived) fail('knowledge_archived')
        if (latestLibrary.revision !== library.revision) fail('knowledge_revision_conflict')
        if (
          latestBuild.status !== 'validated' ||
          latestBuild.seq !== build.seq ||
          latestBuild.validationId !== build.validationId ||
          latestBuild.validationHash !== build.validationHash
        )
          fail('knowledge_validation_required')
        const revision = this.transaction(() => {
          const revision = this.insertRevision(latestLibrary, computed, build.commitSha)
          build.status = 'published'
          build.resultRevision = revision
          build.publishKey = str('requestKey')
          this.saveBuild(build)
          return revision
        })
        return { revision, duplicate: false }
      }
    }
    const library = this.library(str('kbId'))
    if (library.archived && !host) fail('knowledge_archived')
    const revision = (args.revision as number | undefined) ?? library.revision
    const content = this.data(library.id, revision)
    if (action === 'search') {
      const queryTokens = [
        ...new Set(knowledgeTokens(str('query')).split(' ').filter(Boolean)),
      ].slice(0, 30)
      const query = queryTokens.map((word) => `"${word}"`).join(' AND ')
      const rows = query
        ? this.db
            .prepare(
              'SELECT kind,target_id AS id,title,bm25(knowledge_fts) AS rank FROM knowledge_fts WHERE knowledge_fts MATCH ? AND kb_id=? AND revision=? ORDER BY rank,target_id LIMIT 500',
            )
            .all(query, library.id, revision)
        : []
      return {
        revision,
        ...this.page(
          rows,
          `search:${library.id}:${revision}:${str('query')}`,
          cursor,
          args.limit as number | undefined,
        ),
      }
    }
    if (action === 'graph') {
      let nodes = content.nodes
      if (args.scope === 'neighborhood') {
        if (!args.nodeId || !nodes.some((node) => node.id === str('nodeId')))
          fail('knowledge_node_not_found')
        const selected = new Set([str('nodeId')])
        for (let depth = 0; depth < ((args.depth as number | undefined) ?? 1); depth++) {
          const layer = new Set(selected)
          for (const edge of content.edges)
            if (layer.has(edge.from) || layer.has(edge.to)) {
              selected.add(edge.from)
              selected.add(edge.to)
            }
        }
        nodes = nodes.filter((node) => selected.has(node.id))
      } else
        nodes = [...nodes].sort(
          (a, b) =>
            (a.kind === 'project' ? -1 : 0) - (b.kind === 'project' ? -1 : 0) ||
            a.label.localeCompare(b.label),
        )
      const nodeLimit = Math.min(
        (args.nodeLimit as number | undefined) ?? (args.scope === 'neighborhood' ? 150 : 40),
        args.scope === 'neighborhood' ? 150 : 40,
      )
      const visible = nodes.slice(0, nodeLimit),
        ids = new Set(visible.map((node) => node.id)),
        edges = content.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      return {
        revision,
        nodes: visible,
        edges: edges.slice(0, (args.edgeLimit as number | undefined) ?? 300),
        totalNodes: content.nodes.length,
        totalEdges: content.edges.length,
        truncated:
          visible.length < nodes.length ||
          edges.length > ((args.edgeLimit as number | undefined) ?? 300),
      }
    }
    if (action === 'read') {
      const target = args.target as Record<string, string>
      if (target.kind === 'version_summary')
        return { revision, versions: this.revisions(library.id) }
      if (target.kind === 'outline')
        return {
          revision,
          ...this.page(
            content.documents.map((doc) => ({
              id: doc.id,
              title: doc.title,
              parentId: doc.parentId,
              order: doc.order,
              citationIds: doc.citationIds,
            })),
            `outline:${library.id}:${revision}`,
            cursor,
          ),
        }
      if (target.kind === 'document') {
        const doc =
          content.documents.find((doc) => doc.id === target.documentId) ??
          fail('knowledge_document_not_found')
        return {
          revision,
          ...doc,
          markdown: undefined,
          ...this.chunk(
            doc.markdown,
            `document:${library.id}:${revision}:${doc.id}`,
            cursor,
            args.maxBytes as number | undefined,
          ),
        }
      }
      if (target.kind === 'node')
        return {
          revision,
          node:
            content.nodes.find((node) => node.id === target.nodeId) ??
            fail('knowledge_node_not_found'),
        }
      if (target.kind === 'evidence') {
        const evidence = this.evidence(library.id, revision, target.citationId!)
        return { revision, ...evidence }
      }
    }
    return fail('knowledge_invalid_arguments')
  }
  async hostRequest(action: string, payload: Record<string, unknown>) {
    if (this.shuttingDown) fail('knowledge_operation_failed')
    const id = typeof payload.kbId === 'string' ? payload.kbId : ''
    if (action === 'list') return { libraries: this.list(true) }
    if (action === 'view')
      return this.view(id, typeof payload.revision === 'number' ? payload.revision : undefined)
    if (action === 'create') {
      const result = (await this.invoke('Lumi.knowledge_create', payload)) as { kbId: string }
      return this.view(result.kbId)
    }
    if (action === 'evidence')
      return this.evidence(id, Number(payload.revision), String(payload.citationId))
    if (action === 'graph' || action === 'search')
      return this.invoke(`Lumi.knowledge_${action}`, payload, true)
    if (action === 'import') return this.importBundle(payload)
    const library = this.library(id)
    if (action === 'archive') {
      if (typeof payload.archived !== 'boolean') fail('knowledge_invalid_arguments')
      library.archived = payload.archived as boolean
      this.saveLibrary(library)
      return this.summary(library)
    }
    if (action === 'cancel' || action === 'takeover') {
      const build = this.build(String(payload.buildId))
      if (build.kbId !== id || !active(build)) fail('knowledge_build_closed')
      if (action === 'cancel') {
        build.status = 'cancelled'
        this.saveBuild(build)
        return this.publicBuild(build, false)
      }
      const token = randomBytes(32).toString('base64url')
      this.db
        .prepare('UPDATE knowledge_builds SET token_hash=? WHERE id=?')
        .run(hash(token), build.id)
      return { buildId: build.id, resumeToken: token }
    }
    if (action === 'restore') {
      if (library.revision !== payload.expectedRevision) fail('knowledge_revision_conflict')
      const content = this.data(id, Number(payload.revision))
      const commitSha =
        this.revisions(id).find((item) => item.revision === Number(payload.revision))?.commitSha ??
        null
      const computed = await this.computer.run(content, true)
      const latest = this.library(id)
      if (latest.archived) fail('knowledge_archived')
      if (latest.revision !== library.revision) fail('knowledge_revision_conflict')
      return { revision: this.transaction(() => this.insertRevision(latest, computed, commitSha)) }
    }
    if (action === 'export')
      return {
        format: 'lumi-knowledge',
        version: 3,
        projectKey: library.projectKey,
        branch: library.branch,
        git: library.git,
        name: library.name,
        description: library.description,
        commitSha: library.commitSha,
        content: this.data(id, library.revision),
      }
    return fail('knowledge_invalid_arguments')
  }
  private async importBundle(bundle: Record<string, unknown>) {
    if (
      bundle.format !== 'lumi-knowledge' ||
      bundle.version !== 3 ||
      !this.validateData(bundle.content) ||
      Object.keys(bundle).some(
        (key) =>
          ![
            'format',
            'version',
            'projectKey',
            'branch',
            'git',
            'name',
            'description',
            'commitSha',
            'content',
          ].includes(key),
      ) ||
      Buffer.byteLength(JSON.stringify(bundle.content)) > LIMIT.revisionBytes
    )
      fail('knowledge_invalid_import')
    const create = this.validators.get('Lumi.knowledge_create')!
    const args = {
      projectKey: bundle.projectKey,
      branch: bundle.branch,
      git: bundle.git,
      name: bundle.name,
      description: bundle.description,
    }
    const commit = this.validators.get('Lumi.knowledge_compare')!
    if (
      !create(args) ||
      !commit({ kbId: 'import', latestCommitSha: bundle.commitSha }) ||
      (!bundle.git && bundle.commitSha !== null)
    )
      fail('knowledge_invalid_import')
    const content = structuredClone(bundle.content) as KnowledgeData
    const computed = await this.computer.run(content, true)
    if (computed.issues.length) fail('knowledge_invalid_import')
    return this.transaction(() => {
      const group = this.createGroup(args)
      const library = this.library(group.kbId)
      if (library.archived || this.latestBuild(library.id)) fail('knowledge_build_busy')
      this.insertRevision(library, computed, bundle.commitSha as string | null)
      return this.view(library.id)
    })
  }
}
