// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserUserActionRequest, BrowserUserStatus } from '@lumiplug/shared'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
import { BrowserService } from './service'
import { BrowserRegistration } from './registration'

interface Preference {
  enabled: boolean
  extensionId: string | null
  autoRepair: boolean
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-p]{32}$/.test(value)

/** Host-only settings boundary; never exposed as an MCP tool. */
export class BrowserUserController {
  public readonly browser: BrowserService
  private readonly registration: BrowserRegistration
  private readonly file: string
  private preference: Preference = { enabled: false, extensionId: null, autoRepair: false }
  private issues: string[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false

  public constructor(
    options: { userDataDir: string; nativeHostPath?: string },
    dependencies?: {
      browser?: BrowserService
      registration?: BrowserRegistration
    },
  ) {
    this.file = path.join(options.userDataDir, 'browser-user.json')
    this.browser = dependencies?.browser ?? new BrowserService({ userDataDir: options.userDataDir })
    this.registration = dependencies?.registration ?? new BrowserRegistration(options)
    try {
      const stat = fs.lstatSync(this.file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('browser_settings_unsafe')
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Preference
      if (
        typeof value.enabled !== 'boolean' ||
        (value.extensionId !== null && !validId(value.extensionId)) ||
        (value.enabled && !value.extensionId) ||
        (value.autoRepair !== undefined && typeof value.autoRepair !== 'boolean')
      )
        throw new Error('browser_settings_invalid')
      this.preference = {
        enabled: value.enabled,
        extensionId: value.extensionId,
        autoRepair: value.autoRepair === true,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.issues = ['browser_settings_invalid']
    }
  }

  private save(preference: Preference): void {
    if (fs.existsSync(this.file) && fs.lstatSync(this.file).isSymbolicLink())
      throw new Error('browser_settings_unsafe')
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, JSON.stringify(preference) + '\n', { mode: 0o600, flag: 'wx' })
      fs.renameSync(temp, this.file)
      this.preference = preference
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
  }

  public restore(): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closing || !this.preference.enabled || !this.preference.extensionId) return
      const id = this.preference.extensionId
      if (id !== OFFICIAL_BROWSER_EXTENSION_ID) {
        this.issues = ['browser_migration_confirmation_required']
        return
      }
      try {
        let registration = await this.registration.status(id)
        if (this.closing) return
        if (!registration.registered && this.preference.autoRepair) {
          try {
            registration = await this.registration.repairOwnedPath(id, true)
          } catch {
            this.issues = ['browser_registration_repair_required']
            return
          }
        }
        if (this.closing) return
        if (!registration.registered) {
          this.issues = ['browser_registration_repair_required']
          return
        }
        await this.browser.start(id)
        this.issues = []
      } catch {
        this.issues = ['browser_start_failed']
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  public async status(): Promise<BrowserUserStatus> {
    const state = this.browser.status()
    const registration = await this.registration.status(this.preference.extensionId)
    const migrationRequired = [this.preference.extensionId, registration.extensionId].some(
      (id) => !!id && id !== OFFICIAL_BROWSER_EXTENSION_ID,
    )
    return {
      ...state,
      extensionId: this.preference.extensionId,
      registration,
      autoRepair: this.preference.autoRepair,
      migrationRequired,
      issues: [...this.issues],
    }
  }

  public action(request: BrowserUserActionRequest): Promise<BrowserUserStatus> {
    if (this.closing) return Promise.reject(new Error('browser_stopping'))
    const result = this.queue.then(() => this.perform(request))
    this.queue = result.catch(() => {})
    return result
  }

  private async perform(request: BrowserUserActionRequest): Promise<BrowserUserStatus> {
    if (request.action === 'diagnose') return this.status()
    if (request.confirmed !== true) throw new Error('browser_confirmation_required')
    if (
      (request.autoRepair !== undefined && typeof request.autoRepair !== 'boolean') ||
      (request.migrateConfirmed !== undefined && typeof request.migrateConfirmed !== 'boolean')
    )
      throw new Error('browser_action_invalid')
    if (
      !['enable', 'repair'].includes(request.action) &&
      (request.autoRepair !== undefined || request.migrateConfirmed !== undefined)
    )
      throw new Error('browser_action_invalid')
    if (!['enable', 'disable', 'repair', 'remove'].includes(request.action))
      throw new Error('browser_action_invalid')
    if (request.action === 'disable' || request.action === 'remove') {
      await this.browser.disable()
      this.save({ ...this.preference, enabled: false })
      if (request.action === 'remove') {
        await this.registration.remove(true)
        this.save({ enabled: false, extensionId: null, autoRepair: false })
      }
      this.issues = []
      return this.status()
    }
    const id = request.extensionId ?? OFFICIAL_BROWSER_EXTENSION_ID
    if (!validId(id)) throw new Error('browser_extension_id_invalid')
    if (id !== OFFICIAL_BROWSER_EXTENSION_ID) throw new Error('browser_extension_id_not_official')
    const registration = await this.registration.status(id)
    const migrationRequired = [this.preference.extensionId, registration.extensionId].some(
      (existing) => !!existing && existing !== id,
    )
    if (migrationRequired && request.migrateConfirmed !== true)
      throw new Error('browser_migration_confirmation_required')
    const autoRepair =
      request.autoRepair ??
      (this.preference.extensionId === id ? this.preference.autoRepair : false)
    const enable = request.action === 'enable' || this.preference.enabled
    if (
      registration.registered &&
      this.preference.extensionId === id &&
      this.browser.status().enabled === enable
    ) {
      if (this.preference.autoRepair !== autoRepair || this.preference.enabled !== enable)
        this.save({ enabled: enable, extensionId: id, autoRepair })
      this.issues = []
      return this.status()
    }
    await this.browser.disable()
    this.save({ enabled: false, extensionId: id, autoRepair })
    const written =
      request.migrateConfirmed === true
        ? await this.registration.register(id, true, { migrateConfirmed: true })
        : await this.registration.register(id, true)
    if (!written.registered) {
      this.issues = ['browser_registration_repair_required']
      throw new Error('browser_registration_repair_required')
    }
    if (enable) await this.browser.start(id)
    try {
      this.save({ enabled: enable, extensionId: id, autoRepair })
    } catch (error) {
      await this.browser.disable()
      throw error
    }
    this.issues = []
    return this.status()
  }

  public async close(): Promise<void> {
    this.closing = true
    await this.queue.catch(() => {})
    await this.browser.close()
  }
}
