// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserUserActionRequest, BrowserUserStatus, BrowserPageRule } from '@lumiplug/shared'
import {
  OFFICIAL_BROWSER_EXTENSION_ID,
  BROWSER_SCOPE_CONSENT_VERSION,
  normalizeBrowserBlockedUrls,
  normalizeBrowserPageRules,
  browserBlockedUrlsFromRules,
} from '@lumiplug/shared'
import { BrowserService } from './service'

interface Preference {
  transport: 'loopback-websocket'
  enabled: boolean
  extensionId: string | null
  blockedUrls: string[]
  consentVersion: number
  pageRules: BrowserPageRule[]
  rulesRevision: number
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-p]{32}$/.test(value)

/** Host-only settings boundary; never exposed as an MCP tool. */
export class BrowserUserController {
  public readonly browser: BrowserService
  private readonly file: string
  private preference: Preference = {
    transport: 'loopback-websocket',
    enabled: false,
    extensionId: null,
    blockedUrls: [],
    consentVersion: 0,
    pageRules: [],
    rulesRevision: 0,
  }
  private issues: string[] = []
  private settingsValid = true
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  private activationGeneration = 0

  public constructor(
    options: { userDataDir: string },
    dependencies?: { browser?: BrowserService },
  ) {
    this.file = path.join(options.userDataDir, 'browser-user.json')
    this.browser = dependencies?.browser ?? new BrowserService({ userDataDir: options.userDataDir })
    try {
      const stat = fs.lstatSync(this.file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024)
        throw new Error('browser_settings_unsafe')
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Preference>
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.enabled !== 'boolean' ||
        (value.extensionId !== null && !validId(value.extensionId)) ||
        (value.enabled && !value.extensionId) ||
        (value.consentVersion !== undefined &&
          ![0, BROWSER_SCOPE_CONSENT_VERSION].includes(value.consentVersion)) ||
        (value.rulesRevision !== undefined &&
          (!Number.isSafeInteger(value.rulesRevision) || value.rulesRevision < 0))
      )
        throw new Error('browser_settings_invalid')
      const rules = normalizeBrowserPageRules(value.pageRules ?? [])
      // Preserve every legacy exclusion, even if an inconsistent allow row exists.
      for (const url of normalizeBrowserBlockedUrls(value.blockedUrls ?? [])) {
        const existing = rules.find((rule) => rule.url === url)
        if (existing) existing.permission = 'block'
        else rules.push({ url, label: '', permission: 'block' })
      }
      const pageRules = normalizeBrowserPageRules(rules)
      const currentTransport = value.transport === 'loopback-websocket'
      this.preference = {
        transport: 'loopback-websocket',
        // Native-host consent did not authorize opening a local network listener.
        enabled: currentTransport && value.enabled,
        extensionId: value.extensionId ?? null,
        consentVersion: currentTransport ? (value.consentVersion ?? 0) : 0,
        blockedUrls: browserBlockedUrlsFromRules(pageRules),
        pageRules,
        rulesRevision: value.rulesRevision ?? 0,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.settingsValid = false
        this.issues = ['browser_settings_invalid']
      }
    }
    this.browser.setPageRuleHandler((rule, guard) => this.applyExtensionRule(rule, guard))
  }

  private save(preference: Preference): void {
    if (!this.settingsValid) throw new Error('browser_settings_invalid')
    try {
      const existing = fs.lstatSync(this.file)
      if (!existing.isFile() || existing.isSymbolicLink())
        throw new Error('browser_settings_unsafe')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, JSON.stringify(preference) + '\n', { mode: 0o600, flag: 'wx' })
      fs.renameSync(temp, this.file)
      this.preference = preference
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
  }
  private commitPageRules(value: unknown): void {
    const pageRules = normalizeBrowserPageRules(value)
    if (JSON.stringify(pageRules) === JSON.stringify(this.preference.pageRules)) return
    if (this.preference.rulesRevision >= Number.MAX_SAFE_INTEGER)
      throw new Error('browser_rules_revision_exhausted')
    const blockedUrls = browserBlockedUrlsFromRules(pageRules)
    this.save({
      ...this.preference,
      pageRules,
      blockedUrls,
      rulesRevision: this.preference.rulesRevision + 1,
    })
    this.browser.setBlockedUrls(blockedUrls)
  }
  private applyExtensionRule(
    rule: BrowserPageRule,
    guard: () => void,
  ): Promise<{ rulesRevision: number }> {
    const operation = this.queue.then(() => {
      guard()
      if (
        this.closing ||
        !this.preference.enabled ||
        this.requiresAuthorization() ||
        !this.browser.status().enabled
      )
        throw new Error('browser_disabled')
      const checked = normalizeBrowserPageRules([rule])[0]!
      const existing = this.preference.pageRules.find((item) => item.url === checked.url)
      const rules = existing
        ? this.preference.pageRules.map((item) =>
            item.url === checked.url ? { ...item, permission: checked.permission } : item,
          )
        : [...this.preference.pageRules, checked]
      guard()
      this.commitPageRules(rules)
      return { rulesRevision: this.preference.rulesRevision }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  public restore(): Promise<void> {
    const generation = this.activationGeneration
    const operation = this.queue.then(async () => {
      if (
        this.closing ||
        generation !== this.activationGeneration ||
        !this.preference.enabled ||
        this.requiresAuthorization()
      )
        return
      try {
        await this.browser.start(OFFICIAL_BROWSER_EXTENSION_ID, this.preference.blockedUrls)
        if (this.closing || generation !== this.activationGeneration) {
          await this.browser.disable()
          return
        }
        this.issues = []
      } catch {
        await this.browser.disable().catch(() => {})
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
    return {
      ...this.browser.status(),
      extensionId: this.preference.extensionId,
      blockedUrls: [...this.preference.blockedUrls],
      pageRules: this.preference.pageRules.map((rule) => ({ ...rule })),
      rulesRevision: this.preference.rulesRevision,
      requiresAuthorization: this.requiresAuthorization(),
      issues: [...this.issues],
    }
  }
  private validate(request: BrowserUserActionRequest): void {
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.keys(request).some(
        (key) =>
          ![
            'action',
            'extensionId',
            'confirmed',
            'scopeConfirmed',
            'blockedUrls',
            'pageRules',
            'expectedRulesRevision',
          ].includes(key),
      ) ||
      !['enable', 'disable', 'diagnose', 'resetPairing', 'setBlockedUrls', 'setPageRules'].includes(
        request.action,
      )
    )
      throw new Error('browser_action_invalid')
    if (request.action !== 'diagnose' && request.confirmed !== true)
      throw new Error('browser_confirmation_required')
    if (
      (request.confirmed !== undefined && typeof request.confirmed !== 'boolean') ||
      (request.scopeConfirmed !== undefined &&
        (request.action !== 'enable' || typeof request.scopeConfirmed !== 'boolean')) ||
      (request.extensionId !== undefined && request.action !== 'enable') ||
      (request.blockedUrls !== undefined && request.action !== 'setBlockedUrls') ||
      (request.pageRules !== undefined && request.action !== 'setPageRules') ||
      (request.expectedRulesRevision !== undefined &&
        (!['setPageRules', 'setBlockedUrls'].includes(request.action) ||
          !Number.isSafeInteger(request.expectedRulesRevision) ||
          request.expectedRulesRevision < 0))
    )
      throw new Error('browser_action_invalid')
  }
  public action(request: BrowserUserActionRequest): Promise<BrowserUserStatus> {
    if (this.closing) return Promise.reject(new Error('browser_stopping'))
    try {
      this.validate(request)
    } catch (error) {
      return Promise.reject(error)
    }
    let stopping: Promise<void> | undefined
    if (request.action === 'disable' || request.action === 'resetPairing') {
      this.activationGeneration++
      // Stop immediately rather than waiting behind activation or approval.
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
    if (request.action === 'disable') {
      if (stopping) await stopping
      else await this.browser.disable()
      this.save({ ...this.preference, enabled: false })
      this.issues = []
      return this.status()
    }
    if (request.action === 'resetPairing') {
      if (stopping) await stopping
      this.assertActivation(generation)
      await this.browser.resetPairing()
      this.assertActivation(generation)
      this.save({ ...this.preference, enabled: false })
      this.issues = []
      return this.status()
    }
    this.assertActivation(generation)
    if (!this.settingsValid) throw new Error('browser_settings_invalid')
    if (request.action === 'setPageRules' || request.action === 'setBlockedUrls') {
      const expected = request.expectedRulesRevision
      if (
        (!Number.isSafeInteger(expected) || expected !== this.preference.rulesRevision) &&
        !(
          request.action === 'setBlockedUrls' &&
          expected === undefined &&
          this.preference.rulesRevision === 0
        )
      )
        throw new Error('browser_rules_conflict')
      if (request.action === 'setPageRules') this.commitPageRules(request.pageRules)
      else {
        const blocked = normalizeBrowserBlockedUrls(request.blockedUrls)
        const rules = this.preference.pageRules.map((rule) => ({
          ...rule,
          permission: blocked.includes(rule.url) ? ('block' as const) : ('allow' as const),
        }))
        for (const url of blocked)
          if (!rules.some((rule) => rule.url === url))
            rules.push({ url, label: '', permission: 'block' })
        this.commitPageRules(rules)
      }
      return this.status()
    }
    const id = request.extensionId ?? OFFICIAL_BROWSER_EXTENSION_ID
    if (!validId(id)) throw new Error('browser_extension_id_invalid')
    if (id !== OFFICIAL_BROWSER_EXTENSION_ID) throw new Error('browser_extension_id_not_official')
    if (this.requiresAuthorization() && request.scopeConfirmed !== true)
      throw new Error('browser_scope_confirmation_required')
    const next = {
      ...this.preference,
      enabled: true,
      extensionId: id,
      consentVersion: BROWSER_SCOPE_CONSENT_VERSION,
    }
    if (this.browser.status().enabled && this.preference.enabled && !this.requiresAuthorization()) {
      try {
        await this.browser.start(id, this.preference.blockedUrls, { enroll: true })
        this.assertActivation(generation)
      } catch (error) {
        await this.browser.disable()
        throw error
      }
      return this.status()
    }
    // Persist a disabled state before opening the listener. A failed start/save
    // cannot leave an unintended enabled preference or a reachable listener.
    this.save({ ...next, enabled: false })
    try {
      await this.browser.start(id, this.preference.blockedUrls, { enroll: true })
      this.assertActivation(generation)
      this.save(next)
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
