// SPDX-License-Identifier: MPL-2.0
import { t } from '../i18n'
import type { JsonValue, ToolTask } from '@lumiplug/shared'
export type RunResultPanel = { key: string; label: string; text: string }
const text = (value: JsonValue): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)
/** Only actual stored result fields are presented; transport headers are never synthesized. */
export function remoteResultPanels(task: ToolTask): RunResultPanel[] {
  const result = task.result
  if (result === null)
    return [
      { key: 'result', label: task.runnerType === 'http' ? t('响应数据') : t('结果'), text: '' },
    ]
  if (result && !Array.isArray(result) && typeof result === 'object') {
    if (
      task.runnerType === 'http' &&
      typeof result.status === 'number' &&
      Object.hasOwn(result, 'body')
    ) {
      const rest = Object.fromEntries(
        Object.entries(result).filter(([key]) => !['status', 'body'].includes(key)),
      )
      return [
        { key: 'body', label: t('响应正文'), text: text(result.body!) },
        ...(Object.keys(rest).length
          ? [{ key: 'data', label: t('其他返回数据'), text: text(rest) }]
          : []),
      ]
    }
    if (task.runnerType === 'mcp' && typeof result.text === 'string') {
      const rest = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'text'))
      return [
        { key: 'text', label: t('文本结果'), text: result.text },
        ...(Object.keys(rest).length
          ? [{ key: 'data', label: t('结构化数据'), text: text(rest) }]
          : []),
      ]
    }
  }
  return [
    {
      key: 'result',
      label: task.runnerType === 'http' ? t('响应数据') : t('结果'),
      text: text(result),
    },
  ]
}
export function runHttpStatus(task: ToolTask): number | null {
  if (task.runnerType !== 'http') return null
  for (const event of [...(task.events ?? [])].reverse()) {
    const match = /^收到响应（HTTP (\d{3})）$/.exec(event.message)
    if (match) return Number(match[1])
  }
  return null
}

/** Readable JSON is presentation only; each copy still uses the full original panel text. */
export function displayRunResult(text: string): string {
  try {
    const value: unknown = JSON.parse(text)
    if (value !== null && typeof value === 'object') return JSON.stringify(value, null, 2)
  } catch {
    /* Plain text remains literal. */
  }
  return text
}
