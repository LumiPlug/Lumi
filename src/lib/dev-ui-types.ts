// SPDX-License-Identifier: MPL-2.0
export interface DevelopmentUiPreset {
  enabled: boolean
  action: string
  capabilityId: string
}
export interface DevelopmentUiAudit {
  action: 'terminal.start'
  capabilityId: string
  phase: 'dispatch' | 'clicked' | 'not-ready' | 'observation'
  taskId?: string
  status?: string
  exitCode?: number
  stdoutLength?: number
  stderrLength?: number
}
declare global {
  interface Window {
    readonly __LUMI_DEV_UI_PRESET__?: Readonly<DevelopmentUiPreset> | null
  }
}
