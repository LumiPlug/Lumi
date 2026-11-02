// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPageRule, BrowserUserActionRequest } from '@lumiplug/shared'
import { OFFICIAL_BROWSER_EXTENSION_ID as officialId } from '@lumiplug/shared'
import { BrowserUserController } from './controller'
import type { BrowserService, BrowserPageRuleHandler } from './service'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture(preference?: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-browser-controller-'))
  roots.push(root)
  const file = path.join(root, 'browser-user.json')
  if (preference !== undefined) fs.writeFileSync(file, JSON.stringify(preference))
  let enabled = false,
    extensionId: string | null = null,
    paired = false
  let handler: BrowserPageRuleHandler | undefined
  const browser = {
    status: () => ({
      enabled,
      extensionId,
      connectedHosts: 0,
      sessions: [],
      controlDomain: 'shared-lumi' as const,
      blockedUrls: [],
      policyEpoch: 1,
      transport: 'loopback-websocket' as const,
      endpoint: 'ws://127.0.0.1:43127/ws',
      paired,
      pairing: null,
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
    approvePairing: vi.fn(async () => {
      paired = true
    }),
    resetPairing: vi.fn(async () => {
      paired = false
    }),
    setBlockedUrls: vi.fn(),
    setPageRuleHandler: vi.fn((value: BrowserPageRuleHandler) => {
      handler = value
    }),
  }
  const dependencies = { browser: browser as unknown as BrowserService }
  const controller = new BrowserUserController({ userDataDir: root }, dependencies)
  return {
    root,
    file,
    browser,
    controller,
    dependencies,
    popup: (rule: BrowserPageRule, guard = () => {}) => handler!(rule, guard),
  }
}
const enable: BrowserUserActionRequest = { action: 'enable', confirmed: true, scopeConfirmed: true }
const rule = (
  url = 'https://example.com/private',
  permission: 'block' | 'allow' = 'block',
  label = 'Private',
): BrowserPageRule => ({ url, permission, label })
const stored = (overrides: Record<string, unknown> = {}) => ({
  transport: 'loopback-websocket',
  enabled: true,
  extensionId: officialId,
  consentVersion: 2,
  blockedUrls: [],
  pageRules: [],
  rulesRevision: 0,
  ...overrides,
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Browser User controller direct Core transport consent and lifecycle', () => {
  it('defaults off; reading status and diagnose never starts a listener or creates preferences', async () => {
    const f = fixture()
    expect((await f.controller.status()).enabled).toBe(false)
    await f.controller.action({ action: 'diagnose' })
    await f.controller.restore()
    expect(f.browser.start).not.toHaveBeenCalled()
    expect(fs.existsSync(f.file)).toBe(false)
    await expect(f.controller.action({ action: 'enable' })).rejects.toThrow('confirmation_required')
    await expect(f.controller.action({ action: 'enable', confirmed: true })).rejects.toThrow(
      'scope_confirmation_required',
    )
  })
  it('enables only the official extension and stores WS consent; repeated connection is idempotent', async () => {
    const f = fixture()
    expect((await f.controller.action(enable)).enabled).toBe(true)
    expect(f.browser.start).toHaveBeenCalledWith(officialId, [])
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8'))).toEqual(stored())
    await f.controller.action({ action: 'enable', confirmed: true })
    expect(f.browser.start).toHaveBeenCalledTimes(1)
    await expect(f.controller.action({ ...enable, extensionId: 'a'.repeat(32) })).rejects.toThrow(
      'not_official',
    )
    await f.controller.action({ action: 'disable', confirmed: true })
    expect((await f.controller.status()).enabled).toBe(false)
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).enabled).toBe(false)
    await f.controller.action({ action: 'enable', confirmed: true })
    expect(f.browser.start).toHaveBeenCalledTimes(2)
  })
  it('does not restore old Native Messaging consent as permission to listen on the network', async () => {
    const f = fixture({
      enabled: true,
      extensionId: officialId,
      autoRepair: true,
      consentVersion: 2,
      blockedUrls: ['https://example.com/private?q=x'],
      rulesRevision: 7,
    })
    await f.controller.restore()
    const status = await f.controller.status()
    expect(status.enabled).toBe(false)
    expect(status.requiresAuthorization).toBe(true)
    expect(status.pageRules).toEqual([rule('https://example.com/private', 'block', '')])
    expect(status.rulesRevision).toBe(7)
    expect(f.browser.start).not.toHaveBeenCalled()
    await expect(f.controller.action({ action: 'enable', confirmed: true })).rejects.toThrow(
      'scope_confirmation_required',
    )
    await f.controller.action(enable)
    expect(f.browser.start).toHaveBeenCalledWith(officialId, ['https://example.com/private'])
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).transport).toBe('loopback-websocket')
  })
  it('restores only current transport, current scope and official identity', async () => {
    const valid = fixture(stored())
    await valid.controller.restore()
    expect(valid.browser.start).toHaveBeenCalledOnce()
    for (const overrides of [
      { enabled: false },
      { consentVersion: 0 },
      { extensionId: 'a'.repeat(32) },
    ]) {
      const f = fixture(stored(overrides))
      await f.controller.restore()
      expect(f.browser.start).not.toHaveBeenCalled()
    }
  })
  it('fails closed if restoration opens partially and then fails', async () => {
    const f = fixture(stored())
    const original = f.browser.start.getMockImplementation()!
    f.browser.start.mockImplementationOnce(async (id) => {
      await original(id)
      throw new Error('startup interrupted')
    })
    await f.controller.restore()
    expect((await f.controller.status()).enabled).toBe(false)
    expect((await f.controller.status()).issues).toContain('browser_start_failed')
    expect(f.browser.disable).toHaveBeenCalledOnce()
  })
  it('rejects obsolete native registration fields and unrelated action fields before effects', async () => {
    const f = fixture()
    const invalid = [
      { ...enable, autoRepair: true },
      { ...enable, migrateConfirmed: true },
      { action: 'repair', confirmed: true },
      { action: 'remove', confirmed: true },
      { action: 'diagnose', pageRules: [] },
      { action: 'disable', confirmed: true, extensionId: officialId },
    ]
    for (const request of invalid)
      await expect(f.controller.action(request as BrowserUserActionRequest)).rejects.toThrow(
        'action_invalid',
      )
    expect(f.browser.start).not.toHaveBeenCalled()
    expect(f.browser.disable).not.toHaveBeenCalled()
    expect(fs.existsSync(f.file)).toBe(false)
  })
  it('stops immediately during a pending activation and never allows its late completion to reopen', async () => {
    const f = fixture(),
      waiting = deferred(),
      entered = deferred()
    const original = f.browser.start.getMockImplementation()!
    f.browser.start.mockImplementationOnce(async (id) => {
      entered.resolve()
      await waiting.promise
      await original(id)
    })
    const activating = f.controller.action(enable)
    const rejected = expect(activating).rejects.toThrow('activation_cancelled')
    await entered.promise
    const stopping = f.controller.action({ action: 'disable', confirmed: true })
    expect(f.browser.disable).toHaveBeenCalledOnce()
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).enabled).toBe(false)
    waiting.resolve()
    await rejected
    await stopping
    expect((await f.controller.status()).enabled).toBe(false)
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).enabled).toBe(false)
  })
  it('stops a pending restore and close prevents future actions', async () => {
    const f = fixture(stored()),
      waiting = deferred(),
      entered = deferred()
    const original = f.browser.start.getMockImplementation()!
    f.browser.start.mockImplementationOnce(async (id) => {
      entered.resolve()
      await waiting.promise
      await original(id)
    })
    const restoring = f.controller.restore()
    await entered.promise
    const stopping = f.controller.action({ action: 'disable', confirmed: true })
    waiting.resolve()
    await restoring
    await stopping
    expect((await f.controller.status()).enabled).toBe(false)
    await f.controller.close()
    await expect(f.controller.action(enable)).rejects.toThrow('stopping')
  })
  it('does not keep a listener or enabled preference after start or preference-save failure', async () => {
    const f = fixture()
    f.browser.start.mockRejectedValueOnce(new Error('port occupied'))
    await expect(f.controller.action(enable)).rejects.toThrow('port occupied')
    expect((await f.controller.status()).enabled).toBe(false)
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).enabled).toBe(false)
    const rename = fs.renameSync
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      const value = JSON.parse(fs.readFileSync(from, 'utf8'))
      if (value.enabled) throw new Error('disk full')
      return rename(from, to)
    })
    await expect(f.controller.action(enable)).rejects.toThrow('disk full')
    expect((await f.controller.status()).enabled).toBe(false)
    spy.mockRestore()
  })
  it('preserves corrupt configuration rather than replacing rules or authorizing a listener', async () => {
    const f = fixture({ enabled: true, extensionId: officialId, blockedUrls: ['file:///private'] })
    const before = fs.readFileSync(f.file, 'utf8')
    expect((await f.controller.status()).issues).toContain('browser_settings_invalid')
    await expect(f.controller.action(enable)).rejects.toThrow('settings_invalid')
    await expect(f.controller.action({ action: 'disable', confirmed: true })).rejects.toThrow(
      'settings_invalid',
    )
    expect(f.browser.disable).toHaveBeenCalled()
    expect(f.browser.start).not.toHaveBeenCalled()
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before)
  })
})

describe('Browser User explicit candidate approval', () => {
  it('requires enabled scope and exact id/code, forwarding only the clicked candidate', async () => {
    const f = fixture(),
      approval: BrowserUserActionRequest = {
        action: 'approvePairing',
        confirmed: true,
        pairingId: 'candidate-a',
        pairingCode: '012345',
      }
    await expect(f.controller.action(approval)).rejects.toThrow('disabled')
    await f.controller.action(enable)
    await f.controller.action(approval)
    expect(f.browser.approvePairing).toHaveBeenCalledWith('candidate-a', '012345')
    expect((await f.controller.status()).paired).toBe(true)
    await expect(f.controller.action({ ...approval, confirmed: false })).rejects.toThrow(
      'confirmation_required',
    )
    await expect(f.controller.action({ ...approval, pairingCode: '12345' })).rejects.toThrow(
      'pairing_invalid',
    )
  })
  it('resets only on explicit host confirmation, revokes pairing and remains off until reconnect', async () => {
    const f = fixture()
    await f.controller.action(enable)
    await f.controller.action({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 0,
      pageRules: [rule()],
    })
    await f.controller.action({
      action: 'approvePairing',
      confirmed: true,
      pairingId: 'a',
      pairingCode: '123456',
    })
    await expect(f.controller.action({ action: 'resetPairing' })).rejects.toThrow(
      'confirmation_required',
    )
    expect(f.browser.resetPairing).not.toHaveBeenCalled()
    const state = await f.controller.action({ action: 'resetPairing', confirmed: true })
    expect(state.pageRules).toEqual([rule()])
    expect(state.rulesRevision).toBe(1)
    expect(state.paired).toBe(false)
    expect(state.enabled).toBe(false)
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).enabled).toBe(false)
    expect(f.browser.resetPairing).toHaveBeenCalledOnce()
    await f.controller.action({ action: 'enable', confirmed: true })
    expect((await f.controller.status()).paired).toBe(false)
    expect(f.browser.approvePairing).toHaveBeenCalledTimes(1)
  })
  it('does not retry a rejected candidate or transfer approval to a later one', async () => {
    const f = fixture()
    await f.controller.action(enable)
    f.browser.approvePairing.mockRejectedValueOnce(new Error('browser_pairing_expired'))
    await expect(
      f.controller.action({
        action: 'approvePairing',
        confirmed: true,
        pairingId: 'expired',
        pairingCode: '123456',
      }),
    ).rejects.toThrow('pairing_expired')
    expect(f.browser.approvePairing).toHaveBeenCalledTimes(1)
    expect((await f.controller.status()).paired).toBe(false)
  })
  it('invalidates pending approval when disconnect is requested', async () => {
    const f = fixture()
    await f.controller.action(enable)
    const waiting = deferred(),
      entered = deferred()
    f.browser.approvePairing.mockImplementationOnce(async () => {
      entered.resolve()
      await waiting.promise
    })
    const approving = f.controller.action({
      action: 'approvePairing',
      confirmed: true,
      pairingId: 'a',
      pairingCode: '123456',
    })
    const rejected = expect(approving).rejects.toThrow('activation_cancelled')
    await entered.promise
    const stop = f.controller.action({ action: 'disable', confirmed: true })
    expect((await f.controller.status()).enabled).toBe(false)
    waiting.resolve()
    await rejected
    await stop
  })
})

describe('Browser User persistent rules and cross-window compare-and-swap', () => {
  it('normalizes rules, preserves labels and rejects duplicate canonical links', async () => {
    const f = fixture()
    await f.controller.action({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 0,
      pageRules: [rule('https://EXAMPLE.com/private?x=1#h')],
    })
    expect((await f.controller.status()).pageRules).toEqual([rule()])
    expect((await f.controller.status()).rulesRevision).toBe(1)
    expect(f.browser.setBlockedUrls).toHaveBeenCalledWith(['https://example.com/private'])
    await expect(
      f.controller.action({
        action: 'setPageRules',
        confirmed: true,
        expectedRulesRevision: 1,
        pageRules: [rule(), rule('https://example.com/private?q=2', 'allow')],
      }),
    ).rejects.toThrow('page_rules_invalid')
    expect((await f.controller.status()).rulesRevision).toBe(1)
  })
  it('rejects stale full-table revisions across restart, including label-only edits', async () => {
    const f = fixture()
    await f.controller.action({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 0,
      pageRules: [rule()],
    })
    await f.controller.action({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 1,
      pageRules: [rule(undefined, 'block', 'Renamed')],
    })
    const reopened = new BrowserUserController({ userDataDir: f.root }, f.dependencies)
    expect((await reopened.status()).rulesRevision).toBe(2)
    await expect(
      reopened.action({
        action: 'setPageRules',
        confirmed: true,
        expectedRulesRevision: 1,
        pageRules: [],
      }),
    ).rejects.toThrow('rules_conflict')
    expect((await reopened.status()).pageRules[0]?.label).toBe('Renamed')
  })
  it('keeps old policy and revision when disk commit fails', async () => {
    const f = fixture()
    await f.controller.action({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 0,
      pageRules: [rule()],
    })
    const before = fs.readFileSync(f.file, 'utf8')
    f.browser.setBlockedUrls.mockClear()
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await expect(
      f.controller.action({
        action: 'setPageRules',
        confirmed: true,
        expectedRulesRevision: 1,
        pageRules: [],
      }),
    ).rejects.toThrow('disk full')
    expect((await f.controller.status()).blockedUrls).toEqual([rule().url])
    expect((await f.controller.status()).rulesRevision).toBe(1)
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before)
    expect(f.browser.setBlockedUrls).not.toHaveBeenCalled()
  })
  it('allows only initial legacy list writes without revision and preserves unrelated allow labels', async () => {
    const f = fixture()
    await f.controller.action({
      action: 'setBlockedUrls',
      confirmed: true,
      blockedUrls: [rule().url],
    })
    await expect(
      f.controller.action({ action: 'setBlockedUrls', confirmed: true, blockedUrls: [] }),
    ).rejects.toThrow('rules_conflict')
    await f.controller.action({
      action: 'setBlockedUrls',
      confirmed: true,
      expectedRulesRevision: 1,
      blockedUrls: [],
    })
    expect((await f.controller.status()).pageRules).toEqual([rule(undefined, 'allow', '')])
  })
  it('applies guarded extension current-page edits without overriding stored labels or other rules', async () => {
    const f = fixture()
    await f.controller.action(enable)
    await f.controller.action({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 0,
      pageRules: [rule(), rule('https://other.test/', 'allow', 'Other')],
    })
    const guard = vi.fn()
    await f.popup(rule(undefined, 'allow', 'Untrusted replacement title'), guard)
    expect(guard).toHaveBeenCalledTimes(2)
    const status = await f.controller.status()
    expect(status.pageRules).toEqual([
      rule(undefined, 'allow'),
      rule('https://other.test/', 'allow', 'Other'),
    ])
    expect(status.rulesRevision).toBe(2)
    await expect(
      f.popup(rule('https://new.test/'), () => {
        throw new Error('stale page')
      }),
    ).rejects.toThrow('stale page')
    await f.controller.action({ action: 'disable', confirmed: true })
    await expect(f.popup(rule('https://new.test/'))).rejects.toThrow('disabled')
    expect((await f.controller.status()).rulesRevision).toBe(2)
  })
})
