// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserUserActionRequest, BrowserUserStatus } from '@lumiplug/shared'
import {
  OFFICIAL_BROWSER_EXTENSION_ID,
  BROWSER_SCOPE_CONSENT_VERSION,
  normalizeBrowserBlockedUrls,
} from '@lumiplug/shared'
import { BrowserService } from './service'
import { BrowserRegistration } from './registration'

interface Preference {
  enabled: boolean
  extensionId: string | null
  autoRepair: boolean
  blockedUrls: string[]
  consentVersion: number
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-p]{32}$/.test(value)

/** Host-only settings boundary; never exposed as an MCP tool. */
export class BrowserUserController {
  public readonly browser: BrowserService
  private readonly registration: BrowserRegistration
  private readonly file: string
  private preference: Preference = {
    enabled: false,
    extensionId: null,
    autoRepair: false,
    blockedUrls: [],
    consentVersion: 0,
  }
  private issues: string[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  private activationGeneration = 0

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
        (value.autoRepair !== undefined && typeof value.autoRepair !== 'boolean') ||
        (value.consentVersion !== undefined &&
          ![0, BROWSER_SCOPE_CONSENT_VERSION].includes(value.consentVersion))
      )
        throw new Error('browser_settings_invalid')
      this.preference = {
        enabled: value.enabled,
        extensionId: value.extensionId,
        autoRepair: value.autoRepair === true,
        blockedUrls: normalizeBrowserBlockedUrls(value.blockedUrls ?? []),
        consentVersion: value.consentVersion ?? 0,
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
    const generation = this.activationGeneration
    const operation = this.queue.then(async () => {
      if (
        this.closing ||
        generation !== this.activationGeneration ||
        !this.preference.enabled ||
        !this.preference.extensionId
      )
        return
      const id = this.preference.extensionId
      if (id !== OFFICIAL_BROWSER_EXTENSION_ID) {
        this.issues = ['browser_migration_confirmation_required']
        return
      }
      if (this.requiresAuthorization()) {
        this.issues = ['browser_scope_confirmation_required']
        return
      }
      try {
        let registration = await this.registration.status(id)
        if (this.closing || generation !== this.activationGeneration) return
        if (!registration.registered && this.preference.autoRepair) {
          try {
            registration = await this.registration.repairOwnedPath(id, true)
          } catch {
            this.issues = ['browser_registration_repair_required']
            return
          }
        }
        if (this.closing || generation !== this.activationGeneration) return
        if (!registration.registered) {
          this.issues = ['browser_registration_repair_required']
          return
        }
        await this.browser.start(id, this.preference.blockedUrls)
        if (this.closing || generation !== this.activationGeneration) {
          await this.browser.disable()
          return
        }
        this.issues = []
      } catch {
        this.issues = ['browser_start_failed']
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  private requiresAuthorization(): boolean {
    return (
      this.preference.consentVersion !== BROWSER_SCOPE_CONSENT_VERSION ||
      this.preference.extensionId !== OFFICIAL_BROWSER_EXTENSION_ID
    )
  }

  public async status(): Promise<BrowserUserStatus> {
    const registration = await this.registration.status(this.preference.extensionId)
    const state = this.browser.status()
    const migrationRequired = [this.preference.extensionId, registration.extensionId].some(
      (id) => !!id && id !== OFFICIAL_BROWSER_EXTENSION_ID,
    )
    return {
      ...state,
      extensionId: this.preference.extensionId,
      registration,
      autoRepair: this.preference.autoRepair,
      migrationRequired,
      blockedUrls: [...this.preference.blockedUrls],
      requiresAuthorization: this.requiresAuthorization(),
      issues: [...this.issues],
    }
  }

  public action(request: BrowserUserActionRequest): Promise<BrowserUserStatus> {
    if (this.closing) return Promise.reject(new Error('browser_stopping'))
    // A confirmed close is a stop boundary, not an operation that waits behind
    // a slow registration/diagnostic request. Already-started registry writes may
    // finish, but the invalidated activation is never allowed to reopen inputs.
    let stopping: Promise<void> | undefined
    if (
      request.action === 'disable' &&
      request.confirmed === true &&
      request.autoRepair === undefined &&
      request.migrateConfirmed === undefined &&
      request.scopeConfirmed === undefined &&
      request.blockedUrls === undefined
    ) {
      this.activationGeneration++
      stopping = this.browser.disable()
      void stopping.catch(() => {})
      try {
        this.save({ ...this.preference, enabled: false })
      } catch {
        this.issues = ['browser_settings_write_failed']
      }
    }
    const generation = this.activationGeneration
    const result = this.queue.then(() => this.perform(request, generation, stopping))
    this.queue = result.catch(() => {})
    return result
  }

  private assertActivation(generation: number): void {
    if (this.closing || generation !== this.activationGeneration)
      throw new Error('browser_activation_cancelled')
  }

  private async perform(
    request: BrowserUserActionRequest,
    generation: number,
    stopping?: Promise<void>,
  ): Promise<BrowserUserStatus> {
    if (request.action === 'diagnose') return this.status()
    if (request.confirmed !== true) throw new Error('browser_confirmation_required')
    if (
      (request.autoRepair !== undefined && typeof request.autoRepair !== 'boolean') ||
      (request.migrateConfirmed !== undefined && typeof request.migrateConfirmed !== 'boolean') ||
      (request.scopeConfirmed !== undefined && typeof request.scopeConfirmed !== 'boolean')
    )
      throw new Error('browser_action_invalid')
    if (
      !['enable', 'repair'].includes(request.action) &&
      (request.autoRepair !== undefined || request.migrateConfirmed !== undefined)
    )
      throw new Error('browser_action_invalid')
    if (request.action !== 'enable' && request.scopeConfirmed !== undefined)
      throw new Error('browser_action_invalid')
    if (request.action !== 'setBlockedUrls' && request.blockedUrls !== undefined)
      throw new Error('browser_action_invalid')
    if (!['enable', 'disable', 'repair', 'remove', 'setBlockedUrls'].includes(request.action))
      throw new Error('browser_action_invalid')
    if (request.action === 'setBlockedUrls') {
      const blockedUrls = normalizeBrowserBlockedUrls(request.blockedUrls)
      this.save({ ...this.preference, blockedUrls })
      this.browser.setBlockedUrls(blockedUrls)
      return this.status()
    }
    if (request.action === 'disable' || request.action === 'remove') {
      if (stopping) await stopping
      else await this.browser.disable()
      this.save({ ...this.preference, enabled: false })
      if (request.action === 'remove') {
        await this.registration.remove(true)
        this.save({
          enabled: false,
          extensionId: null,
          autoRepair: false,
          blockedUrls: [],
          consentVersion: 0,
        })
      }
      this.issues = []
      return this.status()
    }
    this.assertActivation(generation)
    const id = request.extensionId ?? OFFICIAL_BROWSER_EXTENSION_ID
    if (!validId(id)) throw new Error('browser_extension_id_invalid')
    if (id !== OFFICIAL_BROWSER_EXTENSION_ID) throw new Error('browser_extension_id_not_official')
    if (
      request.action === 'enable' &&
      this.requiresAuthorization() &&
      request.scopeConfirmed !== true
    )
      throw new Error('browser_scope_confirmation_required')
    const registration = await this.registration.status(id)
    this.assertActivation(generation)
    const migrationRequired = [this.preference.extensionId, registration.extensionId].some(
      (existing) => !!existing && existing !== id,
    )
    if (migrationRequired && request.migrateConfirmed !== true)
      throw new Error('browser_migration_confirmation_required')
    const autoRepair =
      request.autoRepair ??
      (this.preference.extensionId === id ? this.preference.autoRepair : false)
    const enable =
      request.action === 'enable' || (this.preference.enabled && !this.requiresAuthorization())
    const consentVersion =
      request.action === 'enable' && request.scopeConfirmed === true
        ? BROWSER_SCOPE_CONSENT_VERSION
        : this.preference.consentVersion
    const nextPreference = {
      enabled: enable,
      extensionId: id,
      autoRepair,
      blockedUrls: this.preference.blockedUrls,
      consentVersion,
    }
    if (
      registration.registered &&
      this.preference.extensionId === id &&
      this.browser.status().enabled === enable
    ) {
      if (JSON.stringify(this.preference) !== JSON.stringify(nextPreference))
        this.save(nextPreference)
      this.issues = []
      return this.status()
    }
    await this.browser.disable()
    this.assertActivation(generation)
    this.save({ ...nextPreference, enabled: false })
    const written =
      request.migrateConfirmed === true
        ? await this.registration.register(id, true, { migrateConfirmed: true })
        : await this.registration.register(id, true)
    this.assertActivation(generation)
    if (!written.registered) {
      this.issues = ['browser_registration_repair_required']
      throw new Error('browser_registration_repair_required')
    }
    if (enable) await this.browser.start(id, this.preference.blockedUrls)
    if (this.closing || generation !== this.activationGeneration) {
      await this.browser.disable()
      throw new Error('browser_activation_cancelled')
    }
    try {
      this.save(nextPreference)
    } catch (error) {
      await this.browser.disable()
      throw error
    }
    this.issues = []
    return this.status()
  }

  public async close(): Promise<void> {
    this.closing = true
    this.activationGeneration++
    const stopping = this.browser.close()
    void stopping.catch(() => {})
    await this.queue.catch(() => {})
    await stopping
  }
}
