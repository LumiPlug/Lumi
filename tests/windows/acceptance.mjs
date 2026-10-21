// SPDX-License-Identifier: MPL-2.0
// Small W3C client: exercise the release binary without a test plugin or mocked IPC.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { URL } from 'node:url'

assert.equal(process.platform, 'win32', 'Run on Windows; macOS cannot provide WebView2 evidence')
const root = await mkdtemp(path.join(os.tmpdir(), 'Lumi Windows 中文 空格-'))
const home = path.join(root, '测试 用户')
const evidence = path.resolve('reports/windows-acceptance')
const binary = path.resolve('src-tauri/target/release/Lumi.exe')
const appVersion = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
).version
const driverBinary = path.join(os.homedir(), '.cargo/bin/tauri-driver.exe')
const edgeDriver = process.env.LUMI_EDGE_DRIVER
assert.ok(edgeDriver, 'Set LUMI_EDGE_DRIVER to the matching Microsoft Edge Driver')
await Promise.all([access(binary), access(driverBinary), access(edgeDriver)])
await mkdir(evidence, { recursive: true })
// Allowlist environment: no API keys, real client roots or inherited configuration.
const environment = {}
for (const [key, value] of Object.entries(process.env)) {
  if (
    /^(path|systemroot|windir|comspec|pathext|systemdrive|programfiles|programfiles\(x86\)|programw6432|commonprogramfiles|commonprogramfiles\(x86\)|temp|tmp)$/i.test(
      key,
    )
  )
    environment[key] = value
}
Object.assign(environment, {
  USERPROFILE: home,
  HOME: home,
  APPDATA: path.join(home, 'AppData/Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData/Local'),
  WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'WebView2 测试缓存'),
  LUMI_CODEBURN_CACHE_DIR: path.join(root, 'parser-cache'),
})
await Promise.all([
  mkdir(environment.APPDATA, { recursive: true }),
  mkdir(environment.LOCALAPPDATA, { recursive: true }),
])
const now = new Date()
const period = {
  start: new Date(now.getTime() - 86400000).toISOString(),
  end: new Date(now.getTime() + 86400000).toISOString(),
  timezone: 'UTC',
}
const qoder = (id, input = 100) => ({
  type: 'assistant',
  sessionId: 'synthetic-session',
  uuid: `event-${id}`,
  timestamp: now.toISOString(),
  message: {
    id,
    model: 'windows-fixture',
    content: 'SYNTHETIC_ONLY',
    usage: {
      input_tokens: input,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 0,
    },
  },
})
async function source(origin, rows) {
  const directory = path.join(
    home,
    origin === 'cn' ? '.qoder-cn/projects' : '.qoder/projects',
    '中文 项目',
  )
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'session 数据.jsonl'),
    rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n',
  )
}
await source('international', [qoder('same'), qoder('international')])
await source('cn', [qoder('same'), qoder('cn'), 'damaged synthetic row'])

let driver, session
const report = {
  platform: process.platform,
  architecture: process.arch,
  startedAt: now.toISOString(),
  checks: [],
}
const endpoint = 'http://127.0.0.1:4444'
async function request(method, route, body) {
  const response = await globalThis.fetch(endpoint + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(45000),
  })
  const result = await response.json()
  if (!response.ok || result.value?.error)
    throw new Error(`WebDriver ${route}: ${JSON.stringify(result.value)}`)
  return result.value
}
const command = (method, route, body) => request(method, `/session/${session}${route}`, body)
const execute = (script, args = []) => command('POST', '/execute/sync', { script, args })
async function asyncScript(script, args = []) {
  const result = await command('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1]; (async () => { ${script} })().then(value => done({ok:true,value}), error => done({ok:false,error:String(error),code:error?.code}));`,
    args,
  })
  assert.equal(result.ok, true, `${result.error} (${result.code})`)
  return result.value
}
async function waitFor(read, message) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const result = await read()
    if (result) return result
    await setTimeout(250)
  }
  throw new Error(message)
}
async function ipc(name, args = {}) {
  return asyncScript(
    'return window.__TAURI_INTERNALS__.invoke(arguments[0], {...arguments[1], hostNonce: window.__LUMI_HOST_NONCE__});',
    [name, args],
  )
}
const usage = (action) => ipc('usage_request', { action, payload: period })
async function element(selector) {
  const value = await command('POST', '/element', { using: 'css selector', value: selector })
  return value['element-6066-11e4-a52e-4f735466cecf']
}
async function click(selector) {
  await command('POST', `/element/${await element(selector)}/click`, {})
}
async function navigate(label) {
  await click(`.sidebar button[aria-label="${label}"]`)
  await waitFor(
    () =>
      execute(
        'return document.querySelector(arguments[0])?.getAttribute("aria-current") === "page"',
        [`.sidebar button[aria-label="${label}"]`],
      ),
    `Navigation failed: ${label}`,
  )
}
async function frame() {
  await waitFor(
    () =>
      execute(
        'return !!document.querySelector("iframe.workbench-frame") && document.querySelector(".workbench-frame-wrap")?.getAttribute("aria-busy") === "false"',
      ),
    'Workbench bridge never became ready',
  )
  await command('POST', '/frame', {
    id: { 'element-6066-11e4-a52e-4f735466cecf': await element('iframe.workbench-frame') },
  })
  assert.equal((await asyncScript('return await window.lumi.ready()')).mode, 'lumi')
}
async function top() {
  await command('POST', '/frame', { id: null })
}
async function saveReport() {
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n')
}
async function check(id, run) {
  try {
    await run()
    report.checks.push({ id, status: 'passed' })
    console.log(`PASS ${id}`)
  } catch (error) {
    report.checks.push({ id, status: 'failed', error: error.message })
    throw error
  } finally {
    await saveReport()
  }
}
async function start() {
  const log = []
  driver = spawn(driverBinary, ['--native-driver', edgeDriver], {
    env: environment,
    windowsHide: true,
  })
  driver.stdout.on('data', (data) => log.push(data.toString()))
  driver.stderr.on('data', (data) => log.push(data.toString()))
  driver.on('error', (error) => log.push(error.message))
  await waitFor(async () => {
    if (driver.exitCode !== null) throw new Error(`Driver exited: ${log.join('')}`)
    try {
      return (await request('GET', '/status')).ready
    } catch {
      return false
    }
  }, 'Driver did not become ready')
  const result = await request('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application: binary } } },
  })
  session = result.sessionId
  await command('POST', '/timeouts', { script: 40000, implicit: 0, pageLoad: 30000 })
  await waitFor(
    () => execute('return !!window.__LUMI_HOST_NONCE__'),
    'Production host did not initialize',
  )
  await waitFor(
    async () => (await ipc('get_core_status')).state === 'ready',
    'Standalone Core did not become ready',
  )
}
async function stop() {
  if (session) {
    await command('DELETE', '').catch(() => {})
    session = undefined
  }
  if (driver?.pid && driver.exitCode === null) {
    // Kill only the child tree we launched. Never kill by image name or port.
    spawnSync('taskkill.exe', ['/PID', String(driver.pid), '/T', '/F'], { windowsHide: true })
  }
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:LUMI_QA_BINARY } | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }',
    ],
    { env: { ...process.env, LUMI_QA_BINARY: binary }, windowsHide: true },
  )
  driver = undefined
}
const value = { title: 'Windows 中文 持久数据', items: [1, 2, 3] }
try {
  await check('WIN-A01 release startup and real IPC', async () => {
    await start()
    const status = await ipc('get_core_status')
    assert.equal(status.userDataPathAvailable, true)
    assert.equal(status.coreVersion, appVersion)
  })
  await check('WIN-A02 pages and native language persistence', async () => {
    for (const label of ['工具', 'Skills', '知识库', 'AI 用量', '设置']) await navigate(label)
    await waitFor(
      () => execute('return !!document.querySelector(".settings-core-status[data-state=ready]")'),
      'Settings did not show connected Core',
    )
    await click('select[aria-label="语言 / Language"] option[value="en"]')
    await waitFor(
      () =>
        execute(
          'return document.documentElement.lang === "en" && !!document.querySelector(".sidebar button[aria-label=Settings]")',
        ),
      'Language did not switch',
    )
    await navigate('Workbench')
  })
  await check('WIN-A03 WebView2 SDK storage and rejected writes', async () => {
    const current = await ipc('get_workbench')
    await ipc('apply_workbench_template', { template: 'office', expectedVersion: current.version })
    await command('POST', '/refresh', {})
    await frame()
    await waitFor(
      () => execute('return document.querySelector("#todo-input")?.disabled === false'),
      'Todo form did not connect',
    )
    await command('POST', `/element/${await element('#todo-input')}/value`, {
      text: 'Windows 人工同款任务',
    })
    await click('#add-todo')
    await waitFor(
      () =>
        execute(
          'return document.querySelector("#todo-list")?.textContent.includes("Windows 人工同款任务")',
        ),
      'Todo was not added',
    )
    assert.deepEqual(
      await asyncScript('return await window.lumi.storage.set("windows-qa", arguments[0])', [
        value,
      ]),
      value,
    )
    assert.deepEqual(await asyncScript('return await window.lumi.storage.get("windows-qa")'), value)
    const failures = await asyncScript(`
      const codes=[];
      for (const [key,value] of [['bad/key',1], ['windows-qa','x'.repeat(33000)]]) {
        try { await window.lumi.storage.set(key,value); codes.push('unexpected_success'); }
        catch (error) { codes.push(error.code); }
      }
      try { localStorage.setItem('windows-qa','forbidden'); codes.push('unexpected_success'); }
      catch (error) { codes.push(error.name); }
      return codes;`)
    assert.deepEqual(failures, [
      'invalid_workbench_state',
      'invalid_workbench_state',
      'SecurityError',
    ])
    assert.deepEqual(await asyncScript('return await window.lumi.storage.get("windows-qa")'), value)
    await top()
    await command('POST', '/refresh', {})
    await frame()
    assert.deepEqual(await asyncScript('return await window.lumi.storage.get("windows-qa")'), value)
    await waitFor(
      () =>
        execute(
          'return document.querySelector("#todo-list")?.textContent.includes("Windows 人工同款任务")',
        ),
      'Todo missing after reload',
    )
    await top()
  })
  await check('WIN-A04 Qoder international/CN paths, dedup and partial progress', async () => {
    const report = await usage('scan')
    assert.equal(report.matched, 3)
    assert.equal(report.totals.total, 375)
    assert.ok(report.records.some((row) => row.qoderOrigin === 'cn'))
    assert.ok(report.records.some((row) => row.qoderOrigin === 'international'))
    const scan = await usage('status')
    assert.equal(scan.state, 'partial')
    assert.equal(scan.providersDone, scan.providersTotal)
    assert.ok(scan.revision > 0)
    const source = scan.sources.find((row) => row.software === 'qoder')
    assert.equal(source.state, 'partial')
    assert.equal(source.filesProgress.read + source.filesProgress.cached, 2)
    assert.deepEqual(
      { ...source.filesProgress, read: 0, cached: 0 },
      {
        stage: 'done',
        discovered: 2,
        checked: 2,
        read: 0,
        cached: 0,
        deferred: 0,
        limited: 0,
        failed: 0,
        discoveryLimited: false,
      },
    )
    assert.equal((await usage('scan')).totals.total, 375)
    await navigate('AI Usage')
    await waitFor(
      () =>
        execute(
          `return /Partial|部分/.test(document.querySelector('[aria-label="Scan status"]')?.textContent || '')`,
        ),
      'Partial scan warning missing from UI',
    )
  })
  await check('WIN-A05 pause and resume ingest exactly once', async () => {
    await ipc('usage_request', { action: 'pause', payload: { ...period, paused: true } })
    await source('cn', [qoder('same'), qoder('cn'), qoder('new'), 'damaged synthetic row'])
    assert.equal((await usage('status')).state, 'paused')
    assert.equal((await usage('query')).totals.total, 375)
    // Actual refresh control resumes paused scanning.
    await click('button[aria-label="Refresh usage"]')
    await waitFor(
      async () => (await usage('query')).totals.total === 500,
      'Refresh did not resume scanning',
    )
    assert.equal((await usage('scan')).matched, 4)
    await navigate('Workbench')
  })
  await check('WIN-A06 process restart preserves WebView2 SDK data and locale', async () => {
    await stop()
    await start()
    assert.equal(await execute('return document.documentElement.lang'), 'en')
    await frame()
    assert.deepEqual(await asyncScript('return await window.lumi.storage.get("windows-qa")'), value)
    await waitFor(
      () =>
        execute(
          'return document.querySelector("#todo-list")?.textContent.includes("Windows 人工同款任务")',
        ),
      'Todo missing after process restart',
    )
    await asyncScript('return await window.lumi.storage.delete("windows-qa")')
    assert.equal(await asyncScript('return await window.lumi.storage.get("windows-qa")'), null)
    await top()
    assert.equal((await usage('query')).totals.total, 500)
  })
  const screenshot = await command('GET', '/screenshot')
  await writeFile(path.join(evidence, 'workbench.png'), Buffer.from(screenshot, 'base64'))
} catch (error) {
  if (session) {
    try {
      await top()
      await writeFile(
        path.join(evidence, 'failure.png'),
        Buffer.from(await command('GET', '/screenshot'), 'base64'),
      )
    } catch {
      /* Preserve the original assertion failure. */
    }
  }
  console.error(error.message)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await saveReport()
  await stop()
  // Synthetic profiles remain in RUNNER_TEMP until the ephemeral runner is discarded.
  // Do not upload databases, tokens, user profiles or raw driver logs.
}
