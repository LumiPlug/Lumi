// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
import type { BrowserUserStatus, UiCoreStatus } from '@lumiplug/shared'
import BrowserUserSetting, {
  BrowserUserSummary,
  BrowserUserPrimaryActions,
} from '../components/BrowserUserSetting'
import { applyLocale } from '../i18n'
import { hostInvoke } from './tauri'
import {
  browserUserRequest,
  browserUserErrorHint,
  browserUserStateLabel,
  browserUserNeedsConsent,
  browserUserCanResetPairing,
  getBrowserUserStatus,
  performBrowserUserAction,
  validBrowserExtensionId,
} from './browser-user'
vi.mock('./tauri', () => ({ hostInvoke: vi.fn() }))
vi.mock('../components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastViewport: () => {},
}))
const id = OFFICIAL_BROWSER_EXTENSION_ID
const baseline = (): BrowserUserStatus => ({
  enabled: false,
  requiresAuthorization: false,
  blockedUrls: [],
  pageRules: [],
  rulesRevision: 0,
  extensionId: null,
  connectedHosts: 0,
  sessions: [],
  controlDomain: 'shared-lumi',
  transport: 'loopback-websocket',
  endpoint: 'ws://127.0.0.1:43127/ws',
  paired: false,
  pairing: null,
  issues: [],
})
const disconnected: UiCoreStatus = {
  state: 'disconnected',
  protocolVersion: 1,
  coreVersion: null,
  userDataPathAvailable: false,
  restartCount: 0,
  lastError: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  applyLocale('zh-CN')
})
afterEach(() => applyLocale('zh-CN'))
describe('Browser User settings safety and presentation', () => {
  it('has no mount-time mutation and keeps Core disconnection visible', () => {
    const html = renderToStaticMarkup(<BrowserUserSetting coreStatus={disconnected} />)
    expect(html).toContain('Browser User</h2>')
    expect(html).toContain('Core 未连接')
    expect(html).toContain('管理浏览器连接')
    expect(hostInvoke).not.toHaveBeenCalled()
  })
  it('fixes the official identity without accepting a developer ID', () => {
    expect(validBrowserExtensionId(id)).toBe(true)
    expect(validBrowserExtensionId('A'.repeat(32))).toBe(false)
    expect(browserUserRequest('enable', undefined, true)).toEqual({
      action: 'enable',
      extensionId: id,
      confirmed: true,
    })
    expect(() => browserUserRequest('enable', 'a'.repeat(32), true)).toThrow('not_official')
  })
  it('requires host confirmation for every mutation but not read-only status or diagnose', async () => {
    for (const action of [
      'enable',
      'disable',
      'setPageRules',
      'setBlockedUrls',
      'approvePairing',
      'resetPairing',
    ] as const)
      expect(() => browserUserRequest(action)).toThrow('confirmation_required')
    vi.mocked(hostInvoke).mockResolvedValue(baseline())
    await getBrowserUserStatus()
    await performBrowserUserAction(browserUserRequest('diagnose'))
    expect(hostInvoke).toHaveBeenNthCalledWith(1, 'browser_user_request', {
      action: 'status',
      payload: {},
    })
    expect(hostInvoke).toHaveBeenNthCalledWith(2, 'browser_user_request', {
      action: 'diagnose',
      payload: {},
    })
  })
  it('requests new scope only with explicit consent, never synthesizing it for reconnect', async () => {
    const status = baseline()
    status.requiresAuthorization = true
    expect(browserUserNeedsConsent(status)).toBe(true)
    expect(browserUserRequest('enable', undefined, true)).not.toHaveProperty('scopeConfirmed')
    expect(browserUserRequest('enable', undefined, true, { scopeConfirmed: true })).toHaveProperty(
      'scopeConfirmed',
      true,
    )
    expect(() => browserUserRequest('disable', undefined, true, { scopeConfirmed: true })).toThrow()
    status.requiresAuthorization = false
    expect(browserUserNeedsConsent(status)).toBe(false)
  })
  it('offers pairing reset only as disconnected recovery and sends no implicit approval or scope', async () => {
    const status = baseline()
    expect(browserUserCanResetPairing(status)).toBe(false)
    expect(browserUserCanResetPairing(null, true)).toBe(false)
    status.paired = true
    expect(browserUserCanResetPairing(status)).toBe(true)
    status.connectedHosts = 1
    expect(browserUserCanResetPairing(status, true)).toBe(false)
    status.connectedHosts = 0
    status.paired = false
    expect(browserUserCanResetPairing(status, true)).toBe(true)
    vi.mocked(hostInvoke).mockResolvedValue(status)
    await performBrowserUserAction(browserUserRequest('resetPairing', undefined, true))
    expect(hostInvoke).toHaveBeenCalledWith('browser_user_request', {
      action: 'resetPairing',
      payload: { confirmed: true },
    })
    expect(() => browserUserRequest('resetPairing', undefined, false)).toThrow(
      'confirmation_required',
    )
  })
  it('binds explicit pairing approval to the exact displayed id and six-digit code', async () => {
    vi.mocked(hostInvoke).mockResolvedValue(baseline())
    await performBrowserUserAction(
      browserUserRequest('approvePairing', undefined, true, {
        pairingId: 'exact-socket',
        pairingCode: '012345',
      }),
    )
    expect(hostInvoke).toHaveBeenCalledWith('browser_user_request', {
      action: 'approvePairing',
      payload: { confirmed: true, pairingId: 'exact-socket', pairingCode: '012345' },
    })
    for (const pairingCode of ['', '12345', '1234567', 'abcdef'])
      expect(() =>
        browserUserRequest('approvePairing', undefined, true, { pairingId: 'socket', pairingCode }),
      ).toThrow()
    expect(() =>
      browserUserRequest('enable', undefined, true, { pairingId: 'socket', pairingCode: '123456' }),
    ).toThrow()
    expect(() =>
      browserUserRequest('approvePairing', undefined, false, {
        pairingId: 'socket',
        pairingCode: '123456',
      }),
    ).toThrow('confirmation_required')
  })
  it('distinguishes enabled/connecting from actual connected pages and pairing', () => {
    const status = baseline()
    expect(browserUserStateLabel(null, true)).toContain('未知')
    expect(browserUserStateLabel(status, true)).toContain('停用')
    status.enabled = true
    expect(browserUserStateLabel(status, true)).toContain('连接中')
    status.pairing = {
      id: 's',
      code: '123456',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }
    expect(browserUserStateLabel(status, true)).toContain('配对码')
    status.pairing = null
    status.connectedHosts = 1
    expect(browserUserStateLabel(status, true)).toContain('等待可用网页')
    status.sessions = [
      {
        id: 's',
        tabId: 1,
        title: 'test',
        url: 'https://example.com/',
        origin: 'https://example.com',
        state: 'active',
      },
    ]
    expect(browserUserStateLabel(status, true)).toBe('已有可控网页')
    expect(browserUserStateLabel(status, false)).toBe('Core 未连接')
  })
  it('renders no raw diagnostics, endpoint, private paths or session metadata', () => {
    const status = baseline()
    status.issues = ['file:///private/secret', 'policy_epoch_mismatch']
    const html = renderToStaticMarkup(<BrowserUserSummary status={status} coreReady />)
    for (const hidden of ['file:', '/private', 'policy_epoch', '43127'])
      expect(html).not.toContain(hidden)
    expect(browserUserErrorHint('/private/unknown')).not.toContain('private')
    expect(browserUserErrorHint('browser_rules_conflict')).toContain('重新检查')
  })
  it('shows store action plus exactly one connect/disconnect action, including pending cancellation', () => {
    const render = (status: BrowserUserStatus | null, connecting = false, closing = false) =>
      renderToStaticMarkup(
        <BrowserUserPrimaryActions
          status={status}
          coreReady
          busy={connecting}
          connecting={connecting}
          closing={closing}
          onInstall={() => {}}
          onCheck={() => {}}
          onDisable={() => {}}
        />,
      )
    expect(render(baseline())).toContain('安装插件')
    expect(render(baseline())).toContain('检查连接')
    expect(render(baseline())).not.toContain('关闭连接')
    const connected = { ...baseline(), enabled: true, connectedHosts: 1 }
    expect(render(connected)).toContain('关闭连接')
    expect(render(connected)).not.toContain('检查连接')
    const stop = (html: string) =>
      html.match(/<button[^>]*>[\s\S]*?<\/button>/g)!.find((button) => button.includes('关闭连接'))!
    expect(stop(render(null, true))).not.toContain('disabled')
    expect(stop(render(connected, false, true))).toContain('disabled')
  })
  it('keeps legacy exact blocks normalized, requires confirmation, and rejects non-HTTP and credentials', async () => {
    const request = browserUserRequest('setBlockedUrls', undefined, true, {
      blockedUrls: [
        'https://EXAMPLE.com/private?secret=x#f',
        'https://example.com/private',
        'https://example.com/private/',
      ],
    })
    expect(
      browserUserRequest('setBlockedUrls', undefined, true, {
        blockedUrls: [],
        expectedRulesRevision: 4,
      }),
    ).toHaveProperty('expectedRulesRevision', 4)
    expect(request.blockedUrls).toEqual([
      'https://example.com/private',
      'https://example.com/private/',
    ])
    for (const url of [
      'file:///private',
      'chrome://settings',
      'https://user:password@example.com/',
    ])
      expect(() =>
        browserUserRequest('setBlockedUrls', undefined, true, { blockedUrls: [url] }),
      ).toThrow()
    expect(() =>
      browserUserRequest('setBlockedUrls', undefined, false, { blockedUrls: [] }),
    ).toThrow()
  })
  it('localizes without renaming Browser User', () => {
    applyLocale('en')
    const html = renderToStaticMarkup(<BrowserUserSetting coreStatus={disconnected} />)
    expect(html).toContain('Browser User</h2>')
    expect(html).toContain('Manage browser connection')
  })
})
