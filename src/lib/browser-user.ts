// SPDX-License-Identifier: MPL-2.0
import type {
  BrowserUserAction,
  BrowserUserActionRequest,
  BrowserUserStatus,
  BrowserPageRule,
} from '@lumiplug/shared'
import {
  OFFICIAL_BROWSER_EXTENSION_ID,
  normalizeBrowserBlockedUrls,
  normalizeBrowserPageRules,
} from '@lumiplug/shared'
import { t } from '../i18n'
import { hostInvoke } from './tauri'

export function validBrowserExtensionId(value: string): boolean {
  return /^[a-p]{32}$/.test(value.trim())
}
export function browserUserRequest(
  action: BrowserUserAction,
  extensionId = OFFICIAL_BROWSER_EXTENSION_ID,
  confirmed = false,
  options: {
    scopeConfirmed?: boolean
    blockedUrls?: string[]
    pageRules?: BrowserPageRule[]
    expectedRulesRevision?: number
    pairingId?: string
    pairingCode?: string
  } = {},
): BrowserUserActionRequest {
  if (action !== 'diagnose' && confirmed !== true)
    throw new Error('browser_user_confirmation_required')
  const writesIdentity = action === 'enable'
  const selectedId = extensionId.trim() || OFFICIAL_BROWSER_EXTENSION_ID
  if (writesIdentity && !validBrowserExtensionId(selectedId))
    throw new Error('invalid_browser_user_extension_id')
  if (writesIdentity && selectedId !== OFFICIAL_BROWSER_EXTENSION_ID)
    throw new Error('browser_extension_id_not_official')
  if (options.scopeConfirmed !== undefined && typeof options.scopeConfirmed !== 'boolean')
    throw new Error('invalid_browser_user_payload')
  if (action !== 'enable' && options.scopeConfirmed !== undefined)
    throw new Error('invalid_browser_user_payload')
  let blockedUrls: string[] | undefined
  if (action === 'setBlockedUrls') {
    blockedUrls = normalizeBrowserBlockedUrls(options.blockedUrls)
  } else if (options.blockedUrls !== undefined) throw new Error('invalid_browser_user_payload')
  let pageRules: BrowserPageRule[] | undefined
  let expectedRulesRevision: number | undefined
  if (action === 'setPageRules') {
    pageRules = normalizeBrowserPageRules(options.pageRules)
    if (!Number.isSafeInteger(options.expectedRulesRevision) || options.expectedRulesRevision! < 0)
      throw new Error('invalid_browser_page_rules')
    expectedRulesRevision = options.expectedRulesRevision
  } else if (
    options.pageRules !== undefined ||
    (options.expectedRulesRevision !== undefined && action !== 'setBlockedUrls')
  ) {
    throw new Error('invalid_browser_user_payload')
  }
  if (action === 'setBlockedUrls' && options.expectedRulesRevision !== undefined) {
    if (!Number.isSafeInteger(options.expectedRulesRevision) || options.expectedRulesRevision < 0)
      throw new Error('invalid_browser_page_rules')
    expectedRulesRevision = options.expectedRulesRevision
  }
  if (action === 'approvePairing') {
    if (
      typeof options.pairingId !== 'string' ||
      !options.pairingId ||
      options.pairingId.length > 128 ||
      typeof options.pairingCode !== 'string' ||
      !options.pairingCode ||
      !/^\d{6}$/.test(options.pairingCode)
    )
      throw new Error('browser_pairing_invalid')
  } else if (options.pairingId !== undefined || options.pairingCode !== undefined)
    throw new Error('invalid_browser_user_payload')
  return {
    action,
    ...(action === 'approvePairing'
      ? { pairingId: options.pairingId, pairingCode: options.pairingCode }
      : {}),
    ...(action === 'enable' && options.scopeConfirmed !== undefined
      ? { scopeConfirmed: options.scopeConfirmed }
      : {}),
    ...(pageRules ? { pageRules, expectedRulesRevision } : {}),
    ...(blockedUrls
      ? { blockedUrls, ...(expectedRulesRevision !== undefined ? { expectedRulesRevision } : {}) }
      : {}),
    ...(writesIdentity
      ? {
          extensionId: selectedId,
        }
      : {}),
    ...(action !== 'diagnose' ? { confirmed: true } : {}),
  }
}
export function openBrowserExtensionStore(): Promise<void> {
  return hostInvoke('open_browser_extension_store', {})
}
export function browserUserConnectionActive(
  status: BrowserUserStatus | null,
  connecting = false,
): boolean {
  return connecting || !!status?.enabled || (status?.connectedHosts ?? 0) > 0
}
export function browserUserCanResetPairing(
  status: BrowserUserStatus | null,
  hasError = false,
): boolean {
  return (
    !!status &&
    status.connectedHosts === 0 &&
    (status.paired || hasError || status.issues.length > 0)
  )
}
export function browserUserNeedsConsent(status: BrowserUserStatus): boolean {
  return status.requiresAuthorization
}
export function browserPairingCanApprove(
  current: { id: string; code: string; expiresAt: string } | null | undefined,
  shown: { id: string; code: string; expiresAt: string },
  checked: boolean,
  now = Date.now(),
): boolean {
  return (
    checked &&
    !!current &&
    current.id === shown.id &&
    current.code === shown.code &&
    Date.parse(current.expiresAt) > now &&
    Date.parse(shown.expiresAt) > now
  )
}
export function browserUserRuleUpdate(
  existing: BrowserPageRule[],
  revision: number,
  index: number | null,
  draft: BrowserPageRule | null,
): BrowserUserActionRequest {
  const pageRules = existing.map((rule) => ({ ...rule }))
  if (index === null) {
    if (!draft) throw new Error('invalid_browser_page_rules')
    pageRules.push(draft)
  } else {
    if (!Number.isInteger(index) || index < 0 || index >= pageRules.length)
      throw new Error('invalid_browser_page_rules')
    if (draft) pageRules[index] = draft
    else pageRules.splice(index, 1)
  }
  return browserUserRequest('setPageRules', undefined, true, {
    pageRules,
    expectedRulesRevision: revision,
  })
}
export function getBrowserUserStatus(): Promise<BrowserUserStatus> {
  return hostInvoke('browser_user_request', { action: 'status', payload: {} })
}
export function performBrowserUserAction(
  request: BrowserUserActionRequest,
): Promise<BrowserUserStatus> {
  const { action, ...payload } = browserUserRequest(
    request.action,
    request.extensionId ?? '',
    request.confirmed,
    {
      scopeConfirmed: request.scopeConfirmed,
      blockedUrls: request.blockedUrls,
      pageRules: request.pageRules,
      pairingId: request.pairingId,
      pairingCode: request.pairingCode,
      expectedRulesRevision: request.expectedRulesRevision,
    },
  )
  return hostInvoke('browser_user_request', { action, payload })
}
export function browserUserStateLabel(
  status: BrowserUserStatus | null,
  coreReady: boolean,
): string {
  if (!coreReady) return t('Core 未连接')
  if (!status) return t('Browser User 状态未知')
  if (status.requiresAuthorization) return t('需要确认全部普通网页控制范围')
  if (!status.enabled) return t('Browser User 已停用')
  if (status.pairing) return t('等待核对插件配对码')
  if (status.connectedHosts < 1) return t('连接中，可打开扩展完成连接')
  if (!status.sessions.some((session) => session.state === 'active'))
    return t('等待可用网页或扩展权限')
  return t('已有可控网页')
}
export function browserUserIssueHint(error: unknown): string | null {
  const code = error instanceof Error ? error.message : error
  switch (code) {
    case 'browser_rules_conflict':
      return t('网页规则已在其他窗口变化，请重新检查后再保存。')
    case 'browser_extension_store_open_failed':
      return t('无法打开扩展商店，请检查系统默认浏览器设置。')
    case 'browser_pairing_invalid':
    case 'browser_pairing_expired':
      return t('配对已过期或变化，请重新连接并核对新的配对码。')
    case 'browser_settings_invalid':
    case 'browser_settings_unsafe':
      return t('连接设置无法读取，请联系支持；不会覆盖现有规则。')
    case 'browser_settings_write_failed':
      return t('无法保存连接设置，请检查磁盘空间和文件权限。')
    case 'browser_scope_confirmation_required':
      return t('请重新检查连接并确认网页控制范围。')
    case 'browser_listener_unavailable':
      return t('浏览器连接端口不可用，请退出其他 Lumi 实例后重试。')
    default:
      return null
  }
}
export function browserUserErrorHint(error: unknown): string {
  return browserUserIssueHint(error) ?? t('操作未确认完成，请检查连接后再决定是否重试。')
}
export function browserUserNextStep(status: BrowserUserStatus | null, coreReady: boolean): string {
  if (!coreReady) return t('请等待 Lumi 启动完成后再检查连接。')
  if (!status) return t('请点击检查连接重试。')
  const issueHint = status.issues.map(browserUserIssueHint).find(Boolean)
  if (issueHint) return issueHint
  if (status.requiresAuthorization || !status.enabled) return t('点击检查连接，按提示确认。')
  if (status.connectedHosts < 1) return t('请在 Chrome 中安装并启用 Lumi 官方扩展，然后检查连接。')
  if (!status.sessions.some((session) => session.state === 'active'))
    return t('请打开普通网页，并在 Chrome 扩展中确认权限或解除暂停。')
  return t('浏览器已就绪；暂停和接管始终优先。')
}
export function browserUserActionLabel(action: BrowserUserAction): string {
  switch (action) {
    case 'enable':
      return t('检查连接')
    case 'disable':
      return t('关闭连接')
    case 'diagnose':
      return t('检查连接')
    case 'setPageRules':
      return t('保存网页规则')
    case 'setBlockedUrls':
      return t('更新禁止链接')
    case 'approvePairing':
      return t('核对配对码')
    case 'resetPairing':
      return t('重新配对')
  }
}
