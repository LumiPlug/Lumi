// SPDX-License-Identifier: MPL-2.0
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPageRule } from '@lumiplug/shared'
import { BrowserPageRuleRow, BrowserUserPrimaryActions } from '../components/BrowserUserSetting'
import {
  browserUserRuleUpdate,
  browserPairingCanApprove,
  openBrowserExtensionStore,
  performBrowserUserAction,
} from './browser-user'
import { hostInvoke } from './tauri'

// Stateless business-component event contract tests, without claiming DOM/browser coverage.
vi.mock('../i18n', () => ({ useLocale: () => {}, t: (key: string) => key }))
vi.mock('./tauri', () => ({ hostInvoke: vi.fn() }))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return []
    return [child, ...elements(child.props.children as ReactNode)]
  })
}
function event(
  element: ReactElement<Record<string, unknown>> | undefined,
  name: string,
  value?: string,
) {
  expect(element).toBeDefined()
  const handler = element!.props[name] as (event?: { target: { value: string } }) => void
  handler(value === undefined ? undefined : { target: { value } })
}
beforeEach(() => vi.clearAllMocks())
const rule: BrowserPageRule = {
  label: 'Work',
  url: 'https://example.com/private',
  permission: 'block',
}
describe('Browser User business component interactions', () => {
  it('requires a checked exact live pairing code and never approves a replacement candidate', () => {
    const pair = { id: 'socket-a', code: '012345', expiresAt: new Date(60000).toISOString() }
    expect(browserPairingCanApprove(pair, pair, false, 1000)).toBe(false)
    expect(browserPairingCanApprove(pair, pair, true, 1000)).toBe(true)
    expect(browserPairingCanApprove({ ...pair, id: 'socket-b' }, pair, true, 1000)).toBe(false)
    expect(browserPairingCanApprove({ ...pair, code: '543210' }, pair, true, 1000)).toBe(false)
    expect(browserPairingCanApprove(pair, pair, true, 60000)).toBe(false)
    expect(browserPairingCanApprove(null, pair, true, 1000)).toBe(false)
    expect(browserPairingCanApprove({ ...pair, expiresAt: 'invalid' }, pair, true, 1000)).toBe(
      false,
    )
    expect(hostInvoke).not.toHaveBeenCalled()
  })
  it('edits label, URL and permission locally, and saves only on explicit Save', () => {
    const changed = vi.fn(),
      save = vi.fn(),
      remove = vi.fn()
    const row = elements(
      BrowserPageRuleRow({
        rule,
        disabled: false,
        changed: true,
        onChange: changed,
        onSave: save,
        onRemove: remove,
      }),
    )
    event(
      row.find((el) => el.props['aria-label'] === '网页标签'),
      'onChange',
      'Notes',
    )
    event(
      row.find((el) => el.props['aria-label'] === '网页链接'),
      'onChange',
      'https://example.com/notes?q=1',
    )
    event(
      row.find((el) => el.props['aria-label'] === '网页权限'),
      'onChange',
      'allow',
    )
    expect(changed.mock.calls.map(([value]) => value)).toEqual([
      { ...rule, label: 'Notes' },
      { ...rule, url: 'https://example.com/notes?q=1' },
      { ...rule, permission: 'allow' },
    ])
    expect(save).not.toHaveBeenCalled()
    expect(hostInvoke).not.toHaveBeenCalled()
    event(
      row.find((el) => el.props.children === '保存'),
      'onClick',
    )
    event(
      row.find((el) => el.props.children === '删除'),
      'onClick',
    )
    expect(save).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(rule.permission).toBe('block')
  })
  it('opens only the fixed native store command and routes a pending connection to stop', async () => {
    vi.mocked(hostInvoke).mockResolvedValue(undefined)
    const install = vi.fn(() => void openBrowserExtensionStore()),
      connect = vi.fn(),
      stop = vi.fn()
    const controls = elements(
      BrowserUserPrimaryActions({
        status: null,
        coreReady: true,
        busy: true,
        connecting: true,
        onInstall: install,
        onCheck: connect,
        onDisable: stop,
      }),
    )
    event(
      controls.find((el) => el.props.children === '安装插件'),
      'onClick',
    )
    event(
      controls.find((el) => el.props.children === '关闭连接'),
      'onClick',
    )
    expect(hostInvoke).toHaveBeenCalledWith('open_browser_extension_store', {})
    expect(stop).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
    expect(controls.some((el) => el.props.children === '检查连接')).toBe(false)
  })
  it('submits normalized edited rules with the captured CAS revision; failed save preserves caller draft and old list', async () => {
    const old = [{ ...rule }],
      draft = {
        ...rule,
        label: 'Edited',
        url: rule.url + '?secret=x#frag',
        permission: 'allow' as const,
      }
    const request = browserUserRuleUpdate(old, 7, 0, draft)
    expect(request).toEqual({
      action: 'setPageRules',
      confirmed: true,
      expectedRulesRevision: 7,
      pageRules: [{ ...draft, url: rule.url }],
    })
    vi.mocked(hostInvoke).mockRejectedValue('browser_rules_conflict')
    await expect(performBrowserUserAction(request)).rejects.toBe('browser_rules_conflict')
    expect(old).toEqual([rule])
    expect(draft.url).toContain('?secret=')
    expect(hostInvoke).toHaveBeenCalledWith('browser_user_request', {
      action: 'setPageRules',
      payload: { confirmed: true, expectedRulesRevision: 7, pageRules: request.pageRules },
    })
    expect(browserUserRuleUpdate(old, 7, 0, null).pageRules).toEqual([])
    expect(() => browserUserRuleUpdate(old, 7, null, { ...rule })).toThrow()
    for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => browserUserRuleUpdate(old, revision, 0, draft)).toThrow()
  })
})
