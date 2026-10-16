// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { KNOWLEDGE_TOOLS } from '@lumiplug/shared'
import type { KnowledgeOperation, KnowledgeView } from '@lumiplug/shared'
import { CoreDatabase } from '../db/database'
import { KnowledgeService } from './service'
import { CoreService } from '../service'
import { KnowledgeComputer } from './compute'

const shaA = 'a'.repeat(40),
  shaB = 'b'.repeat(40),
  shaC = 'c'.repeat(64)
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
let root: string, database: CoreDatabase, service: KnowledgeService
const call = <T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}) =>
  service.invoke(`Lumi.knowledge_${action}`, args) as Promise<T>
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-knowledge-branches-'))
  database = new CoreDatabase(path.join(root, 'db.sqlite'))
  service = new KnowledgeService(database.raw)
})
afterEach(async () => {
  await service.close()
  database.close()
  await fs.rm(root, { recursive: true, force: true })
})
async function group(branch = 'main', projectKey = 'lumi', git = true) {
  return call<{ kbId: string }>('create', {
    projectKey,
    name: 'Lumi',
    branch,
    git,
    description: '项目知识',
  })
}
const operations = (): KnowledgeOperation[] => [
  {
    kind: 'citation',
    value: {
      id: 'citation',
      path: 'src/core.ts',
      fileHash: digest('source'),
      startLine: 1,
      endLine: 4,
      quoteHash: digest('reference'),
    },
  },
  {
    kind: 'document',
    value: {
      id: 'overview',
      title: '项目知识库',
      parentId: null,
      order: 0,
      markdown: '# 项目知识库\n\nCore 负责知识管理。',
      citationIds: ['citation'],
    },
  },
  {
    kind: 'document',
    value: {
      id: 'architecture',
      title: 'Core 架构',
      parentId: 'overview',
      order: 1,
      markdown: '文件引用与项目知识。',
      citationIds: ['citation'],
    },
  },
  {
    kind: 'node',
    value: {
      id: 'lumi',
      label: 'Lumi',
      kind: 'project',
      summary: '本地知识',
      documentId: 'overview',
      citationIds: ['citation'],
    },
  },
  {
    kind: 'node',
    value: {
      id: 'core',
      label: 'Core',
      kind: 'module',
      summary: '知识管理核心',
      documentId: 'architecture',
      citationIds: ['citation'],
    },
  },
  {
    kind: 'edge',
    value: {
      id: 'contains',
      from: 'lumi',
      to: 'core',
      type: 'contains',
      evidenceKind: 'inferred',
      citationIds: ['citation'],
    },
  },
]
async function begin(
  kbId: string,
  commitSha: string | null = shaA,
  requestKey = 'build',
  mode = 'full',
) {
  const { resumeToken } = await call<{ resumeToken: string }>('prepare_build', { kbId })
  const args = {
    kbId,
    commitSha,
    expectedRevision: service.view(kbId).revision,
    requestKey,
    resumeToken,
    mode,
  }
  const build = await call<{ buildId: string }>('begin_build', args)
  return { ...build, resumeToken, args }
}
async function publish(
  kbId: string,
  commitSha: string | null = shaA,
  requestKey = 'build',
  mode = 'full',
) {
  const write = await begin(kbId, commitSha, requestKey, mode)
  await call('write_batch', {
    buildId: write.buildId,
    resumeToken: write.resumeToken,
    batchId: 'batch',
    expectedSeq: 0,
    operations: operations(),
  })
  const { validationId } = await call('validate_build', {
    buildId: write.buildId,
    resumeToken: write.resumeToken,
    expectedSeq: 1,
  })
  await service.close()
  const args = {
    buildId: write.buildId,
    resumeToken: write.resumeToken,
    expectedRevision: write.args.expectedRevision,
    expectedSeq: 1,
    validationId,
    requestKey: 'publish',
    latestCommitSha: commitSha,
  }
  await call('publish_build', args)
  return { ...write, publishArgs: args }
}
describe('Project and branch knowledge groups', () => {
  it('defaults non-Git projects to main without accessing any project directory', async () => {
    const created = await call<{ kbId: string; branch: string; git: boolean }>('create', {
      projectKey: '/nonexistent/project',
      name: '文档项目',
      git: false,
    })
    expect(created).toMatchObject({ branch: 'main', git: false, revision: 0, commitSha: null })
    expect(
      await call('create', { projectKey: '/nonexistent/project', name: '文档项目', git: false }),
    ).toEqual(created)
    await expect(group('dev', '/nonexistent/project', false)).rejects.toThrow(
      'knowledge_invalid_project',
    )
    await publish(created.kbId, null)
    expect(await call('compare', { kbId: created.kbId, latestCommitSha: null })).toMatchObject({
      status: 'no_git',
      needsUpdate: null,
    })
    await expect(call('compare', { kbId: created.kbId, latestCommitSha: shaA })).rejects.toThrow(
      'knowledge_invalid_commit',
    )
    expect(service.view(created.kbId).commitSha).toBeNull()
  })
  it('isolates project+branch IDs, version counters and incremental content', async () => {
    const main = await group(),
      dev = await group('feature/payments'),
      other = await group('main', 'other')
    expect(new Set([main.kbId, dev.kbId, other.kbId]).size).toBe(3)
    await publish(main.kbId)
    await publish(dev.kbId, shaB)
    await publish(other.kbId, shaC)
    const write = await begin(main.kbId, shaB, 'incremental', 'incremental')
    await call('write_batch', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      batchId: 'delete',
      expectedSeq: 0,
      operations: [{ kind: 'delete', target: 'edge', id: 'contains' }],
    })
    const { validationId } = await call('validate_build', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      expectedSeq: 1,
    })
    await service.close()
    await call('publish_build', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      expectedRevision: 1,
      expectedSeq: 1,
      validationId,
      requestKey: 'v2',
      latestCommitSha: shaB,
    })
    expect(service.view(main.kbId)).toMatchObject({
      revision: 2,
      commitSha: shaB,
      data: { edges: [] },
    })
    expect(service.view(dev.kbId)).toMatchObject({
      revision: 1,
      commitSha: shaB,
      data: {
        edges: expect.arrayContaining([
          {
            id: 'contains',
            from: 'lumi',
            to: 'core',
            type: 'contains',
            evidenceKind: 'inferred',
            citationIds: ['citation'],
          },
        ]),
      },
    })
    expect(service.view(main.kbId, 1).commitSha).toBe(shaA)
    expect(await call('list', { projectKey: 'lumi', branch: 'main' })).toMatchObject({ total: 1 })
    expect(await call('list', { projectKey: 'lumi' })).toMatchObject({ total: 2 })
  })
  it('requires an actual branch for Git projects and rejects mixed project identity types', async () => {
    await expect(call('create', { projectKey: 'lumi', name: 'Lumi', git: true })).rejects.toThrow(
      'knowledge_invalid_project',
    )
    await group()
    await expect(group('main', 'lumi', false)).rejects.toThrow('knowledge_project_conflict')
    await expect(call('create', { projectKey: ' ', name: 'Lumi', git: false })).rejects.toThrow(
      'knowledge_invalid_project',
    )
  })
  it('compares caller-supplied latest commits without claiming uncommitted changes or commit ancestry', async () => {
    const { kbId } = await group()
    expect(await call('compare', { kbId, latestCommitSha: shaA })).toMatchObject({
      status: 'unpublished',
      needsUpdate: true,
    })
    await publish(kbId)
    expect(await call('compare', { kbId, latestCommitSha: shaA })).toMatchObject({
      status: 'current',
      needsUpdate: false,
    })
    expect(await call('compare', { kbId, latestCommitSha: shaB })).toMatchObject({
      status: 'update_required',
      needsUpdate: true,
      commitSha: shaA,
    })
    expect(await call('compare', { kbId, latestCommitSha: null })).toMatchObject({
      status: 'unknown',
      needsUpdate: null,
    })
    await expect(call('compare', { kbId, latestCommitSha: 'abcdef' })).rejects.toThrow(
      'knowledge_invalid_arguments',
    )
  })
})
describe('Branch builds and publication', () => {
  it('pins the target commit and rejects publication against a different latest commit', async () => {
    const { kbId } = await group()
    const write = await publish(kbId)
    expect(await call('publish_build', write.publishArgs)).toMatchObject({
      revision: 1,
      duplicate: true,
    })
    const next = await begin(kbId, shaB, 'next', 'incremental')
    const { validationId } = await call('validate_build', {
      buildId: next.buildId,
      resumeToken: next.resumeToken,
      expectedSeq: 0,
    })
    await service.close()
    await expect(
      call('publish_build', {
        buildId: next.buildId,
        resumeToken: next.resumeToken,
        expectedRevision: 1,
        expectedSeq: 0,
        validationId,
        requestKey: 'wrong-sha',
        latestCommitSha: shaC,
      }),
    ).rejects.toThrow('knowledge_commit_conflict')
    expect(service.view(kbId).revision).toBe(1)
    await expect(call('begin_build', { ...next.args, commitSha: shaC })).rejects.toThrow(
      'knowledge_request_conflict',
    )
  })
  it('keeps tokens scoped, batches idempotent and sequence/version locks enforced', async () => {
    const { kbId } = await group(),
      write = await begin(kbId)
    const batch = {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      batchId: 'one',
      expectedSeq: 0,
      operations: operations(),
    }
    expect(await call('write_batch', batch)).toMatchObject({ seq: 1, duplicate: false })
    expect(await call('write_batch', batch)).toMatchObject({ seq: 1, duplicate: true })
    await expect(
      call('write_batch', { ...batch, operations: operations().slice(1) }),
    ).rejects.toThrow('knowledge_batch_conflict')
    await expect(call('write_batch', { ...batch, batchId: 'two' })).rejects.toThrow(
      'knowledge_sequence_conflict',
    )
    await expect(
      call('get_build', { buildId: write.buildId, resumeToken: 'x'.repeat(43) }),
    ).rejects.toThrow('knowledge_invalid_build_token')
    expect(await call('get_build', { buildId: write.buildId })).not.toHaveProperty('resumeToken')
    const other = await group('dev'),
      otherToken = await call<{ resumeToken: string }>('prepare_build', { kbId: other.kbId })
    await expect(
      call('begin_build', {
        ...write.args,
        requestKey: 'invalid-token',
        resumeToken: otherToken.resumeToken,
      }),
    ).rejects.toThrow('knowledge_invalid_build_token')
  })
  it('rejects invalid graph, outline and source metadata structures without reading source files', async () => {
    const { kbId } = await group(),
      write = await begin(kbId)
    const bad = operations()
    bad.push({
      kind: 'document',
      value: {
        id: 'overview',
        title: '循环',
        parentId: 'architecture',
        order: 0,
        markdown: '说明',
        citationIds: ['citation'],
      },
    })
    bad.push({
      kind: 'edge',
      value: {
        id: 'missing',
        from: 'core',
        to: 'absent',
        type: 'calls',
        evidenceKind: 'raw',
        citationIds: ['citation'],
      },
    })
    bad.push({
      kind: 'citation',
      value: {
        id: 'citation',
        path: '../outside.ts',
        fileHash: digest('source'),
        quoteHash: digest('reference'),
        startLine: 8,
        endLine: 2,
      },
    })
    await call('write_batch', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      batchId: 'bad',
      expectedSeq: 0,
      operations: bad,
    })
    const { validationId } = await call('validate_build', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      expectedSeq: 1,
    })
    await service.close()
    expect(await call('get_build', { buildId: write.buildId })).toMatchObject({
      status: 'invalid',
      issues: expect.arrayContaining([
        'outline_cycle:overview',
        'missing_endpoint:missing',
        'invalid_evidence:citation',
      ]),
    })
    await expect(
      call('publish_build', {
        buildId: write.buildId,
        resumeToken: write.resumeToken,
        expectedRevision: 0,
        expectedSeq: 1,
        validationId,
        latestCommitSha: shaA,
        requestKey: 'bad',
      }),
    ).rejects.toThrow('knowledge_validation_required')
  })
  it('persists draft sequence, branch commit, references and published history across restart', async () => {
    const { kbId } = await group()
    await publish(kbId)
    const write = await begin(kbId, shaB, 'restart', 'incremental')
    await service.close()
    database.close()
    database = new CoreDatabase(path.join(root, 'db.sqlite'))
    service = new KnowledgeService(database.raw)
    expect(service.view(kbId)).toMatchObject({ revision: 1, commitSha: shaA })
    expect(
      await call('get_build', { buildId: write.buildId, resumeToken: write.resumeToken }),
    ).toMatchObject({ commitSha: shaB, branch: 'main', seq: 0 })
    const takeover = (await service.hostRequest('takeover', { kbId, buildId: write.buildId })) as {
      resumeToken: string
    }
    await expect(
      call('get_build', { buildId: write.buildId, resumeToken: write.resumeToken }),
    ).rejects.toThrow('knowledge_invalid_build_token')
    await call('cancel_build', {
      buildId: write.buildId,
      resumeToken: takeover.resumeToken,
      requestKey: 'cancel',
    })
    expect(await call('get_build', { buildId: write.buildId })).toMatchObject({
      status: 'cancelled',
    })
  })
})
describe('Read, import and source privacy', () => {
  it('reads fixed versions, metadata-only evidence, search and bounded graphs', async () => {
    const { kbId } = await group()
    await publish(kbId)
    expect(await call('search', { kbId, query: '知识', revision: 1 })).toMatchObject({
      revision: 1,
      items: expect.any(Array),
    })
    expect(
      await call('graph', { kbId, scope: 'neighborhood', nodeId: 'core', depth: 1, nodeLimit: 1 }),
    ).toMatchObject({ truncated: true })
    expect(
      await call('read', {
        kbId,
        revision: 1,
        target: { kind: 'evidence', citationId: 'citation' },
      }),
    ).toMatchObject({ path: 'src/core.ts', hash: digest('source'), commitSha: shaA })
    expect(service.evidence(kbId, 1, 'citation')).not.toHaveProperty('text')
    await expect(
      call('read', { kbId, target: { kind: 'evidence', citationId: 'missing' } }),
    ).rejects.toThrow('knowledge_citation_not_found')
    const tables = database.raw
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'knowledge_%'")
      .all()
    expect(JSON.stringify(tables)).not.toMatch(/knowledge_(sources|scans|snapshots|source_files)/)
    const contract = await call('get_contract')
    expect(contract.version).toBe(3)
    expect(String(contract.evidence)).toContain('不核实 Git')
  })
  it('exports only v3 and imports into the exact project+branch as a new knowledge version', async () => {
    const { kbId } = await group('dev')
    await publish(kbId, shaB)
    const bundle = (await service.hostRequest('export', { kbId })) as Record<string, unknown>
    expect(bundle).toMatchObject({ version: 3, branch: 'dev', projectKey: 'lumi', commitSha: shaB })
    expect(bundle).not.toHaveProperty('sources')
    expect(bundle).not.toHaveProperty('snapshots')
    const imported = (await service.hostRequest('import', bundle)) as KnowledgeView
    expect(imported.library.id).toBe(kbId)
    expect(imported.revision).toBe(2)
    expect(imported.commitSha).toBe(shaB)
    for (const version of [1, 2])
      await expect(service.hostRequest('import', { ...bundle, version })).rejects.toThrow(
        'knowledge_invalid_import',
      )
    await expect(
      service.hostRequest('import', { ...bundle, originalText: 'secret' }),
    ).rejects.toThrow('knowledge_invalid_import')
  })
  it('archives one branch independently and restores history with its original commit into a new version', async () => {
    const main = await group(),
      dev = await group('dev')
    await publish(main.kbId)
    await publish(main.kbId, shaB, 'second')
    await publish(dev.kbId, shaC)
    await service.hostRequest('restore', { kbId: main.kbId, revision: 1, expectedRevision: 2 })
    expect(service.view(main.kbId)).toMatchObject({ revision: 3, commitSha: shaA })
    expect(service.view(dev.kbId).revision).toBe(1)
    await service.hostRequest('archive', { kbId: main.kbId, archived: true })
    expect(await call('list')).toMatchObject({ total: 1 })
    await expect(call('read', { kbId: main.kbId, target: { kind: 'outline' } })).rejects.toThrow(
      'knowledge_archived',
    )
    await service.hostRequest('archive', { kbId: main.kbId, archived: false })
    expect(await call('list')).toMatchObject({ total: 2 })
  })
  it('resets legacy knowledge at migration 8 without touching unrelated app records', async () => {
    database.raw.exec(
      'PRAGMA foreign_keys=OFF; DROP TABLE knowledge_libraries; CREATE TABLE knowledge_libraries (id TEXT PRIMARY KEY,metadata TEXT); CREATE TABLE knowledge_sources (id TEXT); CREATE TABLE knowledge_scans (id TEXT); CREATE TABLE knowledge_source_files (id TEXT,text TEXT); DELETE FROM schema_migrations WHERE id=8;',
    )
    database.raw
      .prepare('INSERT INTO knowledge_libraries VALUES (?,?)')
      .run('legacy', 'UNIQUE_LEGACY_KNOWLEDGE_REMOVED')
    database.raw.prepare('INSERT INTO workbench_state VALUES (?,?)').run('keep', '"untouched"')
    database.close()
    database = new CoreDatabase(path.join(root, 'db.sqlite'))
    service = new KnowledgeService(database.raw)
    expect(service.list(true)).toEqual([])
    expect(
      database.raw.prepare("SELECT value_json FROM workbench_state WHERE key='keep'").get(),
    ).toMatchObject({ value_json: '"untouched"' })
    expect(
      (await fs.readFile(path.join(root, 'db.sqlite'))).includes(
        Buffer.from('UNIQUE_LEGACY_KNOWLEDGE_REMOVED'),
      ),
    ).toBe(false)
  })
})
describe('Real MCP branch contract', () => {
  it('advertises no source authorization/read APIs and completes an external AI build through official MCP', async () => {
    const token = 'branch-mcp-session-0123456789abcdef',
      hostToken = 'private-host-token-0123456789abcdef'
    const core = new CoreService({
      host: '127.0.0.1',
      port: 0,
      userDataDir: path.join(root, 'mcp'),
      sessionToken: token,
      hostToken,
    })
    await core.start()
    const client = new Client({ name: 'external-model', version: '3' })
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${core.port}/mcp`), {
          requestInit: { headers: { 'x-lumiplug-session-token': token } },
        }),
      )
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(KNOWLEDGE_TOOLS.map((tool) => tool.name)),
      )
      expect(
        tools.tools.some((tool) =>
          /knowledge_(request_source|get_source|scan_source|get_scan|read_source|list_source_files)/.test(
            tool.name,
          ),
        ),
      ).toBe(false)
      const tool = async (action: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name: `Lumi.knowledge_${action}`, arguments: args })
        expect(result.isError).not.toBe(true)
        return result.structuredContent as Record<string, unknown>
      }
      const { kbId } = await tool('create', {
        projectKey: 'real-mcp',
        name: '真实 MCP 分支知识',
        git: true,
        branch: 'feature/test',
      })
      const { resumeToken } = await tool('prepare_build', { kbId })
      const { buildId } = await tool('begin_build', {
        kbId,
        resumeToken,
        requestKey: 'one',
        expectedRevision: 0,
        commitSha: shaA,
        mode: 'full',
      })
      await tool('write_batch', {
        buildId,
        resumeToken,
        batchId: 'one',
        expectedSeq: 0,
        operations: operations(),
      })
      const { validationId } = await tool('validate_build', {
        buildId,
        resumeToken,
        expectedSeq: 1,
      })
      await core.knowledge.close()
      await tool('publish_build', {
        buildId,
        resumeToken,
        expectedRevision: 0,
        expectedSeq: 1,
        validationId,
        requestKey: 'one',
        latestCommitSha: shaA,
      })
      expect(await tool('compare', { kbId, latestCommitSha: shaB })).toMatchObject({
        status: 'update_required',
        needsUpdate: true,
        branch: 'feature/test',
        commitSha: shaA,
      })
      const response = await fetch(`http://127.0.0.1:${core.port}/app/knowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lumiplug-session-token': token },
        body: JSON.stringify({ action: 'archive', payload: { kbId, archived: true } }),
      })
      expect(response.status).toBe(403)
    } finally {
      await client.close()
      await core.stop()
    }
  })
})

describe('knowledge worker publication races and startup recovery', () => {
  async function prepared() {
    const { kbId } = await group()
    const write = await begin(kbId)
    await call('write_batch', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      batchId: 'batch',
      expectedSeq: 0,
      operations: operations(),
    })
    const { validationId } = await call('validate_build', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      expectedSeq: 1,
    })
    await service.close()
    return {
      kbId,
      write,
      args: {
        buildId: write.buildId,
        resumeToken: write.resumeToken,
        expectedRevision: 0,
        expectedSeq: 1,
        validationId,
        requestKey: 'publish',
        latestCommitSha: shaA,
      },
    }
  }
  it('does not publish a build cancelled during worker computation', async () => {
    const { kbId, write, args } = await prepared()
    const pending = call('publish_build', args)
    await call('cancel_build', {
      buildId: write.buildId,
      resumeToken: write.resumeToken,
      requestKey: 'cancel',
    })
    await expect(pending).rejects.toThrow('knowledge_validation_required')
    expect(service.view(kbId).revision).toBe(0)
  })
  it('does not publish into an archived library after worker computation', async () => {
    const { kbId, args } = await prepared()
    const pending = call('publish_build', args)
    await service.hostRequest('archive', { kbId, archived: true })
    await expect(pending).rejects.toThrow('knowledge_archived')
    expect(service.view(kbId).revision).toBe(0)
  })
  for (const mutation of ['archive', 'takeover'] as const) {
    it(`rechecks ${mutation} exactly while publication worker completion is paused`, async () => {
      const { kbId, write, args } = await prepared()
      const original = KnowledgeComputer.prototype.run
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      const spy = vi.spyOn(KnowledgeComputer.prototype, 'run').mockImplementationOnce(function (
        this: KnowledgeComputer,
        ...parameters: Parameters<KnowledgeComputer['run']>
      ) {
        entered()
        return barrier.then(() => original.apply(this, parameters))
      })
      const pending = call('publish_build', args)
      // Attach a rejection assertion before releasing the deterministic barrier.
      const rejected = expect(pending).rejects.toThrow(
        mutation === 'archive' ? 'knowledge_archived' : 'knowledge_invalid_build_token',
      )
      try {
        await started
        if (mutation === 'archive') await service.hostRequest('archive', { kbId, archived: true })
        else {
          const takeover = (await service.hostRequest('takeover', {
            kbId,
            buildId: write.buildId,
          })) as { resumeToken: string }
          expect(takeover.resumeToken).not.toBe(write.resumeToken)
        }
        release()
        await rejected
        expect(service.view(kbId).revision).toBe(0)
      } finally {
        release()
        spy.mockRestore()
        await pending.catch(() => {})
      }
    })
  }
  it('publishes concurrent identical requests once and preserves search terms', async () => {
    const { kbId, args } = await prepared()
    const results = await Promise.all([call('publish_build', args), call('publish_build', args)])
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true])
    expect(service.view(kbId).revision).toBe(1)
    const found = await call<{ items: unknown[] }>('search', { kbId, query: '知识' })
    expect(found.items.length).toBeGreaterThan(0)
  })
  it('ignores completed history bodies during startup and uses the status index', async () => {
    const { kbId, write } = await prepared()
    const row = database.raw
      .prepare('SELECT data FROM knowledge_builds WHERE id=?')
      .get(write.buildId) as { data: string }
    const completed = {
      ...JSON.parse(row.data),
      id: 'old',
      status: 'published',
      marker: 'completed-body',
    }
    database.raw
      .prepare('INSERT INTO knowledge_builds VALUES (?,?,?,?,?)')
      .run('old', kbId, 'hash', 'old', JSON.stringify(completed))
    database.raw
      .prepare(
        "UPDATE knowledge_builds SET data=json_set(data, '$.status', 'validating') WHERE id=?",
      )
      .run(write.buildId)
    const parse = vi.spyOn(JSON, 'parse')
    const recovered = new KnowledgeService(database.raw)
    const parsed = parse.mock.calls.map(([value]) => value)
    parse.mockRestore()
    expect(parsed).not.toContain(JSON.stringify(completed))
    await recovered.close()
    const states = database.raw
      .prepare(
        "SELECT id, json_extract(data, '$.status') AS status FROM knowledge_builds ORDER BY id",
      )
      .all()
    expect(states).toContainEqual({ id: write.buildId, status: 'writing' })
    expect(states).toContainEqual({ id: 'old', status: 'published' })
    const plan = database.raw
      .prepare(
        "EXPLAIN QUERY PLAN SELECT data FROM knowledge_builds WHERE json_extract(data, '$.status')='validating'",
      )
      .all()
    expect(JSON.stringify(plan)).toContain('idx_knowledge_build_status')
  })
})

it('drains accepted worker publications and rejects new requests while shutting down', async () => {
  const { kbId } = await group()
  const write = await begin(kbId)
  await call('write_batch', {
    buildId: write.buildId,
    resumeToken: write.resumeToken,
    batchId: 'one',
    expectedSeq: 0,
    operations: operations(),
  })
  const { validationId } = await call('validate_build', {
    buildId: write.buildId,
    resumeToken: write.resumeToken,
    expectedSeq: 1,
  })
  await service.close()
  const publication = call('publish_build', {
    buildId: write.buildId,
    resumeToken: write.resumeToken,
    expectedRevision: 0,
    expectedSeq: 1,
    validationId,
    requestKey: 'publish',
    latestCommitSha: shaA,
  })
  await service.shutdown()
  expect(await publication).toMatchObject({ revision: 1 })
  await expect(call('get_contract')).rejects.toThrow('knowledge_operation_failed')
  await expect(service.hostRequest('list', {})).rejects.toThrow('knowledge_operation_failed')
})
