// SPDX-License-Identifier: MPL-2.0
import { hostInvoke } from './tauri'
import { TOOL_ERRORS } from '@lumiplug/shared'
export function toolAddedTime(value: string): { dateTime: string | null; text: string } {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0)
    return { dateTime: null, text: '添加时间未知' }
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(date)
    .replaceAll('/', '-')
  return { dateTime: date.toISOString(), text: `添加于 ${formatted}` }
}

export type ToolsAction =
  | 'snapshot'
  | 'list'
  | 'get'
  | 'save'
  | 'check'
  | 'discover'
  | 'enable'
  | 'disable'
  | 'archive'
  | 'restore'
  | 'run'
  | 'prepare'
  | 'tasks'
  | 'task'
  | 'stop'
  | 'restart'
export function toolsRequest<T>(
  action: ToolsAction,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return hostInvoke<T>('tools_request', { action, payload })
}
export function toolErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return (
    TOOL_ERRORS[code] ??
    (code.includes('core')
      ? '服务未连接，请稍后重试或到设置检查服务。'
      : '操作失败，请检查配置后重试。')
  )
}
