// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
import type { BrowserUserStatus, UiCoreStatus } from '@lumiplug/shared'
import BrowserUserSetting, {
  BrowserUserSummary,
  BrowserUserIdentitySettings,
} from '../components/BrowserUserSetting'
import { applyLocale } from '../i18n'
import { hostInvoke } from './tauri'
import {
  browserUserRequest,
  browserUserStateLabel,
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
  autoRepair: false,
  migrationRequired: false,
  requiresAuthorization: false,
  blockedUrls: [],
  extensionId: null,
  connectedHosts: 0,
  sessions: [],
  controlDomain: 'shared-lumi',
  registration: { supported: true, registered: false, nativeHostPath: '', issues: [] },
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
  it('exposes the exact setting name and disconnected state without pretending to connect', () => {
    const html = renderToStaticMarkup(<BrowserUserSetting coreStatus={disconnected} />)
    expect(html).toContain('Browser User</h2>')
    expect(html).toContain('Core 未连接')
    expect(html).toContain('管理浏览器连接')
    expect(hostInvoke).not.toHaveBeenCalled()
  })
  it('validates the complete extension ID and trims only surrounding whitespace', () => {
    expect(validBrowserExtensionId(id)).toBe(true)
    expect(validBrowserExtensionId(` ${id} `)).toBe(true)
    for (const value of [
      '',
      'a'.repeat(31),
      'a'.repeat(33),
      'A'.repeat(32),
      'z'.repeat(32),
      id.slice(1) + '/',
      id.slice(1) + '中',
    ])
      expect(validBrowserExtensionId(value)).toBe(false)
  })
  it('never builds persistent operations without explicit confirmation', () => {
    for (const action of ['enable', 'repair', 'disable', 'remove'] as const) {
      expect(() => browserUserRequest(action, id)).toThrow('browser_user_confirmation_required')
      expect(() => performBrowserUserAction({ action, extensionId: id })).toThrow(
        'browser_user_confirmation_required',
      )
    }
    expect(hostInvoke).not.toHaveBeenCalled()
    expect(() => browserUserRequest('enable', 'invalid', true)).toThrow(
      'invalid_browser_user_extension_id',
    )
  })
  it('uses only the nonce-bearing host command and does not confirm read-only diagnostics', async () => {
    vi.mocked(hostInvoke).mockResolvedValue(baseline())
    await getBrowserUserStatus()
    await performBrowserUserAction(browserUserRequest('diagnose', ''))
    await performBrowserUserAction(
      browserUserRequest('enable', ` ${id} `, true, { scopeConfirmed: true }),
    )
    expect(hostInvoke).toHaveBeenNthCalledWith(1, 'browser_user_request', {
      action: 'status',
      payload: {},
    })
    expect(hostInvoke).toHaveBeenNthCalledWith(2, 'browser_user_request', {
      action: 'diagnose',
      payload: {},
    })
    expect(hostInvoke).toHaveBeenNthCalledWith(3, 'browser_user_request', {
      action: 'enable',
      payload: { extensionId: id, confirmed: true, scopeConfirmed: true },
    })
  })
  it('does not turn request failures into fabricated disabled or successful states', async () => {
    vi.mocked(hostInvoke).mockRejectedValue(new Error('offline'))
    await expect(getBrowserUserStatus()).rejects.toThrow('offline')
    await expect(performBrowserUserAction({ action: 'disable', confirmed: true })).rejects.toThrow(
      'offline',
    )
  })
  it('distinguishes registration, extension transport and user-authorized active tabs', () => {
    const status = baseline()
    expect(browserUserStateLabel(null, true)).toContain('状态未知')
    expect(browserUserStateLabel(status, true)).toContain('已停用')
    status.enabled = true
    expect(browserUserStateLabel(status, true)).toBe('等待注册或修复')
    status.registration.registered = true
    expect(browserUserStateLabel(status, true)).toBe('等待 Chrome 扩展连接')
    status.connectedHosts = 1
    expect(browserUserStateLabel(status, true)).toBe('等待可用网页或扩展权限')
    status.sessions.push({
      id: 's',
      tabId: 1,
      title: 'Fixture',
      url: 'https://example.test/',
      origin: 'https://example.test',
      state: 'paused',
    })
    expect(browserUserStateLabel(status, true)).toBe('等待可用网页或扩展权限')
    status.sessions[0]!.state = 'active'
    expect(browserUserStateLabel(status, true)).toBe('已有可控网页')
    expect(browserUserStateLabel(status, false)).toBe('Core 未连接')
  })
  it('keeps unavailable counts unknown and suppresses stale connected state when Core stops', () => {
    const unknown = renderToStaticMarkup(<BrowserUserSummary status={null} coreReady />)
    expect(unknown).toContain('状态未知')
    expect(unknown).not.toContain('连接扩展 0')
    const stale = baseline()
    stale.enabled = true
    stale.connectedHosts = 2
    const stopped = renderToStaticMarkup(<BrowserUserSummary status={stale} coreReady={false} />)
    expect(stopped).not.toContain('连接扩展 2')
    expect(stopped).toContain('Core 未连接')
  })
  it('escapes untrusted tab titles and keeps diagnostics as plain data', () => {
    const status = baseline()
    status.sessions.push({
      id: 's',
      tabId: 1,
      title: '<script>bad()</script>',
      url: 'https://example.test/',
      origin: 'https://example.test',
      state: 'paused',
    })
    status.issues.push('<img onerror=bad()>')
    const html = renderToStaticMarkup(<BrowserUserSummary status={status} coreReady />)
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img onerror=bad()&gt;')
  })
  it('localizes state text while preserving the exact Browser User name', () => {
    applyLocale('en')
    const html = renderToStaticMarkup(<BrowserUserSetting coreStatus={disconnected} />)
    expect(html).toContain('Browser User</h2>')
    expect(html).toContain('Manage browser connection')
    expect(html).not.toContain('管理浏览器连接')
  })
})

describe('official browser identity and explicit maintenance consent', () => {
  it('defaults to the official identity without manual input and never implicitly authorizes maintenance', () => {
    expect(browserUserRequest('enable', undefined, true, { scopeConfirmed: true })).toEqual({
      action: 'enable',
      extensionId: id,
      confirmed: true,
      scopeConfirmed: true,
    })
    expect(() => browserUserRequest('enable', 'a'.repeat(32), true)).toThrow('not_official')
    const html = renderToStaticMarkup(
      <BrowserUserIdentitySettings
        status={baseline()}
        autoRepair={false}
        disabled={false}
        onAutoRepairChange={() => {}}
      />,
    )
    expect(html).toContain(id)
    expect(html).toContain('无需复制或填写 ID')
    expect(html).not.toContain('type="text"')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('不恢复暂停或接管状态')
  })
  it('forwards separate maintenance and migration consents only on confirmed registration actions', async () => {
    vi.mocked(hostInvoke).mockResolvedValue(baseline())
    await performBrowserUserAction(
      browserUserRequest('repair', undefined, true, { autoRepair: true, migrateConfirmed: true }),
    )
    expect(hostInvoke).toHaveBeenCalledWith('browser_user_request', {
      action: 'repair',
      payload: { extensionId: id, confirmed: true, autoRepair: true, migrateConfirmed: true },
    })
    expect(() =>
      browserUserRequest('repair', undefined, false, { autoRepair: true, migrateConfirmed: true }),
    ).toThrow('confirmation_required')
    expect(() => browserUserRequest('diagnose', undefined, false, { autoRepair: true })).toThrow(
      'invalid_browser_user_payload',
    )
    expect(() =>
      browserUserRequest('enable', undefined, true, { autoRepair: 'yes' as unknown as boolean }),
    ).toThrow('invalid_browser_user_payload')
    expect(
      browserUserRequest('enable', undefined, true, {
        autoRepair: false,
        migrateConfirmed: false,
        scopeConfirmed: true,
      }),
    ).toMatchObject({ autoRepair: false, migrateConfirmed: false, scopeConfirmed: true })
  })
  it('shows legacy identity migration and reload guidance without silently changing the saved identity', () => {
    const status = baseline()
    status.extensionId = 'a'.repeat(32)
    status.migrationRequired = true
    expect(browserUserStateLabel(status, true)).toBe('旧扩展身份需要确认迁移')
    const html = renderToStaticMarkup(
      <BrowserUserIdentitySettings
        status={status}
        autoRepair={false}
        disabled={false}
        onAutoRepairChange={() => {}}
      />,
    )
    expect(html).toContain('身份迁移与网页范围授权分别确认')
    expect(html).toContain('重新加载官方扩展')
    expect(html).toContain(status.extensionId)
    expect(hostInvoke).not.toHaveBeenCalled()
  })
})

describe('default-allow scope and exact blocked links', () => {
  it('requires a distinct fresh scope confirmation rather than legacy confirmed alone', () => {
    expect(() => browserUserRequest('enable', undefined, true)).toThrow(
      'scope_confirmation_required',
    )
    expect(() => browserUserRequest('repair', undefined, true, { scopeConfirmed: true })).toThrow(
      'invalid_browser_user_payload',
    )
    const status = baseline()
    status.enabled = true
    status.requiresAuthorization = true
    expect(browserUserStateLabel(status, true)).toBe('需要确认全部普通网页控制范围')
  })
  it('normalizes exact links without query or fragment, deduplicates, preserves trailing slash', async () => {
    vi.mocked(hostInvoke).mockResolvedValue(baseline())
    const request = browserUserRequest('setBlockedUrls', undefined, true, {
      blockedUrls: [
        'https://EXAMPLE.com/private?token=x#fragment',
        'https://example.com/private?other=y',
        'https://example.com/private/',
      ],
    })
    expect(request.blockedUrls).toEqual([
      'https://example.com/private',
      'https://example.com/private/',
    ])
    await performBrowserUserAction(request)
    expect(hostInvoke).toHaveBeenCalledWith('browser_user_request', {
      action: 'setBlockedUrls',
      payload: { confirmed: true, blockedUrls: request.blockedUrls },
    })
    expect(JSON.stringify(request)).not.toContain('token=')
  })
  it('requires confirmation for adding or removing blocks and rejects credentials/non-HTTP/overflow', () => {
    expect(() =>
      browserUserRequest('setBlockedUrls', undefined, false, { blockedUrls: [] }),
    ).toThrow('confirmation_required')
    for (const url of [
      'https://name:password@example.com/private',
      'file:///secret',
      'chrome://settings',
      'javascript:alert(1)',
    ]) {
      expect(() =>
        browserUserRequest('setBlockedUrls', undefined, true, { blockedUrls: [url] }),
      ).toThrow()
    }
    expect(() =>
      browserUserRequest('setBlockedUrls', undefined, true, {
        blockedUrls: Array(101).fill('https://example.com/'),
      }),
    ).toThrow()
    expect(() =>
      browserUserRequest('setBlockedUrls', undefined, true, {
        blockedUrls: ['https://example.com/' + 'a'.repeat(2048)],
      }),
    ).toThrow()
    expect(() => browserUserRequest('diagnose', undefined, false, { blockedUrls: [] })).toThrow(
      'invalid_browser_user_payload',
    )
    expect(browserUserRequest('setBlockedUrls', undefined, true, { blockedUrls: [] })).toEqual({
      action: 'setBlockedUrls',
      confirmed: true,
      blockedUrls: [],
    })
    expect(hostInvoke).not.toHaveBeenCalled()
  })
})
