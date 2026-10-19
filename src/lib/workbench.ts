// SPDX-License-Identifier: MPL-2.0
import { t } from '../i18n'

import type { McpConnectionInfo } from '@lumiplug/shared'
import type { PromptType } from './mcp'

export type WorkbenchTemplate = Exclude<PromptType, 'connection'>
export type WorkbenchStep = 'connection' | 'templates' | 'later'
export const workbenchStorageKey = 'lumi.workbench.setup'
export const workbenchTemplateEvent = 'lumi:workbench-template'
export const workbenchTemplates: { id: WorkbenchTemplate; label: string; description: string }[] = [
  {
    id: 'assistant',
    get label() {
      return t('工作助手')
    },
    get description() {
      return t('重点、待办与项目进展')
    },
  },
  {
    id: 'features',
    get label() {
      return t('功能入口')
    },
    get description() {
      return t('常用工具与快捷操作')
    },
  },
]

export function readSavedWorkbenchSetup(): WorkbenchSetup {
  try {
    return readWorkbenchSetup(localStorage.getItem(workbenchStorageKey))
  } catch {
    return readWorkbenchSetup(null)
  }
}

export function selectWorkbenchTemplate(template: WorkbenchTemplate): void {
  try {
    const current = readSavedWorkbenchSetup()
    localStorage.setItem(
      workbenchStorageKey,
      saveWorkbenchPreferences({ ...current, selected: template }),
    )
  } catch {
    // Keep the current session synchronized even when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(workbenchTemplateEvent, { detail: template }))
}

interface WorkbenchPreferences {
  deferred: boolean
  selected: WorkbenchTemplate | null
}

export interface WorkbenchSetup extends WorkbenchPreferences {
  step: WorkbenchStep
  /** Verification is only kept in memory, never in the saved preferences. */
  verifiedConnection: McpConnectionInfo | null
}

type SetupAction =
  | { type: 'verified'; connection: McpConnectionInfo }
  | { type: 'invalidate' }
  | { type: 'select'; template: WorkbenchTemplate }
  | { type: 'complete' }
  | { type: 'resume'; connection: McpConnectionInfo | null }

export function readWorkbenchSetup(saved: string | null): WorkbenchSetup {
  let preferences: WorkbenchPreferences = { deferred: saved === 'later', selected: null }
  try {
    const value: unknown = saved ? JSON.parse(saved) : null
    if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
      preferences = {
        deferred: 'deferred' in value && value.deferred === true,
        selected:
          'selected' in value && (value.selected === 'assistant' || value.selected === 'features')
            ? value.selected
            : null,
      }
    }
  } catch {
    // The original "later" flag remains supported; malformed storage is ignored.
  }
  return {
    ...preferences,
    step: preferences.deferred ? 'later' : 'connection',
    verifiedConnection: null,
  }
}

export function saveWorkbenchPreferences(setup: WorkbenchSetup): string {
  return JSON.stringify({ version: 1, deferred: setup.deferred, selected: setup.selected })
}

export function isSameReadySession(
  verified: McpConnectionInfo | null,
  current: McpConnectionInfo | null,
): boolean {
  return Boolean(
    verified &&
    current &&
    current.coreState === 'ready' &&
    verified.coreState === 'ready' &&
    verified.endpoint === current.endpoint &&
    verified.authHeader === current.authHeader &&
    verified.sessionToken === current.sessionToken,
  )
}

export function workbenchStep(
  setup: WorkbenchSetup,
  connection: McpConnectionInfo | null,
): WorkbenchStep {
  return setup.step === 'templates' && !isSameReadySession(setup.verifiedConnection, connection)
    ? 'connection'
    : setup.step
}

export function workbenchSetupReducer(setup: WorkbenchSetup, action: SetupAction): WorkbenchSetup {
  switch (action.type) {
    case 'verified':
      return { ...setup, step: 'templates', deferred: false, verifiedConnection: action.connection }
    case 'invalidate':
      return {
        ...setup,
        step: setup.step === 'templates' ? 'connection' : setup.step,
        verifiedConnection: null,
      }
    case 'select':
      return { ...setup, selected: action.template }
    case 'complete':
      // Keep the existing storage flag compatible with earlier postponed setups.
      return { ...setup, step: 'later', deferred: true }
    case 'resume':
      return {
        ...setup,
        deferred: false,
        step: isSameReadySession(setup.verifiedConnection, action.connection)
          ? 'templates'
          : 'connection',
      }
  }
}
