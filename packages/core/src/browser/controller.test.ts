// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserUserController } from './controller'
import type { BrowserService } from './service'
import type { BrowserRegistration } from './registration'
import { OFFICIAL_BROWSER_EXTENSION_ID as officialId } from '@lumiplug/shared'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-browser-controller-'))
  roots.push(root)
  let enabled = false,
    extensionId: string | null = null
  const browser = {
    status: () => ({
      enabled,
      extensionId,
      connectedHosts: 0,
      sessions: [],
      controlDomain: 'shared-lumi' as const,
    }),
    start: vi.fn(async (id: string) => {
      enabled = true
      extensionId = id
    }),
    disable: vi.fn(async () => {
      enabled = false
    }),
    close: vi.fn(async () => {
      enabled = false
    }),
  }
  const registration = {
    status: vi.fn(async () => ({
      registered: true,
      supported: true,
      nativeHostPath: '/fixture/native-host',
      issues: [] as string[],
    })),
    register: vi.fn(async () => ({ registered: true })),
    repairOwnedPath: vi.fn(async () => ({ registered: true })),
    remove: vi.fn(async () => {}),
  }
  const dependencies = {
    browser: browser as unknown as BrowserService,
    registration: registration as unknown as BrowserRegistration,
  }
  return {
    root,
    browser,
    registration,
    controller: new BrowserUserController({ userDataDir: root }, dependencies),
    dependencies,
  }
}
describe('Browser User host-only lifecycle', () => {
  it('defaults off; confirmation is required before persistent registration', async () => {
    const f = fixture()
    expect((await f.controller.status()).enabled).toBe(false)
    await expect(
      f.controller.action({ action: 'enable', extensionId: officialId }),
    ).rejects.toThrow('browser_confirmation_required')
    expect(f.registration.register).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(f.root, 'browser-user.json'))).toBe(false)
  })
  it('enables explicitly, persists preference, disables without removing unrelated registration', async () => {
    const f = fixture(),
      id = officialId
    expect(
      (await f.controller.action({ action: 'enable', extensionId: id, confirmed: true })).enabled,
    ).toBe(true)
    expect(f.registration.register).toHaveBeenCalledWith(id, true)
    expect(JSON.parse(fs.readFileSync(path.join(f.root, 'browser-user.json'), 'utf8'))).toEqual({
      enabled: true,
      extensionId: id,
      autoRepair: false,
    })
    await f.controller.action({ action: 'disable', confirmed: true })
    expect((await f.controller.status()).enabled).toBe(false)
    expect(f.registration.remove).not.toHaveBeenCalled()
  })
  it('restores only already-consented settings with matching registration; never silently repairs', async () => {
    const f = fixture()
    fs.writeFileSync(
      path.join(f.root, 'browser-user.json'),
      JSON.stringify({ enabled: true, extensionId: officialId }),
    )
    f.registration.status.mockResolvedValue({
      registered: false,
      supported: true,
      nativeHostPath: '/fixture/native-host',
      issues: ['moved'],
    })
    const restored = new BrowserUserController({ userDataDir: f.root }, f.dependencies)
    await restored.restore()
    expect(f.browser.start).not.toHaveBeenCalled()
    expect(f.registration.register).not.toHaveBeenCalled()
    expect((await restored.status()).issues).toContain('browser_registration_repair_required')
  })
  it('keeps browser off after registration failure and removes only on explicit confirmation', async () => {
    const f = fixture()
    f.registration.register.mockRejectedValueOnce(new Error('registration failed'))
    await expect(
      f.controller.action({ action: 'enable', extensionId: officialId, confirmed: true }),
    ).rejects.toThrow('registration failed')
    expect((await f.controller.status()).enabled).toBe(false)
    await f.controller.action({ action: 'remove', confirmed: true })
    expect(f.registration.remove).toHaveBeenCalledWith(true)
    expect((await f.controller.status()).extensionId).toBeNull()
  })
  it('serializes restore with disable and cannot reopen after close while registration is pending', async () => {
    for (const action of ['disable', 'close'] as const) {
      const f = fixture()
      fs.writeFileSync(
        path.join(f.root, 'browser-user.json'),
        JSON.stringify({ enabled: true, extensionId: officialId }),
      )
      let resolve!: (value: Awaited<ReturnType<typeof f.registration.status>>) => void
      f.registration.status.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      const restored = new BrowserUserController({ userDataDir: f.root }, f.dependencies)
      const restoring = restored.restore()
      await Promise.resolve()
      const stopping =
        action === 'close'
          ? restored.close()
          : restored.action({ action: 'disable', confirmed: true })
      resolve({
        registered: true,
        supported: true,
        nativeHostPath: '/fixture/native-host',
        issues: [],
      })
      await restoring
      await stopping
      expect(f.browser.status().enabled).toBe(false)
      if (action === 'close') expect(f.browser.start).not.toHaveBeenCalled()
    }
  })
})

it('defaults enable to the official ID and is idempotent without renewing consent', async () => {
  const f = fixture()
  await f.controller.action({ action: 'enable', confirmed: true })
  expect(f.registration.register).toHaveBeenCalledWith(officialId, true)
  expect((await f.controller.status()).autoRepair).toBe(false)
  await f.controller.action({ action: 'enable', confirmed: true })
  expect(f.registration.register).toHaveBeenCalledTimes(1)
  expect(f.browser.start).toHaveBeenCalledTimes(1)
  await f.controller.action({ action: 'enable', confirmed: true, autoRepair: true })
  expect((await f.controller.status()).autoRepair).toBe(true)
  expect(f.registration.register).toHaveBeenCalledTimes(1)
})

it('does not silently restore or migrate a previously saved other extension ID', async () => {
  const f = fixture()
  const legacyId = 'b'.repeat(32)
  fs.writeFileSync(
    path.join(f.root, 'browser-user.json'),
    JSON.stringify({ enabled: true, extensionId: legacyId, autoRepair: true }),
  )
  const controller = new BrowserUserController({ userDataDir: f.root }, f.dependencies)
  await controller.restore()
  expect(f.browser.start).not.toHaveBeenCalled()
  expect(f.registration.repairOwnedPath).not.toHaveBeenCalled()
  expect((await controller.status()).migrationRequired).toBe(true)
  await expect(controller.action({ action: 'enable', confirmed: true })).rejects.toThrow(
    'migration_confirmation_required',
  )
  expect(f.registration.register).not.toHaveBeenCalled()
  await controller.action({ action: 'enable', confirmed: true, migrateConfirmed: true })
  expect(f.registration.register).toHaveBeenCalledWith(officialId, true, { migrateConfirmed: true })
  expect((await controller.status()).autoRepair).toBe(false)
  await expect(
    controller.action({ action: 'enable', confirmed: true, extensionId: legacyId }),
  ).rejects.toThrow('not_official')
})

it('also requires migration confirmation for an existing registered ID without saved preferences', async () => {
  const f = fixture()
  f.registration.status.mockResolvedValue({
    ...(await f.registration.status()),
    extensionId: 'b'.repeat(32),
  } as Awaited<ReturnType<typeof f.registration.status>>)
  await expect(f.controller.action({ action: 'enable', confirmed: true })).rejects.toThrow(
    'migration_confirmation_required',
  )
  expect(f.registration.register).not.toHaveBeenCalled()
})

it('restores path repair only after a saved same-ID maintenance authorization', async () => {
  for (const autoRepair of [false, true]) {
    const f = fixture()
    fs.writeFileSync(
      path.join(f.root, 'browser-user.json'),
      JSON.stringify({ enabled: true, extensionId: officialId, autoRepair }),
    )
    f.registration.status.mockResolvedValue({
      registered: false,
      supported: true,
      nativeHostPath: '/fixture/native-host',
      issues: ['browser_registration_path_changed'],
    })
    const controller = new BrowserUserController({ userDataDir: f.root }, f.dependencies)
    await controller.restore()
    expect(f.registration.register).not.toHaveBeenCalled()
    expect(f.registration.repairOwnedPath).toHaveBeenCalledTimes(autoRepair ? 1 : 0)
    expect(f.browser.start).toHaveBeenCalledTimes(autoRepair ? 1 : 0)
  }
})

it('does not start on ineligible auto-repair and close wins during an authorized repair', async () => {
  const f = fixture()
  fs.writeFileSync(
    path.join(f.root, 'browser-user.json'),
    JSON.stringify({ enabled: true, extensionId: officialId, autoRepair: true }),
  )
  f.registration.status.mockResolvedValue({
    registered: false,
    supported: true,
    nativeHostPath: '/fixture/native-host',
    issues: ['browser_registration_path_changed'],
  })
  f.registration.repairOwnedPath.mockRejectedValueOnce(
    new Error('browser_auto_repair_not_eligible'),
  )
  const controller = new BrowserUserController({ userDataDir: f.root }, f.dependencies)
  await controller.restore()
  expect(f.browser.start).not.toHaveBeenCalled()
  let finish!: (value: { registered: boolean }) => void
  f.registration.repairOwnedPath.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const restoring = controller.restore()
  for (let index = 0; index < 5 && !finish; index++) await Promise.resolve()
  const closing = controller.close()
  finish({ registered: true })
  await restoring
  await closing
  expect(f.browser.start).not.toHaveBeenCalled()
})

it('does not enable when registration writes return an unverified result', async () => {
  const f = fixture()
  f.registration.register.mockResolvedValueOnce({ registered: false })
  await expect(f.controller.action({ action: 'enable', confirmed: true })).rejects.toThrow(
    'repair_required',
  )
  expect(f.browser.start).not.toHaveBeenCalled()
  expect(JSON.parse(fs.readFileSync(path.join(f.root, 'browser-user.json'), 'utf8')).enabled).toBe(
    false,
  )
})
