// SPDX-License-Identifier: MPL-2.0

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { access, chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const HOST = 'com.lumiplug.browser'
const KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`
const OWNER = 'Lumi browser integration v1'
interface Locator {
  version: 1
  owner: typeof OWNER
  extensionId: string
  executablePath: string
  runtimeFile: string
}
export interface BrowserRegistrationStatus {
  registered: boolean
  supported: boolean
  nativeHostPath: string
  manifestPath: string
  extensionId?: string
  repairRequired: boolean
  issues: string[]
}
interface Snapshot {
  locator: Record<string, unknown> | null
  manifest: Record<string, unknown> | null
  registry: string | null
}
interface Transaction {
  version: 1
  owner: typeof OWNER
  before: Snapshot
  after: Snapshot
}
interface Options {
  userDataDir: string
  nativeHostPath?: string
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  run?: (command: string, args: string[]) => Promise<string>
  beforeWrite?: (file: string) => Promise<void>
}
async function present(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function safeFile(file: string): Promise<void> {
  if (!(await present(file))) return
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
    throw new Error('browser_registration_file_unsafe')
}
async function json(file: string): Promise<Record<string, unknown>> {
  await safeFile(file)
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
}
async function safeDirectory(dir: string): Promise<void> {
  if (await present(dir)) {
    const stat = await lstat(dir)
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('browser_registration_directory_unsafe')
  }
}
async function atomic(file: string, value: unknown): Promise<void> {
  await safeFile(file)
  await safeDirectory(path.dirname(file))
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temp, file)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

/** Called only from the authenticated desktop-host route, never from an MCP tool. */
export class BrowserRegistration {
  readonly nativeHostPath: string
  readonly manifestPath: string
  readonly runtimeFile: string
  readonly locatorFile: string
  readonly transactionFile: string
  private readonly beforeWrite?: (file: string) => Promise<void>
  private readonly platform: NodeJS.Platform
  private readonly run: (command: string, args: string[]) => Promise<string>
  constructor(options: Options) {
    this.platform = options.platform ?? process.platform
    this.beforeWrite = options.beforeWrite
    const home = options.home ?? os.homedir()
    const env = options.env ?? process.env
    const extension = this.platform === 'win32' ? '.exe' : ''
    this.nativeHostPath = path.resolve(
      options.nativeHostPath ??
        path.join(path.dirname(process.execPath), `lumi-browser-native-host${extension}`),
    )
    this.runtimeFile = path.join(path.resolve(options.userDataDir), 'browser-user', 'runtime.json')
    const data =
      this.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Lumi')
        : path.join(env.LOCALAPPDATA ?? home, 'Lumi')
    this.locatorFile = path.join(data, 'browser-native.json')
    this.transactionFile = path.join(data, 'browser-native.transaction.json')
    this.manifestPath =
      this.platform === 'darwin'
        ? path.join(
            home,
            'Library',
            'Application Support',
            'Google',
            'Chrome',
            'NativeMessagingHosts',
            `${HOST}.json`,
          )
        : path.join(data, `${HOST}.json`)
    this.run =
      options.run ??
      (async (command, args) =>
        (await exec(command, args, { windowsHide: true, timeout: 10000, maxBuffer: 65536 })).stdout)
  }
  private supported(): boolean {
    return this.platform === 'darwin' || this.platform === 'win32'
  }
  private async registry(): Promise<string | undefined> {
    try {
      const value = await this.run('reg.exe', ['query', KEY, '/ve'])
      return /REG_SZ\s+([^\r\n]+)/.exec(value)?.[1]?.trim()
    } catch (error) {
      if ((error as { code?: unknown }).code === 1) return undefined
      throw error
    }
  }
  async status(extensionId?: string | null): Promise<BrowserRegistrationStatus> {
    const issues: string[] = []
    const result: BrowserRegistrationStatus = {
      registered: false,
      supported: this.supported(),
      nativeHostPath: this.nativeHostPath,
      manifestPath: this.manifestPath,
      repairRequired: false,
      issues,
    }
    if (!result.supported) {
      issues.push('browser_platform_unsupported')
      return result
    }
    try {
      await access(this.nativeHostPath, this.platform === 'win32' ? constants.F_OK : constants.X_OK)
      const executable = await lstat(this.nativeHostPath)
      if (!executable.isFile() || executable.isSymbolicLink())
        issues.push('browser_native_host_missing')
    } catch {
      issues.push('browser_native_host_missing')
    }
    try {
      const locator = await json(this.locatorFile)
      const manifest = await json(this.manifestPath)
      if (this.platform !== 'win32' && process.platform !== 'win32') {
        for (const file of [this.locatorFile, path.dirname(this.locatorFile)]) {
          const stat = await lstat(file)
          if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
            issues.push('browser_registration_permissions')
        }
      }
      result.extensionId = typeof locator.extensionId === 'string' ? locator.extensionId : undefined
      if (locator.owner !== OWNER || locator.version !== 1)
        issues.push('browser_registration_foreign')
      if (
        locator.executablePath !== this.nativeHostPath ||
        manifest.path !== this.nativeHostPath ||
        locator.runtimeFile !== this.runtimeFile
      )
        issues.push('browser_registration_path_changed')
      if (
        !/^[a-p]{32}$/.test(result.extensionId ?? '') ||
        (extensionId && extensionId !== result.extensionId) ||
        manifest.name !== HOST ||
        manifest.type !== 'stdio' ||
        JSON.stringify(manifest.allowed_origins) !==
          JSON.stringify([`chrome-extension://${result.extensionId}/`])
      )
        issues.push('browser_registration_origin_mismatch')
      if (this.platform === 'win32' && (await this.registry()) !== this.manifestPath)
        issues.push('browser_registry_missing_or_changed')
    } catch {
      issues.push('browser_registration_missing_or_invalid')
    }
    const pending = await present(this.transactionFile)
    if (pending) issues.push('browser_registration_recovery_required')
    result.registered = issues.length === 0
    result.repairRequired = pending || (!result.registered && (await present(this.locatorFile)))
    return result
  }
  private async owned(): Promise<Locator | undefined> {
    const locatorExists = await present(this.locatorFile)
    const manifestExists = await present(this.manifestPath)
    if (!locatorExists) {
      if (manifestExists || (this.platform === 'win32' && (await this.registry())))
        throw new Error('browser_registration_foreign')
      return undefined
    }
    const locator = await json(this.locatorFile)
    if (
      locator.owner !== OWNER ||
      locator.version !== 1 ||
      typeof locator.executablePath !== 'string' ||
      !/^[a-p]{32}$/.test(String(locator.extensionId))
    )
      throw new Error('browser_registration_foreign')
    if (manifestExists) {
      const manifest = await json(this.manifestPath)
      if (
        manifest.name !== HOST ||
        manifest.path !== locator.executablePath ||
        JSON.stringify(manifest.allowed_origins) !==
          JSON.stringify([`chrome-extension://${locator.extensionId}/`])
      )
        throw new Error('browser_registration_foreign')
    }
    if (this.platform === 'win32') {
      const registered = await this.registry()
      if (registered && registered !== this.manifestPath)
        throw new Error('browser_registration_foreign')
    }
    return locator as unknown as Locator
  }
  private async write(file: string, value: unknown): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(value, null, 2) + '\n') > 16384)
      throw new Error('browser_registration_snapshot_too_large')
    await this.beforeWrite?.(file)
    await atomic(file, value)
  }
  private async snapshot(): Promise<Snapshot> {
    return {
      locator: (await present(this.locatorFile)) ? await json(this.locatorFile) : null,
      manifest: (await present(this.manifestPath)) ? await json(this.manifestPath) : null,
      registry: this.platform === 'win32' ? ((await this.registry()) ?? null) : null,
    }
  }
  private validSnapshot(value: Snapshot): boolean {
    if (!value || typeof value !== 'object') return false
    if (value.registry !== null && value.registry !== this.manifestPath) return false
    if (value.locator === null) return value.manifest === null && value.registry === null
    const locator = value.locator
    if (
      !locator ||
      locator.owner !== OWNER ||
      locator.version !== 1 ||
      typeof locator.executablePath !== 'string' ||
      !path.isAbsolute(locator.executablePath) ||
      typeof locator.runtimeFile !== 'string' ||
      !path.isAbsolute(locator.runtimeFile) ||
      !/^[a-p]{32}$/.test(String(locator.extensionId))
    )
      return false
    const manifest = value.manifest
    return (
      manifest === null ||
      Boolean(
        manifest &&
        manifest.name === HOST &&
        manifest.path === locator.executablePath &&
        JSON.stringify(manifest.allowed_origins) ===
          JSON.stringify([`chrome-extension://${locator.extensionId}/`]),
      )
    )
  }
  /** Recover only exact before/after values saved by our transaction; third-party changes fail closed. */
  private async recover(): Promise<void> {
    if (!(await present(this.transactionFile))) return
    const journal = (await json(this.transactionFile)) as unknown as Transaction
    if (
      journal.version !== 1 ||
      journal.owner !== OWNER ||
      !this.validSnapshot(journal.before) ||
      !this.validSnapshot(journal.after)
    )
      throw new Error('browser_registration_foreign_transaction')
    const current = await this.snapshot()
    for (const key of ['locator', 'manifest', 'registry'] as const) {
      const actual = JSON.stringify(current[key])
      if (
        actual !== JSON.stringify(journal.before[key]) &&
        actual !== JSON.stringify(journal.after[key])
      )
        throw new Error('browser_registration_foreign_transaction')
    }
    for (const [key, file] of [
      ['manifest', this.manifestPath],
      ['locator', this.locatorFile],
    ] as const) {
      if (JSON.stringify(current[key]) === JSON.stringify(journal.before[key])) continue
      const previous = journal.before[key]
      if (previous === null) await unlink(file)
      else await this.write(file, previous)
    }
    if (this.platform === 'win32' && current.registry !== journal.before.registry) {
      if (journal.before.registry === null) await this.run('reg.exe', ['delete', KEY, '/ve', '/f'])
      else
        await this.run('reg.exe', [
          'add',
          KEY,
          '/ve',
          '/t',
          'REG_SZ',
          '/d',
          this.manifestPath,
          '/f',
        ])
    }
    await unlink(this.transactionFile)
  }
  async register(extensionId: string, confirmed: boolean): Promise<BrowserRegistrationStatus> {
    if (confirmed !== true) throw new Error('browser_registration_confirmation_required')
    if (!this.supported()) throw new Error('browser_platform_unsupported')
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('browser_extension_id_invalid')
    await access(this.nativeHostPath, this.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const executable = await lstat(this.nativeHostPath)
    if (!executable.isFile() || executable.isSymbolicLink())
      throw new Error('browser_native_host_missing')
    await this.recover()
    await this.owned()
    await safeDirectory(path.dirname(this.locatorFile))
    await mkdir(path.dirname(this.locatorFile), { recursive: true, mode: 0o700 })
    if (this.platform !== 'win32') await chmod(path.dirname(this.locatorFile), 0o700)
    const before = await this.snapshot()
    if (!this.validSnapshot(before)) throw new Error('browser_registration_foreign')
    const after: Snapshot = {
      locator: {
        version: 1,
        owner: OWNER,
        extensionId,
        executablePath: this.nativeHostPath,
        runtimeFile: this.runtimeFile,
      },
      manifest: {
        name: HOST,
        description: 'Lumi browser native host',
        path: this.nativeHostPath,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      registry: this.platform === 'win32' ? this.manifestPath : null,
    }
    await this.write(this.transactionFile, { version: 1, owner: OWNER, before, after })
    try {
      await this.write(this.locatorFile, after.locator)
      await this.write(this.manifestPath, after.manifest)
      if (this.platform === 'win32')
        await this.run('reg.exe', [
          'add',
          KEY,
          '/ve',
          '/t',
          'REG_SZ',
          '/d',
          this.manifestPath,
          '/f',
        ])
      await unlink(this.transactionFile)
    } catch {
      try {
        await this.recover()
      } catch {
        throw new Error('browser_registration_recovery_required')
      }
      throw new Error('browser_registration_write_failed')
    }
    return this.status(extensionId)
  }
  async remove(confirmed: boolean): Promise<BrowserRegistrationStatus> {
    if (confirmed !== true) throw new Error('browser_registration_confirmation_required')
    if (!this.supported()) throw new Error('browser_platform_unsupported')
    await this.recover()
    const owner = await this.owned()
    if (!owner) return this.status()
    if (this.platform === 'win32' && (await this.registry()))
      await this.run('reg.exe', ['delete', KEY, '/ve', '/f'])
    // Delete only our exact registration files, never binaries, directories, runtime or unrelated registry values.
    await unlink(this.manifestPath).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e
    })
    await unlink(this.locatorFile)
    return this.status()
  }
}
