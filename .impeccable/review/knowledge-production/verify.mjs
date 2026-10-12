// SPDX-License-Identifier: MPL-2.0
/* global URL, fetch, window, document, innerWidth */
// Real Core/MCP fixture; only the native IPC transport is bridged for browser QA.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const require = createRequire(import.meta.url)
const { CoreService } = require('../../../packages/core/dist/service.js')
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    '/Users/zj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
)
const output = path.dirname(new URL(import.meta.url).pathname)
const frontend = process.env.KNOWLEDGE_UI_URL ?? 'http://127.0.0.1:1420'
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-knowledge-ui-'))
const project = path.join(temp, 'project')
await fs.mkdir(project)
const sourceText =
  '# Lumi 项目\n\nCore 管理 SQLite 持久化、MCP 工具契约与来源权限。\n前端共享主题、组件与阅读体验。\n知识库通过外部模型生成，再经过来源校验发布。\n\n原始来源与生成知识独立组织。\n'
await fs.writeFile(path.join(project, 'README.md'), sourceText)
const sessionToken = 'knowledge-ui-session-0123456789abcdef'
const hostToken = 'knowledge-ui-host-private-0123456789abcdef'
const core = new CoreService({
  host: '127.0.0.1',
  port: 0,
  userDataDir: path.join(temp, 'data'),
  sessionToken,
  hostToken,
})
await core.start()
const base = `http://127.0.0.1:${core.port}`
const client = new Client({ name: 'ui-verification-model', version: '1' })
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
  if (!result.ok) throw result.error.code
  return result.data
}
async function seed(name, key, description) {
  const library = await tool('request_source', {
    name,
    description,
    absoluteDirectory: project,
    requestKey: key,
  })
  await host('grant', { sourceId: library.requestId, approved: true })
  const { scanId } = await tool('scan_source', { sourceId: library.requestId, requestKey: 'scan' })
  await core.knowledge.close()
  const manifest = await tool('get_scan', { scanId })
  const { items } = await tool('list_source_files', {
    sourceId: library.requestId,
    manifestId: manifest.manifestId,
  })
  const file = await tool('read_source', {
    sourceId: library.requestId,
    manifestId: manifest.manifestId,
    fileId: items[0].id,
  })
  const { resumeToken } = await tool('prepare_build', { kbId: library.kbId })
  const { buildId } = await tool('begin_build', {
    kbId: library.kbId,
    sourceManifestId: manifest.manifestId,
    expectedRevision: 0,
    requestKey: 'build',
    resumeToken,
    mode: 'full',
  })
  const topics = [
    ['project', '项目概览', 'project', null],
    ['core', 'Core 运行架构', 'module', 'project'],
    ['mcp', 'MCP 工具契约', 'module', 'core'],
    ['storage', '数据与版本', 'module', 'core'],
    ['permissions', '来源授权', 'concept', 'core'],
    ['builds', '构建与发布', 'concept', 'core'],
    ['ui', '桌面交互', 'module', 'project'],
    ['reader', '文档阅读', 'concept', 'ui'],
    ['graph', '知识图谱', 'concept', 'ui'],
    ['components', '共用组件', 'symbol', 'ui'],
  ]
  const operations = [
    {
      kind: 'citation',
      value: {
        id: 'source',
        snapshotId: file.snapshotId,
        startLine: 1,
        endLine: file.lines,
        quoteHash: file.hash,
      },
    },
  ]
  topics.forEach(([id, title, kind, parentId], order) => {
    operations.push({
      kind: 'document',
      value: {
        id,
        title,
        parentId,
        order,
        markdown: `## ${title}\n\n${description}\n\n### 职责\n\n- 由外部 AI 组织生成知识。\n- Lumi 提供授权、快照与发布。\n- 所有证据绑定当前发布版本。\n\n| 对象 | 行为 |\n| --- | --- |\n| 来源 | 不可变快照 |\n| 发布 | 原子版本切换 |\n\n\`\`\`typescript\nconst revision = 1\n\`\`\`\n\n[查看来源](#citation-source)`,
        citationIds: ['source'],
      },
    })
    operations.push({
      kind: 'node',
      value: {
        id,
        label: title,
        kind,
        summary: `${title}的知识与项目来源关联，支持检索和证据追溯。`,
        documentId: id,
        citationIds: ['source'],
      },
    })
    if (parentId)
      operations.push({
        kind: 'edge',
        value: {
          id: `${parentId}-${id}`,
          from: parentId,
          to: id,
          type: 'contains',
          evidenceKind: id === 'graph' ? 'inferred' : 'raw',
          citationIds: ['source'],
        },
      })
  })
  await tool('write_batch', { buildId, resumeToken, batchId: 'one', expectedSeq: 0, operations })
  const { validationId } = await tool('validate_build', { buildId, resumeToken, expectedSeq: 1 })
  await core.knowledge.close()
  await tool('publish_build', {
    buildId,
    resumeToken,
    expectedRevision: 0,
    expectedSeq: 1,
    validationId,
    requestKey: 'publish',
  })
  return library
}
let browser
try {
  const library = await seed(
    'Lumi 产品工程',
    'lumi',
    '本地 AI 工具平台的运行架构、权限边界和桌面交互知识。',
  )
  await seed('支付服务', 'payment', '支付请求、订单状态与账务处理的服务边界和协作关系。')
  await seed('设计系统', 'design', '共用组件、主题、可访问性与桌面界面的一致性规范。')
  const archived = await seed('旧版工程', 'old', '归档版本仍可阅读，但不再进入外部 AI 的默认检索。')
  await host('archive', { kbId: archived.kbId, archived: true })
  await tool('request_source', {
    name: '待授权目录',
    absoluteDirectory: project,
    description: '外部模型提交的项目目录读取请求。',
    requestKey: 'pending',
  })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('request', (request) => {
    if (!request.url().startsWith(frontend) && !request.url().startsWith('data:'))
      requests.push(request.url())
  })
  let copied = '',
    pickerDirectory = project
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
    if (command === 'choose_tool_directory') return pickerDirectory
    if (command === 'copy_text') {
      copied = args.text
      return
    }
    if (command === 'get_workbench') {
      const response = await fetch(`${base}/app/workbench`, {
        headers: { 'x-lumiplug-session-token': sessionToken },
      })
      return (await response.json()).data
    }
    throw new Error(`Unsupported QA IPC: ${command}`)
  })
  await page.addInitScript(() => {
    window.__LUMI_HOST_NONCE__ = 'qa-main-window'
    window.__TAURI_INTERNALS__ = {
      invoke: (command, args) => window.__knowledgeHostIPC(command, args),
    }
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: '知识库', exact: true }).click()
  await page.getByRole('button', { name: '打开 Lumi 产品工程', exact: true }).waitFor()
  const overflow = async () =>
    page.evaluate(() => ({
      page: document.documentElement.scrollWidth > innerWidth,
      workspace:
        document.querySelector('.workspace-content').scrollWidth >
        document.querySelector('.workspace-content').clientWidth,
    }))
  assert.deepEqual(await overflow(), { page: false, workspace: false })
  await page.screenshot({ path: path.join(output, 'desktop-grid-dark.png') })
  await page.getByRole('button', { name: '打开 Lumi 产品工程', exact: true }).click()
  await page.locator('.ui-graph canvas').first().waitFor()
  if (process.env.KNOWLEDGE_QA_PRIVACY === '1') {
    const bundle = await host('export', { kbId: library.kbId })
    assert.equal(bundle.version, 2)
    assert(!('snapshots' in bundle))
    assert(bundle.sources.every((source) => !('text' in source)))
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      if (viewport.width < 760)
        await page.getByRole('button', { name: '打开知识目录', exact: true }).click()
      await page.getByRole('treeitem', { name: '项目概览', exact: true }).click()
      await page.locator('.ui-document').waitFor()
      await page.getByRole('button', { name: '来源 1', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '来源引用', exact: true })
      await dialog.waitFor()
      assert((await dialog.textContent()).includes('README.md'))
      assert.equal(await dialog.locator('.ui-source-line').count(), 0)
      assert.equal((await dialog.getByRole('textbox', { name: '内容 SHA256' }).inputValue()).length, 64)
      assert.deepEqual(await overflow(), { page: false, workspace: false })
      await page.screenshot({ path: path.join(output, `privacy-${viewport.width}.png`) })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '显示知识图谱', exact: true }).click()
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(requests, [])
    console.log('Knowledge metadata-only evidence UI verification passed (1440/390); export contains no source text')
  } else {
  await page.waitForTimeout(300)
  assert.equal(await page.getByRole('heading', { name: '项目全景', exact: true }).count(), 0)
  assert.equal(await page.locator('.kb-inspector').count(), 0)
  assert.equal(
    await page.locator('.kb-title-meta .kb-title-description').textContent(),
    '本地 AI 工具平台的运行架构、权限边界和桌面交互知识。',
  )
  assert.deepEqual(await page.locator('.kb-title-meta > span').allTextContents(), [
    '10 文档',
    '10 节点',
    '本地 AI 工具平台的运行架构、权限边界和桌面交互知识。',
  ])
  const headingBox = await page.locator('.kb-title-group h2').boundingBox()
  const metadataBox = await page.locator('.kb-title-meta').boundingBox()
  assert(metadataBox.y >= headingBox.y + headingBox.height)
  const verifyGraphLayout = async () => {
    const area = await page.locator('.kb-reading-area').boundingBox()
    const graphBox = await page.locator('.ui-graph').boundingBox()
    const canvas = await page.locator('.ui-graph-viewport').boundingBox()
    const legend = await page.locator('.ui-graph-legend').boundingBox()
    assert(graphBox.height >= area.height - 2, 'Graph leaves unused space below the canvas')
    assert(legend.x > canvas.x + canvas.width / 2)
    assert(Math.abs(legend.x + legend.width - (canvas.x + canvas.width - 16)) < 2)
    assert(Math.abs(legend.y + legend.height - (canvas.y + canvas.height - 16)) < 2)
    const labels = await page.locator('.ui-graph-legend [data-kind]').all()
    let previousBottom = 0
    for (const label of labels) {
      const box = await label.boundingBox()
      assert(box.y >= previousBottom)
      previousBottom = box.y + box.height
    }
  }
  await verifyGraphLayout()
  const pixelCheck = await page.locator('.ui-graph canvas').evaluateAll((canvases) =>
    canvases.map((canvas) => {
      const context = canvas.getContext('2d')
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      let nonempty = 0
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i]) nonempty++
      return nonempty
    }),
  )
  assert(
    pixelCheck.some((count) => count > 1000),
    'Graph canvas is blank',
  )
  await page.screenshot({ path: path.join(output, 'desktop-graph-dark.png') })
  const graphState = () =>
    page.locator('.ui-graph-canvas').evaluate((element) => {
      const cy = element._cyreg.cy
      return {
        focused: cy.nodes('.graph-focused').map((node) => node.id()),
        related: cy
          .nodes('.graph-related')
          .map((node) => node.id())
          .sort(),
        muted: cy
          .nodes('.graph-muted')
          .map((node) => node.id())
          .sort(),
        flowing: cy.edges('.graph-flow').length,
        colorMismatches: cy
          .edges()
          .filter(
            (edge) =>
              edge.style('line-color') !== edge.source().style('background-color') ||
              edge.style('target-arrow-color') !== edge.source().style('background-color'),
          )
          .map((edge) => edge.id()),
        offset: cy.edges('.graph-related').first().style('line-dash-offset'),
        time: window.performance.now(),
        zoom: cy.zoom(),
        speed: window.getComputedStyle(element).getPropertyValue('--lumi-graph-flow-speed').trim(),
      }
    })
  const canvasBox = await page.locator('.ui-graph-canvas').boundingBox()
  const corePosition = await page
    .locator('.ui-graph-canvas')
    .evaluate((element) => element._cyreg.cy.getElementById('core').renderedPosition())
  await page.mouse.move(canvasBox.x + corePosition.x, canvasBox.y + corePosition.y)
  await page.waitForTimeout(120)
  const focused = await graphState()
  assert.deepEqual(focused.focused, ['core'])
  assert.deepEqual(focused.related, ['builds', 'core', 'mcp', 'permissions', 'project', 'storage'])
  assert.deepEqual(focused.muted, ['components', 'graph', 'reader', 'ui'])
  assert.equal(focused.flowing, 5)
  assert.equal(focused.speed, '10')
  assert.deepEqual(focused.colorMismatches, [])
  await page.waitForTimeout(1000)
  const timedFlow = await graphState()
  const modelDistance =
    (((parseFloat(focused.offset) - parseFloat(timedFlow.offset)) % 24) + 24) % 24
  const screenPixelsPerSecond =
    (modelDistance * timedFlow.zoom * 1000) / (timedFlow.time - focused.time)
  assert(screenPixelsPerSecond >= 8 && screenPixelsPerSecond <= 12)
  await page.locator('.ui-graph-canvas').evaluate((element) => {
    const cy = element._cyreg.cy
    cy.zoom(Math.min(3, cy.zoom() * 2))
  })
  await page.waitForTimeout(150)
  const zoomedStart = await graphState()
  await page.waitForTimeout(1000)
  const zoomedEnd = await graphState()
  const zoomedDistance =
    (((parseFloat(zoomedStart.offset) - parseFloat(zoomedEnd.offset)) % 24) + 24) % 24
  const zoomedSpeed = (zoomedDistance * zoomedEnd.zoom * 1000) / (zoomedEnd.time - zoomedStart.time)
  assert(zoomedSpeed >= 8 && zoomedSpeed <= 12)
  await page
    .locator('.ui-graph-canvas')
    .evaluate((element, zoom) => element._cyreg.cy.zoom(zoom), focused.zoom)
  console.log(
    JSON.stringify({
      flowMeasurement: {
        elapsedMs: timedFlow.time - focused.time,
        modelDistance,
        zoom: timedFlow.zoom,
        screenPixelsPerSecond,
        zoomedScreenPixelsPerSecond: zoomedSpeed,
      },
    }),
  )
  const flowingFrame = await page.locator('.ui-graph-canvas').screenshot()
  await page.waitForTimeout(180)
  assert.notEqual((await graphState()).offset, focused.offset)
  assert(!flowingFrame.equals(await page.locator('.ui-graph-canvas').screenshot()))
  await page.screenshot({ path: path.join(output, 'desktop-graph-focused-dark.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(120)
  const reduced = await graphState()
  assert.deepEqual(reduced.related, focused.related)
  assert.equal(reduced.flowing, 0)
  await page.waitForTimeout(180)
  assert.equal((await graphState()).offset, reduced.offset)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.mouse.move(80, 90)
  await page.waitForTimeout(120)
  const restored = await graphState()
  assert.deepEqual(restored.focused, [])
  assert.deepEqual(restored.muted, [])
  assert.deepEqual(restored.colorMismatches, [])
  assert.equal(restored.flowing, 0)
  await page.getByRole('treeitem', { name: '项目概览', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  assert(
    (await page
      .getByRole('treeitem', { name: '项目概览', exact: true })
      .getAttribute('aria-expanded')) === 'false',
  )
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  assert((await page.evaluate(() => document.activeElement.textContent)).includes('Core 运行架构'))
  await page.keyboard.press('Enter')
  await page.locator('.ui-document').waitFor()
  await page.getByRole('button', { name: '显示知识图谱', exact: true }).click()
  await page.getByRole('button', { name: '关系清单', exact: true }).click()
  assert(!(await page.locator('.ui-graph-legend').isVisible()))
  await page
    .locator('.ui-graph-list')
    .getByRole('button', { name: '来源授权', exact: true })
    .last()
    .focus()
  await page.keyboard.press('Space')
  assert((await page.locator('.kb-inspector').textContent()).includes('入向'))
  assert.equal((await graphState()).flowing, 0)
  await page.getByRole('button', { name: '图谱', exact: true }).click()
  await page.waitForTimeout(120)
  assert.deepEqual((await graphState()).focused, ['permissions'])
  assert.equal((await graphState()).flowing, 1)
  await page.getByRole('button', { name: '关系清单', exact: true }).click()
  assert.equal((await graphState()).flowing, 0)
  await page.screenshot({ path: path.join(output, 'desktop-node-dark.png') })
  await page.getByRole('textbox', { name: '检索知识', exact: true }).fill('版本')
  await page.getByRole('button', { name: '阅读 数据与版本', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert(
    (await page
      .getByRole('button', { name: '关系清单', exact: true })
      .getAttribute('aria-pressed')) === 'true',
  )
  await page.getByRole('button', { name: '阅读文档', exact: true }).click()
  await page.locator('.ui-document').waitFor()
  await page.getByRole('button', { name: '来源 1', exact: true }).click()
  await page.getByRole('dialog', { name: '来源引用' }).waitFor()
  assert.equal(await page.locator('.ui-source-line').count(), 0)
  assert.equal((await page.getByRole('textbox', { name: '内容 SHA256' }).inputValue()).length, 64)
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(output, 'desktop-source-dark.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.screenshot({ path: path.join(output, 'desktop-document-dark.png') })
  await page.getByRole('button', { name: '显示知识图谱', exact: true }).click()
  assert(
    (await page
      .getByRole('button', { name: '关系清单', exact: true })
      .getAttribute('aria-pressed')) === 'true',
  )
  await page.getByRole('button', { name: '图谱', exact: true }).click()
  await page.getByRole('textbox', { name: '检索知识', exact: true }).fill('版本')
  await page.getByRole('heading', { name: '检索结果', exact: true }).waitFor()
  await page.getByRole('button', { name: '阅读 数据与版本', exact: true }).click()
  assert((await page.locator('.ui-document h2').first().textContent()) === '数据与版本')
  await page.getByRole('button', { name: '知识库管理', exact: true }).click()
  await page.getByRole('button', { name: '复制构建请求', exact: true }).click()
  await page.locator('dialog:not([aria-busy="true"])').waitFor()
  assert(copied.includes(library.kbId))
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  assert(
    await page
      .getByRole('button', { name: '打开 Lumi 产品工程', exact: true })
      .evaluate((element) => document.activeElement === element),
  )
  await page.getByRole('tab', { name: '已归档', exact: true }).click()
  await page.getByRole('button', { name: '打开 旧版工程', exact: true }).click()
  await page.locator('.ui-graph canvas').first().waitFor()
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  await page.getByRole('tab', { name: '全部', exact: true }).click()
  await page.getByRole('button', { name: '新建知识库', exact: true }).click()
  await page.getByRole('button', { name: '授权并创建', exact: true }).click()
  assert(
    (await page
      .getByRole('textbox', { name: '项目名称', exact: true })
      .getAttribute('aria-invalid')) === 'true',
  )
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('创建联调')
  await page.getByRole('button', { name: '选择项目目录', exact: true }).click()
  await page.getByRole('button', { name: '授权并创建', exact: true }).click()
  await page.getByRole('heading', { name: '知识正在形成', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  await page.getByRole('button', { name: '打开 待授权目录', exact: true }).click()
  await page.getByRole('button', { name: '审阅授权', exact: true }).click()
  await page.getByRole('dialog', { name: '授权来源目录' }).waitFor()
  await page.getByRole('button', { name: '允许读取', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  const portable = await host('export', { kbId: library.kbId })
  portable.name = '导入联调'
  await page.locator('input[type=file]').setInputFiles({
    name: 'import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(portable)),
  })
  await page.getByRole('heading', { name: '导入联调', exact: true }).waitFor()
  await page.getByRole('button', { name: '知识库管理', exact: true }).click()
  await page.getByRole('button', { name: '重新授权', exact: true }).click()
  await page.getByRole('dialog', { name: '授权来源目录', exact: true }).waitFor()
  assert(await page.getByRole('button', { name: '允许读取', exact: true }).isDisabled())
  assert(!(await page.getByRole('dialog').textContent()).includes(project))
  pickerDirectory = path.join(temp, 'project-b')
  await fs.mkdir(pickerDirectory)
  await fs.writeFile(path.join(pickerDirectory, 'README.md'), '# Different project')
  await page.getByRole('button', { name: '绑定项目目录', exact: true }).click()
  assert(await page.getByRole('button', { name: '允许读取', exact: true }).isEnabled())
  await page.getByRole('button', { name: '允许读取', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const imported = core.knowledge.list(true).find((item) => item.name === '导入联调')
  assert.equal(
    (await host('source_request', { sourceId: imported.sourceId })).directory,
    await fs.realpath(pickerDirectory),
  )
  await page.getByRole('button', { name: '返回知识库', exact: true }).click()
  await page.getByRole('button', { name: '打开 Lumi 产品工程', exact: true }).click()
  for (const button of await page.getByRole('button', { name: '关闭提示', exact: true }).all())
    await button.click()
  await page.waitForTimeout(180)
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  await page.waitForTimeout(150)
  assert.deepEqual((await graphState()).colorMismatches, [])
  await page.screenshot({ path: path.join(output, 'desktop-graph-light.png') })
  for (const viewport of [
    { width: 900, height: 650 },
    { width: 720, height: 560 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(250)
    assert.deepEqual(await overflow(), { page: false, workspace: false })
    await verifyGraphLayout()
    const pixels = await page.locator('.ui-graph canvas').evaluateAll((canvases) =>
      canvases.map((canvas) => {
        const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let count = 0
        for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) count++
        return count
      }),
    )
    assert(
      pixels.some((count) => count > 400),
      `Graph blank at ${viewport.width}`,
    )
    await page.screenshot({ path: path.join(output, `${viewport.width}-graph-light.png`) })
    if (viewport.width <= 720) {
      await page.getByRole('button', { name: '目录', exact: true }).click()
      await page
        .getByRole('dialog', { name: '知识目录', exact: true })
        .getByRole('treeitem', { name: 'MCP 工具契约', exact: true })
        .click()
      await page.locator('.ui-document').waitFor()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.screenshot({ path: path.join(output, `${viewport.width}-document-light.png`) })
      await page.getByRole('button', { name: '显示知识图谱', exact: true }).click()
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        backend: 'real Core SQLite + official MCP client',
        nativeIPC: 'browser transport bridge only',
        screenshots: true,
        canvasPixels: pixelCheck,
        errors,
        externalRequests: requests,
        checks: [
          'grid',
          'graph pixels',
          'keyboard relationship list',
          'document',
          'source evidence',
          'Escape/focus return',
          'search',
          'archive readability',
          'form validation/create',
          'MCP source authorization',
          'light/dark',
          '1440/900/720/390 overflow',
        ],
      },
      null,
      2,
    ),
  )
  console.log('Knowledge production UI verification passed:', output)
  }
} finally {
  await browser?.close()
  await client.close()
  await core.stop()
  await fs.rm(temp, { recursive: true, force: true })
}
