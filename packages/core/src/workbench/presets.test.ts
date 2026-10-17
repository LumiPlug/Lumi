// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_TOKEN_HEADER, WORKBENCH_PRESETS } from '@lumiplug/shared'
import { CoreService } from '../service'
import { homePreset } from './template'
import { validateHomeBundle } from './validation'

let service: CoreService
let directory: string
const token = 'preset-test-only-0123456789abcdef'
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-presets-'))
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
function apply(template: unknown, expectedVersion: number, authenticated = true) {
  return fetch(`http://127.0.0.1:${service.port}/app/workbench/apply-template`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { [SESSION_TOKEN_HEADER]: token } : {}),
    },
    body: JSON.stringify({ template, expectedVersion }),
  })
}

describe('default productivity workbenches', () => {
  it.each(WORKBENCH_PRESETS)(
    'publishes a recoverable $label template with a host SDK and no automatic tool runs',
    async (preset) => {
      const bundle = homePreset(preset.id)
      expect(validateHomeBundle(bundle)).toEqual(bundle)
      expect(homePreset(preset.id).manifest.projectId).not.toBe(bundle.manifest.projectId)
      expect(bundle.files.some((file) => ['lumi-sdk.js', 'theme.css'].includes(file.path))).toBe(
        false,
      )
      expect(bundle.sourceFiles.some((file) => file.path === 'knowledge/sdk-api.md')).toBe(true)
      const response = await apply(preset.id, 0)
      expect(response.status).toBe(200)
      const { data: view } = await response.json()
      expect(view).toMatchObject({
        version: 1,
        compatible: true,
        manifest: { name: `${preset.label}工作台` },
      })
      const page = await fetch(view.runtimeUrl)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('./preset.js')
      expect(await (await fetch(new URL('./preset.js', view.runtimeUrl))).text()).toContain(
        preset.title,
      )
      expect((await fetch(new URL('./lumi-sdk.js', view.runtimeUrl))).status).toBe(200)
      expect((await fetch(new URL('./theme.css', view.runtimeUrl))).status).toBe(200)
      expect(service.tasks.list()).toEqual([])
      expect(
        service.workbench.get().bundle?.sourceFiles.find((file) => file.path === 'preset.js')
          ?.content,
      ).toContain(preset.id)
    },
  )

  it('rejects invalid selections, stale versions and unauthenticated requests without overwriting a home', async () => {
    expect((await apply('unknown', 0)).status).toBe(400)
    expect((await apply('../office', 0)).status).toBe(400)
    expect((await apply('office', 0, false)).status).toBe(401)
    expect(service.workbench.get().version).toBe(0)
    expect((await apply('office', 0)).status).toBe(200)
    const first = service.workbench.get()
    expect((await apply('developer', 0)).status).toBe(409)
    expect((await apply('developer', -1)).status).toBe(400)
    expect(service.workbench.get()).toEqual(first)
  })

  it('isolates project data and retains the previous template and its data when restored', async () => {
    await apply('office', 0)
    const office = service.workbench.get().bundle!.manifest.projectId
    service.workbench.state(office, 'set', 'efficiency.todos', [
      { id: 'todo-1', text: '实际录入的任务', done: false },
    ])
    await apply('creator', 1)
    const creator = service.workbench.get().bundle!.manifest.projectId
    expect(service.workbench.state(creator, 'get', 'efficiency.todos')).toBeNull()
    service.workbench.restore(2, 1)
    expect(service.workbench.get().bundle!.manifest.projectId).toBe(office)
    expect(service.workbench.state(office, 'get', 'efficiency.todos')).toEqual([
      { id: 'todo-1', text: '实际录入的任务', done: false },
    ])
  })
})
