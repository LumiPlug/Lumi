// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest'
import type { McpConnectionInfo } from '@lumiplug/shared'
import {
  isSameReadySession,
  readWorkbenchSetup,
  saveWorkbenchPreferences,
  workbenchSetupReducer,
  workbenchStep,
  readSavedWorkbenchSetup,
  selectWorkbenchTemplate,
  workbenchStorageKey,
  workbenchTemplateEvent,
} from './workbench'

const connection: McpConnectionInfo = {
  endpoint: 'http://127.0.0.1:43210/mcp',
  authHeader: 'x-lumiplug-session-token',
  sessionToken: 'private-current-session',
  coreState: 'ready',
  stdioCommand: null,
}

function verifiedSetup() {
  return workbenchSetupReducer(readWorkbenchSetup(null), { type: 'verified', connection })
}

describe('workbench setup lifecycle', () => {
  it('shares settings template selection without reopening the completed guide or saving session data', () => {
    const storage = new Map<string, string>([
      [
        workbenchStorageKey,
        saveWorkbenchPreferences(workbenchSetupReducer(verifiedSetup(), { type: 'complete' })),
      ],
    ])
    const events: unknown[] = []
    const target = new EventTarget()
    target.addEventListener(workbenchTemplateEvent, (event) =>
      events.push((event as CustomEvent).detail),
    )
    vi.stubGlobal('window', target)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        detail: unknown
        constructor(type: string, options: { detail: unknown }) {
          super(type)
          this.detail = options.detail
        }
      },
    )
    try {
      selectWorkbenchTemplate('features')
      const reopened = readSavedWorkbenchSetup()
      expect(reopened.selected).toBe('features')
      expect(workbenchStep(reopened, null)).toBe('later')
      expect(reopened.verifiedConnection).toBeNull()
      expect(events).toEqual(['features'])
      expect(storage.get(workbenchStorageKey)).not.toContain(connection.sessionToken)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('retains the selected template on reopening, but requires fresh connection verification', () => {
    const setup = workbenchSetupReducer(verifiedSetup(), { type: 'select', template: 'assistant' })
    const saved = saveWorkbenchPreferences(setup)
    expect(saved).not.toContain(connection.sessionToken)
    expect(saved).not.toContain(connection.endpoint)
    const reopened = readWorkbenchSetup(saved)
    expect(reopened.selected).toBe('assistant')
    expect(workbenchStep(reopened, connection)).toBe('connection')
    const checked = workbenchSetupReducer(reopened, { type: 'verified', connection })
    expect(workbenchStep(checked, connection)).toBe('templates')
    expect(checked.selected).toBe('assistant')
  })

  it('retains the template on repeated copy and completion across reopening', () => {
    const selected = workbenchSetupReducer(verifiedSetup(), {
      type: 'select',
      template: 'features',
    })
    const repeated = workbenchSetupReducer(selected, { type: 'select', template: 'features' })
    expect(repeated.selected).toBe('features')
    const completed = workbenchSetupReducer(repeated, { type: 'complete' })
    const reopened = readWorkbenchSetup(saveWorkbenchPreferences(completed))
    expect(workbenchStep(reopened, null)).toBe('later')
    expect(reopened.selected).toBe('features')
    expect(reopened.verifiedConnection).toBeNull()
  })

  it('allows completing the guide without choosing a template', () => {
    const completed = workbenchSetupReducer(verifiedSetup(), { type: 'complete' })
    expect(workbenchStep(completed, connection)).toBe('later')
    expect(completed.selected).toBeNull()
  })

  it('resumes directly to templates in the verified session and clears the postponement flag', () => {
    const deferred = workbenchSetupReducer(verifiedSetup(), { type: 'complete' })
    const resumed = workbenchSetupReducer(deferred, { type: 'resume', connection })
    expect(workbenchStep(resumed, connection)).toBe('templates')
    const reopened = readWorkbenchSetup(saveWorkbenchPreferences(resumed))
    expect(reopened.deferred).toBe(false)
    expect(reopened.step).toBe('connection')
  })

  it('requires verification after restarting a deferred setup', () => {
    const reopened = readWorkbenchSetup('later')
    const resumed = workbenchSetupReducer(reopened, { type: 'resume', connection })
    expect(workbenchStep(resumed, connection)).toBe('connection')
    expect(resumed.deferred).toBe(false)
  })

  it.each([
    null,
    { ...connection, coreState: 'restarting' as const },
    { ...connection, sessionToken: 'new-session' },
    { ...connection, endpoint: 'http://127.0.0.1:43211/mcp' },
    { ...connection, authHeader: 'x-next-auth' },
  ])('invalidates templates as soon as service or session changes: %j', (next) => {
    expect(isSameReadySession(connection, next)).toBe(false)
    expect(workbenchStep(verifiedSetup(), next)).toBe('connection')
    const invalidated = workbenchSetupReducer(verifiedSetup(), { type: 'invalidate' })
    // Returning to the same session after a service interruption still requires checking.
    expect(workbenchStep(invalidated, connection)).toBe('connection')
    expect(invalidated.verifiedConnection).toBeNull()
  })

  it('does not invalidate an unchanged ready session or a stdio command update', () => {
    expect(isSameReadySession(connection, { ...connection, stdioCommand: '/new/proxy' })).toBe(true)
    expect(workbenchStep(verifiedSetup(), { ...connection })).toBe('templates')
  })

  it.each([
    null,
    '{broken',
    '{}',
    '{"version":99,"deferred":true}',
    '{"version":1,"selected":"connection"}',
  ])('ignores malformed and unrecognized preferences: %s', (saved) => {
    const setup = readWorkbenchSetup(saved)
    expect(setup.step).toBe('connection')
    expect(setup.selected).toBeNull()
    expect(setup.verifiedConnection).toBeNull()
  })
})
