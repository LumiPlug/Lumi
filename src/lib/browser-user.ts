// SPDX-License-Identifier: MPL-2.0
import type {
  BrowserUserAction,
  BrowserUserActionRequest,
  BrowserUserStatus,
} from '@lumiplug/shared'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
import { t } from '../i18n'
import { hostInvoke } from './tauri'

export function validBrowserExtensionId(value: string): boolean {
  return /^[a-p]{32}$/.test(value.trim())
}
export function browserUserRequest(
  action: BrowserUserAction,
  extensionId = OFFICIAL_BROWSER_EXTENSION_ID,
  confirmed = false,
  options: { autoRepair?: boolean; migrateConfirmed?: boolean } = {},
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
  return {
    action,
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
    { autoRepair: request.autoRepair, migrateConfirmed: request.migrateConfirmed },
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
  if (!status.enabled) return t('Browser User 已停用')
  if (!status.registration.supported) return t('当前平台不支持浏览器注册')
  if (!status.registration.registered) return t('等待注册或修复')
  if (status.connectedHosts < 1) return t('等待 Chrome 扩展连接')
  if (!status.sessions.some((session) => session.state === 'active')) return t('等待标签页授权')
  return t('已有授权标签页')
}
export function browserUserActionLabel(action: BrowserUserAction): string {
  switch (action) {
    case 'enable':
      return t('启用并注册')
    case 'disable':
      return t('停用 Browser User')
    case 'repair':
      return t('修复注册')
    case 'diagnose':
      return t('诊断连接')
    case 'remove':
      return t('移除连接')
  }
}
