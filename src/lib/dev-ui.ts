// SPDX-License-Identifier: MPL-2.0
import type { ToolTask } from '@lumiplug/shared'
import type { DevelopmentUiAudit, DevelopmentUiPreset } from './dev-ui-types'
import { hostInvoke } from './tauri'

const used = new WeakSet<DevelopmentUiPreset>()
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export type DevelopmentUiResult = 'disabled' | 'rejected' | 'not-ready' | 'duplicate' | 'clicked'
export async function recordDevelopmentUi(event: DevelopmentUiAudit): Promise<void> {
  await hostInvoke('lumi_dev_ui_record', { event })
}
/** Only a registered button reference is accepted. No selectors, eval or execution API. */
export async function dispatchDevelopmentUiAction(
  preset: Readonly<DevelopmentUiPreset> | null | undefined,
  capabilityId: string,
  button: HTMLButtonElement | null,
  claim: (event: DevelopmentUiAudit) => Promise<void> = recordDevelopmentUi,
): Promise<DevelopmentUiResult> {
  if (!preset?.enabled) return 'disabled'
  if (
    preset.action !== 'terminal.start' ||
    !uuid.test(preset.capabilityId) ||
    preset.capabilityId !== capabilityId
  )
    return 'rejected'
  if (used.has(preset)) return 'duplicate'
  if (!button?.isConnected || button.tagName !== 'BUTTON' || button.disabled) return 'not-ready'
  // Guard concurrent effects before waiting for the host's process-wide one-shot claim.
  used.add(preset)
  await claim({ action: 'terminal.start', capabilityId, phase: 'dispatch' })
  if (!button.isConnected || button.disabled) return 'not-ready'
  button.click()
  await claim({ action: 'terminal.start', capabilityId, phase: 'clicked' })
  return 'clicked'
}
const observations = new Map<string, string>()
export async function observeDevelopmentUi(
  preset: DevelopmentUiPreset,
  task: ToolTask,
): Promise<void> {
  const result =
    task.result && !Array.isArray(task.result) && typeof task.result === 'object'
      ? task.result
      : null
  if (task.capabilityId !== preset.capabilityId) return
  const event: DevelopmentUiAudit = {
    action: 'terminal.start',
    capabilityId: preset.capabilityId,
    phase: 'observation',
    taskId: task.id,
    status: task.status,
    exitCode: typeof result?.exitCode === 'number' ? result.exitCode : undefined,
    stdoutLength: task.stdout.length,
    stderrLength: task.stderr.length,
  }
  const signature = JSON.stringify(event)
  if (observations.get(task.id) === signature) return
  observations.set(task.id, signature)
  await recordDevelopmentUi(event)
}
