// SPDX-License-Identifier: MPL-2.0
/* global URL, fetch, window, document, innerWidth */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const require = createRequire(import.meta.url)
const { CoreService } = require('../../../packages/core/dist/service.js')
const { chromium } =
  await import('/Users/zj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const output = path.dirname(new URL(import.meta.url).pathname)
const frontend = process.env.KNOWLEDGE_UI_URL ?? 'http://127.0.0.1:1421'
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-branches-ui-'))
const sessionToken = 'branches-ui-session-0123456789abcdef',
  hostToken = 'branches-ui-host-private-0123456789abcdef'
const core = new CoreService({
  host: '127.0.0.1',
  port: 0,
  userDataDir: temp,
  sessionToken,
  hostToken,
})
await core.start()
const base = `http://127.0.0.1:${core.port}`
const client = new Client({ name: 'branch-ui-verification-model', version: '3' })
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { 'x-lumiplug-session-token': sessionToken } },
  }),
)
const tool = async (action, args = {}) => {
  const result = await client.callTool({ name: `Lumi.knowledge_${action}`, arguments: args })
  assert(!result.isError, JSON.stringify(result))
  return result.structuredContent
}
const host = async (action, payload = {}) => {
  const response = await fetch(`${base}/app/knowledge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lumiplug-session-token': sessionToken,
      'x-lumiplug-host-token': hostToken,
    },
    body: JSON.stringify({ action, payload }),
  })
  const result = await response.json()
  assert(result.ok, JSON.stringify(result))
  return result.data
}
const shaA = 'a'.repeat(40),
  shaB = 'b'.repeat(40),
  shaC = 'c'.repeat(40)
const longBranch = 'feature/knowledge-project-branch-version-isolation-and-commit-comparison'
async function seed(branch, commitSha, revision = 0, git = true, projectKey = 'lumi-product') {
  const group = await tool('create', {
    projectKey,
    name: git ? 'Lumi 产品工程' : '资料目录',
    description: '项目架构、模块职责与版本知识。',
    git,
    branch,
  })
  const { resumeToken } = await tool('prepare_build', { kbId: group.kbId })
  const { buildId } = await tool('begin_build', {
    kbId: group.kbId,
    resumeToken,
    commitSha,
    expectedRevision: revision,
    requestKey: `build-${revision}`,
    mode: 'full',
  })
  const topics = [
    ['project', '项目概览', null],
    ['core', 'Core 运行架构', 'project'],
    ['mcp', 'MCP 工具契约', 'core'],
    ['versions', '数据与版本', 'core'],
  ]
  const operations = [
    {
      kind: 'citation',
      value: {
        id: 'source',
        path: 'src/core.ts',
        fileHash: 'd'.repeat(64),
        quoteHash: 'e'.repeat(64),
        startLine: 12,
        endLine: 28,
      },
    },
  ]
  for (const [index, [id, title, parentId]] of topics.entries()) {
    operations.push({
      kind: 'document',
      value: {
        id,
        title,
        parentId,
        order: index,
        markdown: `## ${title}\n\n${branch} 分支的 v${revision + 1} 知识。\n\n### 模块职责\n\n- Lumi 保存生成知识。\n- 外部 AI 读取项目和 Git。\n- 版本绑定提交 SHA。\n\n[查看引用](#citation-source)`,
        citationIds: ['source'],
      },
    })
    operations.push({
      kind: 'node',
      value: {
        id,
        label: title,
        kind: index === 0 ? 'project' : 'module',
        summary: `${title}与版本知识。`,
        documentId: id,
        citationIds: ['source'],
      },
    })
    if (parentId)
      operations.push({
        kind: 'edge',
        value: {
          id: `edge-${id}`,
          from: parentId,
          to: id,
          type: 'contains',
          evidenceKind: 'inferred',
          citationIds: ['source'],
        },
      })
  }
  await tool('write_batch', { buildId, resumeToken, batchId: 'one', expectedSeq: 0, operations })
  const { validationId } = await tool('validate_build', { buildId, resumeToken, expectedSeq: 1 })
  await core.knowledge.close()
  await tool('publish_build', {
    buildId,
    resumeToken,
    expectedRevision: revision,
    expectedSeq: 1,
    latestCommitSha: commitSha,
    validationId,
    requestKey: 'publish',
  })
  return group
}
let browser
try {
  const main = await seed('main', shaA)
  await seed('main', shaB, 1)
  const dev = await seed(longBranch, shaC)
  await seed('main', null, 0, false, 'notes')
  assert.equal(
    (await tool('compare', { kbId: main.kbId, latestCommitSha: shaB })).status,
    'current',
  )
  assert.equal(
    (await tool('compare', { kbId: main.kbId, latestCommitSha: shaC })).status,
    'update_required',
  )
  const tools = await client.listTools()
  assert(
    !tools.tools.some((item) =>
      /knowledge_(request_source|scan_source|read_source|get_scan|get_source|list_source_files)/.test(
        item.name,
      ),
    ),
  )
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('request', (request) => {
    if (!request.url().startsWith(frontend) && !request.url().startsWith('data:'))
      requests.push(request.url())
  })
  await page.exposeBinding('__knowledgeHostIPC', async (_source, command, args) => {
    if (command === 'get_core_status')
      return {
        state: 'ready',
        protocolVersion: 1,
        coreVersion: '0.1.0',
        userDataPathAvailable: true,
        restartCount: 0,
        lastError: null,
      }
    if (command === 'get_mcp_connection_info')
      return {
        endpoint: `${base}/mcp`,
        authHeader: 'x-lumiplug-session-token',
        sessionToken,
        coreState: 'ready',
        stdioCommand: null,
      }
    if (command === 'knowledge_request') return host(args.action, args.payload)
    if (command === 'copy_text') return
    if (command === 'get_workbench')
      return (
        await (
          await fetch(`${base}/app/workbench`, {
            headers: { 'x-lumiplug-session-token': sessionToken },
          })
        ).json()
      ).data
    throw new Error(`Unexpected IPC: ${command}`)
  })
  await page.addInitScript(() => {
    window.__LUMI_HOST_NONCE__ = 'qa-main-window'
    window.__TAURI_INTERNALS__ = {
      invoke: (command, args) => window.__knowledgeHostIPC(command, args),
    }
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: '知识库', exact: true }).click()
  await page.getByRole('button', { name: '打开 Lumi 产品工程 main', exact: true }).waitFor()
  assert.equal(await page.locator('.kb-card-open').count(), 3)
  assert.equal(
    await page.getByRole('button', { name: /检查来源变化|授权|允许读取|选择项目目录/ }).count(),
    0,
  )
  await page.screenshot({ path: path.join(output, 'desktop-grid-dark.png') })
  await page.getByRole('button', { name: '打开 Lumi 产品工程 main', exact: true }).click()
  await page.locator('.ui-graph canvas').first().waitFor()
  await page.getByRole('combobox', { name: '选择项目分支' }).selectOption(dev.kbId)
  await page
    .locator('.kb-detail-header [title="cccccccccccccccccccccccccccccccccccccccc"]')
    .waitFor()
  await page.getByRole('combobox', { name: '选择项目分支' }).selectOption(main.kbId)
  await page.getByRole('button', { name: '知识库管理', exact: true }).click()
  const management = page.getByRole('dialog', { name: '知识库管理', exact: true })
  assert.equal(await management.getByRole('button', { name: /检查来源|授权|允许部分/ }).count(), 0)
  assert(
    (await management.getByRole('combobox', { name: '选择发布版本' }).textContent()).includes(
      'aaaaaaaa',
    ),
  )
  await management.getByRole('combobox', { name: '选择发布版本' }).selectOption('1')
  await management.waitFor({ state: 'hidden' })
  await page
    .locator('.kb-detail-header [title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]')
    .waitFor()
  await page.getByRole('treeitem', { name: '项目概览', exact: true }).click()
  await page.getByRole('button', { name: '来源 1', exact: true }).click()
  const evidence = page.getByRole('dialog', { name: '来源引用', exact: true })
  await evidence.waitFor()
  assert((await evidence.textContent()).includes('src/core.ts'))
  assert((await evidence.textContent()).includes('aaaaaaaaaaaa'))
  assert.equal(await evidence.locator('.ui-source-line').count(), 0)
  assert.equal(
    await evidence.getByRole('textbox', { name: '内容 SHA256' }).inputValue(),
    'd'.repeat(64),
  )
  await page.screenshot({ path: path.join(output, 'desktop-evidence-dark.png') })
  await page.keyboard.press('Escape')
  await evidence.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '搜索知识', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索知识关键词' }).fill('版本')
  await page.getByRole('searchbox', { name: '搜索知识关键词' }).press('Enter')
  await page.getByRole('button', { name: '阅读 数据与版本', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  await page.getByRole('button', { name: '新建知识库', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建知识库', exact: true })
  await create.getByRole('button', { name: '创建分组', exact: true }).click()
  assert(
    await create
      .getByRole('textbox', { name: '项目名称', exact: true })
      .evaluate((el) => el === document.activeElement),
  )
  await create.getByRole('textbox', { name: '项目名称', exact: true }).fill('新资料项目')
  await create.getByRole('textbox', { name: '项目标识', exact: true }).fill('new-notes')
  assert.equal(
    await create.getByRole('textbox', { name: '分支', exact: true }).inputValue(),
    'main',
  )
  assert(await create.getByRole('textbox', { name: '分支', exact: true }).isDisabled())
  await create.getByRole('button', { name: '创建分组', exact: true }).click()
  await create.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '新资料项目', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 900, height: 650 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await page
      .getByRole('button', { name: `打开 Lumi 产品工程 ${longBranch}`, exact: true })
      .click()
    await page.waitForTimeout(200)
    assert.equal(await page.getByRole('combobox', { name: '选择项目分支' }).inputValue(), dev.kbId)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    const nonblank = await page.locator('.ui-graph canvas').evaluateAll((canvases) =>
      canvases.some((canvas) =>
        canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((byte, i) => i % 4 === 3 && byte > 0),
      ),
    )
    assert(nonblank)
    await page.screenshot({ path: path.join(output, `${viewport.width}-branch-light.png`) })
    await page.getByRole('button', { name: '返回知识库', exact: true }).click()
    await page.screenshot({ path: path.join(output, `${viewport.width}-grid-light.png`) })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        backend: 'real Core SQLite + official MCP',
        checks: [
          'branch grouping',
          'independent revisions',
          'historic commit',
          'no source auth/scanning',
          'metadata-only references',
          'no-Git main',
          'create validation',
          'search',
          'long branch',
          '1440/900/390',
          'canvas pixels',
        ],
        errors,
        externalRequests: requests,
      },
      null,
      2,
    ),
  )
  console.log('Project+branch production UI verification passed:', output)
} finally {
  await browser?.close()
  await client.close()
  await core.stop()
  await fs.rm(temp, { recursive: true, force: true })
}
