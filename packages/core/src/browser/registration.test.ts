// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BrowserRegistration } from './registration'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
const dirs: string[] = []
const id = 'a'.repeat(32)
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function fixture(platform: NodeJS.Platform = 'darwin') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lumi-registration-test-'))
  dirs.push(dir)
  const nativeHostPath = path.join(dir, 'lumi-browser-native-host')
  await writeFile(nativeHostPath, 'test fixture, never execute')
  await chmod(nativeHostPath, 0o700)
  const home = path.join(dir, 'home')
  const values = new Map<string, string>()
  const calls: string[][] = []
  const options = {
    userDataDir: path.join(dir, 'data'),
    nativeHostPath,
    platform,
    home,
    env: { LOCALAPPDATA: path.join(dir, 'local') },
    run: async (_command: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'query') {
        if (!values.has('default')) throw Object.assign(new Error('missing'), { code: 1 })
        return `    (Default)    REG_SZ    ${values.get('default')}\r\n`
      }
      if (args[0] === 'add') {
        values.set('default', args[args.indexOf('/d') + 1]!)
        return ''
      }
      if (args[0] === 'delete') {
        values.delete('default')
        return ''
      }
      throw new Error('Unexpected registry command')
    },
  }
  return {
    dir,
    home,
    nativeHostPath,
    options,
    values,
    calls,
    registration: new BrowserRegistration(options),
  }
}
describe('browser native registration is explicitly confirmed and owned', () => {
  it('status is read-only and unconfirmed registration writes nothing', async () => {
    const f = await fixture()
    expect((await f.registration.status()).registered).toBe(false)
    await expect(f.registration.register(id, false)).rejects.toThrow('confirmation_required')
    await expect(readFile(f.registration.locatorFile)).rejects.toThrow()
    await expect(f.registration.register('A'.repeat(32), true)).rejects.toThrow(
      'extension_id_invalid',
    )
  })
  it('registers exact origin, diagnoses app movement, repairs only explicitly, removes no binary', async () => {
    const f = await fixture()
    expect((await f.registration.register(id, true)).registered).toBe(true)
    const manifest = JSON.parse(await readFile(f.registration.manifestPath, 'utf8'))
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${id}/`])
    expect(manifest.path).toBe(f.nativeHostPath)
    const relocated = path.join(f.dir, 'moved-host')
    await writeFile(relocated, 'new fixture')
    await chmod(relocated, 0o700)
    const moved = new BrowserRegistration({ ...f.options, nativeHostPath: relocated })
    expect((await moved.status()).issues).toContain('browser_registration_path_changed')
    expect(JSON.parse(await readFile(moved.manifestPath, 'utf8')).path).toBe(f.nativeHostPath)
    expect((await moved.register(id, true)).registered).toBe(true)
    await moved.remove(true)
    await expect(readFile(relocated, 'utf8')).resolves.toBe('new fixture')
    await expect(readFile(f.nativeHostPath, 'utf8')).resolves.toBe('test fixture, never execute')
    await expect(readFile(moved.locatorFile)).rejects.toThrow()
    expect((await moved.remove(true)).registered).toBe(false)
  })
  it('refuses foreign manifest and will not overwrite or remove it', async () => {
    const f = await fixture()
    await mkdir(path.dirname(f.registration.manifestPath), { recursive: true })
    await writeFile(f.registration.manifestPath, '{"name":"foreign"}')
    await expect(f.registration.register(id, true)).rejects.toThrow('foreign')
    await expect(f.registration.remove(true)).rejects.toThrow('foreign')
    expect(await readFile(f.registration.manifestPath, 'utf8')).toBe('{"name":"foreign"}')
  })
  it('Windows uses HKCU, detects lost registration and deletes only its default value', async () => {
    const f = await fixture('win32')
    expect((await f.registration.register(id, true)).registered).toBe(true)
    f.values.delete('default')
    expect((await f.registration.status()).issues).toContain('browser_registry_missing_or_changed')
    await f.registration.register(id, true)
    await f.registration.remove(true)
    expect(f.calls.some((c) => c[0] === 'delete' && c.includes('/ve'))).toBe(true)
    expect(f.calls.every((c) => c[1]?.startsWith('HKCU\\'))).toBe(true)
  })
  it('rejects a foreign registry destination without registration writes', async () => {
    const f = await fixture('win32')
    f.values.set('default', 'foreign.json')
    await expect(f.registration.register(id, true)).rejects.toThrow('foreign')
    expect(f.calls.every((c) => c[0] === 'query')).toBe(true)
  })
})

describe('registration transactions', () => {
  it('rolls back locator when manifest write fails and remains repairable', async () => {
    const f = await fixture()
    await f.registration.register(id, true)
    const locator = await readFile(f.registration.locatorFile, 'utf8')
    const manifest = await readFile(f.registration.manifestPath, 'utf8')
    const failing = new BrowserRegistration({
      ...f.options,
      beforeWrite: async (file) => {
        if (file === f.registration.manifestPath) throw new Error('simulated ENOSPC')
      },
    })
    await expect(
      failing.register('b'.repeat(32), true, { migrateConfirmed: true }),
    ).rejects.toThrow('write_failed')
    expect(await readFile(f.registration.locatorFile, 'utf8')).toBe(locator)
    expect(await readFile(f.registration.manifestPath, 'utf8')).toBe(manifest)
    await expect(readFile(f.registration.transactionFile)).rejects.toThrow()
    expect(
      (await f.registration.register('b'.repeat(32), true, { migrateConfirmed: true })).registered,
    ).toBe(true)
  })
  it('retains a bounded ownership journal if rollback fails and resumes only on confirmed repair', async () => {
    const f = await fixture()
    await f.registration.register(id, true)
    let locatorWrites = 0
    const failing = new BrowserRegistration({
      ...f.options,
      beforeWrite: async (file) => {
        if (file === f.registration.manifestPath) throw new Error('simulated manifest failure')
        if (file === f.registration.locatorFile && ++locatorWrites > 1)
          throw new Error('simulated rollback failure')
      },
    })
    await expect(
      failing.register('b'.repeat(32), true, { migrateConfirmed: true }),
    ).rejects.toThrow('recovery_required')
    const pending = await readFile(f.registration.transactionFile, 'utf8')
    expect((await f.registration.status()).issues).toContain(
      'browser_registration_recovery_required',
    )
    await expect(f.registration.register('b'.repeat(32), false)).rejects.toThrow(
      'confirmation_required',
    )
    expect(await readFile(f.registration.transactionFile, 'utf8')).toBe(pending)
    expect(
      (await f.registration.register('b'.repeat(32), true, { migrateConfirmed: true })).registered,
    ).toBe(true)
    await expect(readFile(f.registration.transactionFile)).rejects.toThrow()
  })
  it('never rolls back over an unrelated change after a partial transaction', async () => {
    const f = await fixture()
    await f.registration.register(id, true)
    let locatorWrites = 0
    const failing = new BrowserRegistration({
      ...f.options,
      beforeWrite: async (file) => {
        if (
          file === f.registration.manifestPath ||
          (file === f.registration.locatorFile && ++locatorWrites > 1)
        )
          throw new Error('simulated disk failure')
      },
    })
    await expect(
      failing.register('b'.repeat(32), true, { migrateConfirmed: true }),
    ).rejects.toThrow('recovery_required')
    await writeFile(f.registration.manifestPath, '{"name":"another-owner"}')
    await expect(
      f.registration.register('b'.repeat(32), true, { migrateConfirmed: true }),
    ).rejects.toThrow('foreign_transaction')
    await expect(f.registration.remove(true)).rejects.toThrow('foreign_transaction')
    expect(await readFile(f.registration.manifestPath, 'utf8')).toBe('{"name":"another-owner"}')
  })
  it('rolls back a first-time Windows registry failure without leaving false registration', async () => {
    const f = await fixture('win32')
    const failing = new BrowserRegistration({
      ...f.options,
      run: async (command, args) => {
        if (args[0] === 'add') throw new Error('simulated registry write failure')
        return f.options.run(command, args)
      },
    })
    await expect(failing.register(id, true)).rejects.toThrow('write_failed')
    await expect(readFile(f.registration.locatorFile)).rejects.toThrow()
    await expect(readFile(f.registration.manifestPath)).rejects.toThrow()
    await expect(readFile(f.registration.transactionFile)).rejects.toThrow()
    expect((await f.registration.register(id, true)).registered).toBe(true)
  })
})

it('requires separate confirmation before changing an owned extension ID', async () => {
  const f = await fixture()
  await f.registration.register(id, true)
  const before = await readFile(f.registration.locatorFile, 'utf8')
  await expect(f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'migration_confirmation_required',
  )
  expect(await readFile(f.registration.locatorFile, 'utf8')).toBe(before)
  expect(
    (await f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true, { migrateConfirmed: true }))
      .registered,
  ).toBe(true)
})

it('does not rewrite an already matching registration', async () => {
  const f = await fixture()
  await f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true)
  const idempotent = new BrowserRegistration({
    ...f.options,
    beforeWrite: async () => {
      throw new Error('unexpected write')
    },
  })
  expect((await idempotent.register(OFFICIAL_BROWSER_EXTENSION_ID, true)).registered).toBe(true)
})

it('repairs only an authorized owned same-ID executable relocation, not runtime or registration damage', async () => {
  const f = await fixture()
  await f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true)
  const movedPath = path.join(f.dir, 'new-app', 'lumi-browser-native-host')
  await mkdir(path.dirname(movedPath))
  await writeFile(movedPath, 'current-app host fixture')
  await chmod(movedPath, 0o700)
  const moved = new BrowserRegistration({ ...f.options, nativeHostPath: movedPath })
  const before = await readFile(moved.locatorFile, 'utf8')
  await expect(moved.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, false)).rejects.toThrow(
    'not_authorized',
  )
  expect(await readFile(moved.locatorFile, 'utf8')).toBe(before)
  expect((await moved.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).registered).toBe(true)
  expect((await moved.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).registered).toBe(true)
  const changedData = new BrowserRegistration({
    ...f.options,
    nativeHostPath: movedPath,
    userDataDir: path.join(f.dir, 'different-data'),
  })
  await expect(changedData.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'not_eligible',
  )
  await expect(moved.repairOwnedPath('b'.repeat(32), true)).rejects.toThrow('not_eligible')
})

it('auto repair never creates absent registration or adopts a foreign manifest, even with migration consent', async () => {
  const f = await fixture()
  await expect(f.registration.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'not_eligible',
  )
  await mkdir(path.dirname(f.registration.manifestPath), { recursive: true })
  await writeFile(f.registration.manifestPath, '{"name":"foreign"}')
  await expect(f.registration.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'foreign',
  )
  await expect(
    f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true, { migrateConfirmed: true }),
  ).rejects.toThrow('foreign')
  expect(await readFile(f.registration.manifestPath, 'utf8')).toBe('{"name":"foreign"}')
})

it('authorized path repair leaves pending recovery journals and foreign changes untouched', async () => {
  const f = await fixture()
  await f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true)
  const movedPath = path.join(f.dir, 'moved-app', 'lumi-browser-native-host')
  await mkdir(path.dirname(movedPath))
  await writeFile(movedPath, 'fixture')
  await chmod(movedPath, 0o700)
  const moved = new BrowserRegistration({ ...f.options, nativeHostPath: movedPath })
  await writeFile(moved.transactionFile, '{"pending":"manual recovery required"}', { mode: 0o600 })
  const before = await readFile(moved.locatorFile, 'utf8')
  await expect(moved.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'not_eligible',
  )
  expect(await readFile(moved.transactionFile, 'utf8')).toBe(
    '{"pending":"manual recovery required"}',
  )
  expect(await readFile(moved.locatorFile, 'utf8')).toBe(before)
})

it('authorized Windows path repair retains the exact HKCU registration and never repairs a missing registry value', async () => {
  const f = await fixture('win32')
  const oldPath = path.join(f.dir, 'lumi-browser-native-host.exe')
  await writeFile(oldPath, 'old fixture')
  const old = new BrowserRegistration({ ...f.options, nativeHostPath: oldPath })
  await old.register(OFFICIAL_BROWSER_EXTENSION_ID, true)
  const movedPath = path.join(f.dir, 'moved', 'lumi-browser-native-host.exe')
  await mkdir(path.dirname(movedPath))
  await writeFile(movedPath, 'current fixture')
  const moved = new BrowserRegistration({ ...f.options, nativeHostPath: movedPath })
  expect((await moved.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).registered).toBe(true)
  expect(f.values.get('default')).toBe(moved.manifestPath)
  f.values.delete('default')
  await expect(moved.repairOwnedPath(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'not_eligible',
  )
  expect(f.values.has('default')).toBe(false)
})

it('reports a legacy owned identity even if its manifest was removed', async () => {
  const f = await fixture()
  await f.registration.register(id, true)
  await rm(f.registration.manifestPath)
  expect((await f.registration.status(OFFICIAL_BROWSER_EXTENSION_ID)).extensionId).toBe(id)
  await expect(f.registration.register(OFFICIAL_BROWSER_EXTENSION_ID, true)).rejects.toThrow(
    'migration_confirmation_required',
  )
})
