// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOME_CONTRACT, SESSION_TOKEN_HEADER } from '@lumiplug/shared'
import type { HomeBundle } from '@lumiplug/shared'
import { CoreService } from '../service'
import { homeTemplate, exportHomeProject, homeSourceForExport } from './template'
import { validateHomeBundle } from './validation'

let service: CoreService
let directory: string
const token = 'home-test-session-0123456789abcdef'
export function homeFixture(name = '自定义主页'): HomeBundle {
  const template = homeTemplate()
  const sourceFiles: HomeBundle['sourceFiles'] = template.files
  const manifestFile = sourceFiles.find((file) => file.path === 'lumi.home.json')!
  const manifest = JSON.parse(manifestFile.content) as HomeBundle['manifest']
  manifest.name = name
  manifestFile.content = JSON.stringify(manifest)
  const files: HomeBundle['files'] = [
    {
      path: 'index.html',
      encoding: 'utf8',
      content:
        '<!doctype html><html><head><script src="./app.js"></script><link rel="stylesheet" href="./style.css"><script type="module" src="./assets/page.js"></script></head><body>自定义主页</body></html>',
    },
    { path: 'app.js', encoding: 'utf8', content: 'window.homeLoaded = Boolean(window.lumi)' },
    { path: 'style.css', encoding: 'utf8', content: 'body { color: #fff; }' },
    { path: 'assets/page.js', encoding: 'utf8', content: 'document.body.dataset.loaded = "yes"' },
  ]
  for (const source of sourceFiles) {
    const runtime = files.find((file) => file.path === source.path)
    if (runtime) source.content = runtime.content
  }
  for (const runtime of files) {
    if (!sourceFiles.some((source) => source.path === runtime.path)) sourceFiles.push(runtime)
  }
  return { manifest, sourceFiles, files }
}
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-home-test-'))
  service = new CoreService({
    host: '127.0.0.1',
    port: 0,
    sessionToken: token,
    userDataDir: directory,
  })
  await service.start()
})
afterEach(async () => {
  await service.stop()
  fs.rmSync(directory, { recursive: true, force: true })
})
async function app(route: string, body?: unknown) {
  return fetch(`http://127.0.0.1:${service.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { [SESSION_TOKEN_HEADER]: token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('official homepage project', () => {
  it('provides a no-build HTML template and refuses export overwrite', () => {
    const template = homeTemplate()
    expect(template.contract).toEqual(HOME_CONTRACT)
    expect(template.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'index.html',
        'app.js',
        'style.css',
        'lumi-sdk.js',
        'LUMI_DEVELOPMENT.md',
        'knowledge/sdk-api.md',
      ]),
    )
    const exportDir = path.join(directory, 'export')
    exportHomeProject(exportDir, template.files)
    expect(fs.readFileSync(path.join(exportDir, 'app.js'), 'utf8')).toContain(
      'window.lumi.tools.call',
    )
    expect(fs.existsSync(path.join(exportDir, 'package.json'))).toBe(false)
    expect(() => exportHomeProject(exportDir, template.files)).toThrow('export_directory_not_empty')
    expect(() => exportHomeProject('relative', template.files)).toThrow('invalid_export_directory')
  })

  it('publishes, restores as a new version, preserves source and persists across restart', async () => {
    const first = homeFixture()
    service.workbench.publish(0, first)
    const exported = path.join(directory, 'published-export')
    await service.registry.invoke('Lumi.export_workbench_project', { directory: exported })
    expect(fs.existsSync(path.join(exported, 'knowledge/sdk-api.md'))).toBe(true)
    expect(fs.existsSync(path.join(exported, 'lumi-sdk.js'))).toBe(true)
    expect(fs.readFileSync(path.join(exported, 'app.js'), 'utf8')).toContain('window.homeLoaded')
    service.workbench.publish(1, homeFixture('第二版'))
    expect(() => service.workbench.publish(1, first)).toThrow('workbench_version_conflict')
    expect(service.workbench.restore(2, 1)).toMatchObject({ version: 3, bundle: first })
    const project = await service.registry.invoke('Lumi.get_workbench', {})
    expect(project).toMatchObject({ version: 3, sourceFiles: first.sourceFiles })
    expect(project).not.toHaveProperty('bundle')
    expect(
      await service.registry.invoke('Lumi.get_workbench', { includeBundle: true }),
    ).toHaveProperty('bundle', first)
    await service.stop()
    service = new CoreService({
      host: '127.0.0.1',
      port: 0,
      sessionToken: token,
      userDataDir: directory,
    })
    await service.start()
    expect(service.workbench.get()).toMatchObject({ version: 3, bundle: first })
  })

  it('loads an older release unchanged after upgrade and preserves publish, export, restore and project state', async () => {
    const older = homeFixture('升级前主页')
    older.manifest.lumiVersion = '0.1.0'
    older.manifest.sdkVersion = '0.1.0'
    older.sourceFiles.find((file) => file.path === 'lumi.home.json')!.content = JSON.stringify(
      older.manifest,
    )
    service.database.raw
      .prepare(
        'INSERT INTO workbench_versions (version, document_json, updated_at) VALUES (?, ?, ?)',
      )
      .run(1, JSON.stringify(older), new Date().toISOString())
    service.workbench.state(older.manifest.projectId, 'set', 'preferences', { compact: true })

    const { data: view } = await (await app('/app/workbench')).json()
    expect(view).toMatchObject({ version: 1, compatible: true, manifest: older.manifest })
    expect((await fetch(view.runtimeUrl)).status).toBe(200)
    const sdk = await fetch(new URL('./lumi-sdk.js', view.runtimeUrl))
    expect(await sdk.text()).toContain(HOME_CONTRACT.sdkVersion)
    expect(
      await service.registry.homeRpc({ version: 1, method: 'context.get', args: {} }),
    ).toMatchObject({ ok: true })
    const exported = path.join(directory, 'older-home-export')
    await service.registry.invoke('Lumi.export_workbench_project', { directory: exported })
    expect(JSON.parse(fs.readFileSync(path.join(exported, 'lumi.home.json'), 'utf8'))).toEqual(
      older.manifest,
    )
    expect(service.workbench.get()).toMatchObject({ version: 1, bundle: older })
    expect(service.workbench.restore(1, 1)).toMatchObject({ version: 2, bundle: older })
    expect(
      (await app('/app/workbench/publish', { expectedVersion: 2, bundle: older })).status,
    ).toBe(200)

    await service.stop()
    service = new CoreService({
      host: '127.0.0.1',
      port: 0,
      sessionToken: token,
      userDataDir: directory,
    })
    await service.start()
    const { data: restarted } = await (await app('/app/workbench')).json()
    expect(restarted).toMatchObject({ version: 3, compatible: true, manifest: older.manifest })
    expect((await fetch(restarted.runtimeUrl)).status).toBe(200)
    expect(service.workbench.get().bundle).toEqual(older)
    expect(service.workbench.state(older.manifest.projectId, 'get', 'preferences')).toEqual({
      compact: true,
    })
  })

  it('does not gate publication on newer or differing application and SDK release numbers', async () => {
    const bundle = homeFixture()
    bundle.manifest.lumiVersion = '9.0.0'
    bundle.manifest.sdkVersion = '8.2.1'
    bundle.sourceFiles.find((file) => file.path === 'lumi.home.json')!.content = JSON.stringify(
      bundle.manifest,
    )
    expect(validateHomeBundle(bundle)).toEqual(bundle)
    service.workbench.publish(0, bundle)
    const { data: view } = await (await app('/app/workbench')).json()
    expect(view.compatible).toBe(true)
    expect((await fetch(view.runtimeUrl)).status).toBe(200)
  })

  it.each([
    { formatVersion: 1 },
    { bridgeVersion: 2 },
    { template: 'unsupported' },
    { entry: 'other.html' },
  ])('rejects stored projects outside the HTML contract: %j', async (contract) => {
    const unsupported = homeFixture()
    Object.assign(unsupported.manifest, contract)
    service.database.raw
      .prepare(
        'INSERT INTO workbench_versions (version, document_json, updated_at) VALUES (?, ?, ?)',
      )
      .run(1, JSON.stringify(unsupported), new Date().toISOString())
    const { data: view } = await (await app('/app/workbench')).json()
    expect(view.compatible).toBe(false)
    expect(view.runtimeUrl).toBeNull()
    expect(() => service.workbench.restore(1, 1)).toThrow('invalid_home_bundle')
    expect(() => homeSourceForExport(unsupported)).toThrow('home_version_incompatible')
    expect(service.workbench.get().version).toBe(1)
  })

  it('rejects incompatible, unsafe, duplicate or incomplete bundles before touching current content', () => {
    const good = homeFixture()
    service.workbench.publish(0, good)
    for (const mutate of [
      (bundle: HomeBundle) => {
        Object.assign(bundle.manifest, { bridgeVersion: 2 })
      },
      (bundle: HomeBundle) => {
        bundle.files[0]!.path = '../index.html'
      },
      (bundle: HomeBundle) => {
        bundle.files.push(bundle.files[0]!)
      },
      (bundle: HomeBundle) => {
        bundle.sourceFiles = []
      },
      (bundle: HomeBundle) => {
        bundle.files = bundle.files.filter((file) => file.path !== 'app.js')
      },
      (bundle: HomeBundle) => {
        bundle.files.push({ path: 'lumi-sdk.js', encoding: 'utf8', content: 'fake' })
      },
      (bundle: HomeBundle) => {
        bundle.files.push({ path: 'theme.css', encoding: 'utf8', content: 'fake' })
      },
      (bundle: HomeBundle) => {
        bundle.files[0]!.encoding = 'base64'
        bundle.files[0]!.content = 'bad!'
      },
      (bundle: HomeBundle) => {
        bundle.files[0]!.content = 'a'.repeat(4 * 1024 * 1024 + 1)
      },
    ]) {
      const bad = structuredClone(good)
      mutate(bad)
      expect(() => service.workbench.publish(1, bad)).toThrow()
      expect(service.workbench.get().version).toBe(1)
    }
    expect(validateHomeBundle(good)).toEqual(good)
  })

  it('accepts native JSON field reordering and still rejects changed source manifest values', async () => {
    const bundle = homeFixture()
    const reordered = JSON.parse(
      JSON.stringify(bundle, (_key, value: unknown) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
            )
          : value,
      ),
    ) as HomeBundle
    const response = await app('/app/workbench/publish', { expectedVersion: 0, bundle: reordered })
    expect(response.status).toBe(200)
    const sourceManifest = reordered.sourceFiles.find((file) => file.path === 'lumi.home.json')!
    const changed = JSON.parse(sourceManifest.content)
    changed.name = '不同的源码名称'
    sourceManifest.content = JSON.stringify(changed)
    expect(() => validateHomeBundle(reordered)).toThrow('invalid_home_bundle')
    expect(service.workbench.get().version).toBe(1)
  })

  it('uses the Registry for real SDK tool calls, rejects management methods and expires old frames', async () => {
    service.workbench.publish(0, homeFixture())
    const call = (method: string, args = {}) =>
      service.registry.homeRpc({ version: 1, method, args })
    expect(await call('tools.list')).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          name: 'Lumi.create_capability_draft',
          inputSchema: expect.any(Object),
        }),
      ]),
    })
    const tools = JSON.stringify(await call('tools.list'))
    expect(tools).not.toContain('Lumi.publish_workbench')
    expect(tools).not.toContain(token)
    expect(
      await call('tools.call', {
        name: 'Lumi.create_capability_draft',
        arguments: { kind: 'terminal', name: 'from-home' },
      }),
    ).toMatchObject({ ok: true, data: { capability: { name: 'from-home', enabled: false } } })
    expect(service.repository.listAll()[0]?.name).toBe('from-home')
    expect(
      await call('tools.call', { name: 'Lumi.publish_workbench', arguments: {} }),
    ).toMatchObject({ ok: false, error: { code: 'method_unavailable' } })
    expect(
      await call('tools.call', {
        name: 'Lumi.create_capability_draft',
        arguments: { kind: 'terminal', name: 'bad', enabled: true },
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_tool_arguments' } })
    const executable = service.repository.listAll()[0]!
    if (executable.runner.settings.type === 'terminal') executable.runner.settings.cwd = directory
    service.repository.saveDraft(executable)
    service.registry.enable(executable.id, 'ui')
    expect(
      await call('tools.call', { name: 'local.run', arguments: { command: 'echo test' } }),
    ).toMatchObject({
      ok: true,
      data: { stdout: process.platform === 'win32' ? 'test\r\n' : 'test\n', exitCode: 0 },
    })
    service.workbench.publish(1, homeFixture('新页面'))
    expect(await call('context.get')).toMatchObject({
      ok: false,
      error: { code: 'workbench_instance_expired' },
    })
  })

  it('isolates persistent state by project, retains it across revisions and enforces limits', () => {
    const project = randomUUID()
    service.workbench.state(project, 'set', 'prefs', { compact: true })
    expect(service.workbench.state(randomUUID(), 'get', 'prefs')).toBeNull()
    expect(service.workbench.state(project, 'get', 'prefs')).toEqual({ compact: true })
    expect(() =>
      service.workbench.state(project, 'set', 'oversize', 'x'.repeat(33 * 1024)),
    ).toThrow('invalid_workbench_state')
    expect(() => service.workbench.state(project, 'get', '../private')).toThrow()
    for (let index = 0; index < 127; index++)
      service.workbench.state(project, 'set', `key-${index}`, index)
    expect(() => service.workbench.state(project, 'set', 'overflow', 0)).toThrow()
    service.workbench.state(project, 'set', 'prefs', false)
    service.workbench.state(project, 'delete', 'prefs')
    expect(service.workbench.state(project, 'get', 'prefs')).toBeNull()
  })

  it('serves modules at a separate opaque-origin resource endpoint with no Core API or source access', async () => {
    const publish = await app('/app/workbench/publish', {
      expectedVersion: 0,
      bundle: homeFixture(),
    })
    expect(publish.status).toBe(200)
    const { data: view } = await (await app('/app/workbench')).json()
    const entry = await fetch(view.runtimeUrl)
    expect(entry.status).toBe(200)
    expect(await entry.text()).toContain('<script src="./lumi-sdk.js"></script>')
    expect(entry.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(entry.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(entry.headers.get('access-control-allow-origin')).toBe('*')
    const runtime = new URL(view.runtimeUrl)
    expect(runtime.port).not.toBe(String(service.port))
    const module = await fetch(new URL('./assets/page.js', runtime), {
      headers: { origin: 'null' },
    })
    expect(module.headers.get('content-type')).toContain('javascript')
    const sdk = await fetch(new URL('./lumi-sdk.js', runtime))
    expect(sdk.status).toBe(200)
    expect(await sdk.text()).toContain('lumi.home.ready')
    expect((await fetch(new URL('./theme.css', runtime))).status).toBe(200)
    expect((await fetch(new URL('/app/workbench', runtime))).status).toBe(404)
    expect((await fetch(new URL('./src/App.tsx', runtime))).status).toBe(404)
    expect((await fetch(new URL('./../../../../etc/passwd', runtime))).status).toBe(404)
    const unauthorized = await fetch(`http://127.0.0.1:${service.port}/app/workbench`)
    expect(unauthorized.status).toBe(401)
    const conflict = await app('/app/workbench/publish', {
      expectedVersion: 0,
      bundle: homeFixture(),
    })
    expect(conflict.status).toBe(409)
    expect(
      await (
        await app('/app/workbench/rpc', { version: 1, method: 'context.get', args: {} })
      ).json(),
    ).toMatchObject({ data: { ok: true, data: { features: { runnerExecution: true } } } })
  })
})
