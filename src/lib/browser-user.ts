// SPDX-License-Identifier: MPL-2.0
import type {
  BrowserUserAction,
  BrowserUserActionRequest,
  BrowserUserStatus,
} from '@lumiplug/shared'
import { OFFICIAL_BROWSER_EXTENSION_ID, normalizeBrowserBlockedUrls } from '@lumiplug/shared'
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
    autoRepair?: boolean
    migrateConfirmed?: boolean
    scopeConfirmed?: boolean
    blockedUrls?: string[]
  } = {},
): BrowserUserActionRequest {
  if (action !== 'diagnose' && confirmed !== true)
    throw new Error('browser_user_confirmation_required')
  const writesRegistration = action === 'enable' || action === 'repair'
  const selectedId = extensionId.trim() || OFFICIAL_BROWSER_EXTENSION_ID
  if (writesRegistration && !validBrowserExtensionId(selectedId))
    throw new Error('invalid_browser_user_extension_id')
  if (writesRegistration && selectedId !== OFFICIAL_BROWSER_EXTENSION_ID)
    throw new Error('browser_extension_id_not_official')
  for (const value of [options.autoRepair, options.migrateConfirmed]) {
    if (value !== undefined && typeof value !== 'boolean')
      throw new Error('invalid_browser_user_payload')
  }
  if (
    !writesRegistration &&
    (options.autoRepair !== undefined || options.migrateConfirmed !== undefined)
  )
    throw new Error('invalid_browser_user_payload')
  if (action === 'enable' && options.scopeConfirmed !== true)
    throw new Error('browser_scope_confirmation_required')
  if (action !== 'enable' && options.scopeConfirmed !== undefined)
    throw new Error('invalid_browser_user_payload')
  let blockedUrls: string[] | undefined
  if (action === 'setBlockedUrls') {
    blockedUrls = normalizeBrowserBlockedUrls(options.blockedUrls)
  } else if (options.blockedUrls !== undefined) throw new Error('invalid_browser_user_payload')
  return {
    action,
    ...(action === 'enable' ? { scopeConfirmed: true } : {}),
    ...(blockedUrls ? { blockedUrls } : {}),
    ...(writesRegistration
      ? {
          extensionId: selectedId,
          ...(options.autoRepair !== undefined ? { autoRepair: options.autoRepair } : {}),
          ...(options.migrateConfirmed !== undefined
            ? { migrateConfirmed: options.migrateConfirmed }
            : {}),
        }
      : {}),
    ...(action !== 'diagnose' ? { confirmed: true } : {}),
  }
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
      autoRepair: request.autoRepair,
      migrateConfirmed: request.migrateConfirmed,
      scopeConfirmed: request.scopeConfirmed,
      blockedUrls: request.blockedUrls,
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
  if (status.migrationRequired) return t('旧扩展身份需要确认迁移')
  if (status.requiresAuthorization) return t('需要确认全部普通网页控制范围')
  if (!status.enabled) return t('Browser User 已停用')
  if (!status.registration.supported) return t('当前平台不支持浏览器注册')
  if (!status.registration.registered) return t('浏览器连接需要安装')
  if (status.connectedHosts < 1) return t('等待 Chrome 扩展连接')
  if (!status.sessions.some((session) => session.state === 'active'))
    return t('等待可用网页或扩展权限')
  return t('已有可控网页')
}
export function browserUserIssueHint(error: unknown): string | null {
  const code = error instanceof Error ? error.message : error
  switch (code) {
    case 'browser_registration_foreign':
    case 'browser_registration_foreign_transaction':
      return t('检测到其他安装的连接。请先使用旧版的卸载方式移除旧连接，再重试安装。')
    case 'browser_native_host_missing':
      return t('Lumi 安装包不完整，请更新或重新安装 Lumi。')
    case 'browser_registration_permissions':
      return t('系统未允许注册浏览器连接，请检查系统权限后重试。')
    case 'browser_registration_directory_unsafe':
    case 'browser_registration_file_unsafe':
    case 'browser_registration_recovery_required':
      return t('浏览器连接配置需要检查，请联系支持后再安装；不会覆盖现有配置。')
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
  if (!status.registration.supported) return t('当前系统暂不支持此功能。')
  const issueHint = [...status.registration.issues, ...status.issues]
    .map(browserUserIssueHint)
    .find(Boolean)
  if (issueHint) return issueHint
  if (
    status.migrationRequired ||
    status.requiresAuthorization ||
    !status.enabled ||
    !status.registration.registered
  )
    return t('点击安装，按提示确认浏览器连接。')
  if (status.connectedHosts < 1) return t('请在 Chrome 中安装并启用 Lumi 官方扩展，然后检查连接。')
  if (!status.sessions.some((session) => session.state === 'active'))
    return t('请打开普通网页，并在 Chrome 扩展中确认权限或解除暂停。')
  return t('浏览器已就绪；暂停和接管始终优先。')
}
export function browserUserActionLabel(action: BrowserUserAction): string {
  switch (action) {
    case 'enable':
      return t('安装')
    case 'disable':
      return t('关闭')
    case 'repair':
      return t('安装')
    case 'diagnose':
      return t('检查连接')
    case 'setBlockedUrls':
      return t('更新禁止链接')
    case 'remove':
      return t('移除连接')
  }
}
