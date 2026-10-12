// SPDX-License-Identifier: MPL-2.0
import { hostInvoke } from './tauri'
import type { ToolTask } from '@lumiplug/shared'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type RunWindowRoute = { capabilityId: string; taskId: string | null }
export function runWindowRoute(search: string): RunWindowRoute | null {
  const parameters = new URLSearchParams(search)
  const capabilityId = parameters.get('runTool')
  const taskId = parameters.get('task')
  if (!capabilityId || !uuid.test(capabilityId) || (taskId !== null && !uuid.test(taskId)))
    return null
  return { capabilityId, taskId }
}
export function activeTask(task: Pick<ToolTask, 'status'> | null | undefined): boolean {
  return !!task && ['running', 'stopping'].includes(task.status)
}
export function openToolRunWindow(
  capabilityId: string,
  title: string,
  taskId?: string,
): Promise<void> {
  const style = getComputedStyle(document.documentElement)
  const size = (variable: string) => parseFloat(style.getPropertyValue(variable))
  return hostInvoke('open_tool_run_window', {
    request: {
      capabilityId,
      title,
      taskId: taskId ?? null,
      width: size('--lumi-form-dialog-width'),
      height: size('--lumi-form-dialog-height'),
      minWidth: size('--lumi-run-window-min-width'),
      minHeight: size('--lumi-run-window-min-height'),
    },
  })
}
export function closeToolRunWindow(mode: 'idle' | 'background' | 'ended'): Promise<void> {
  return hostInvoke('close_tool_run_window', { mode })
}
