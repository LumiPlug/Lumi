// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrowserUserStatus, UiCoreStatus } from '@lumiplug/shared'
import BrowserUserSetting, { BrowserUserSummary } from '../components/BrowserUserSetting'
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
const id = 'abcdefghijklmnopabcdefghijklmnop'
const baseline = (): BrowserUserStatus => ({
  enabled: false,
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
    await performBrowserUserAction(browserUserRequest('enable', ` ${id} `, true))
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
      payload: { extensionId: id, confirmed: true },
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
    expect(browserUserStateLabel(status, true)).toBe('等待标签页授权')
    status.sessions.push({
      id: 's',
      tabId: 1,
      title: 'Fixture',
      url: 'https://example.test/',
      origin: 'https://example.test',
      state: 'paused',
    })
    expect(browserUserStateLabel(status, true)).toBe('等待标签页授权')
    status.sessions[0]!.state = 'active'
    expect(browserUserStateLabel(status, true)).toBe('已有授权标签页')
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
