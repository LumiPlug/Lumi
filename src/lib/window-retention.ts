// SPDX-License-Identifier: MPL-2.0
import { useEffect } from 'react'
import { hostInvoke } from './tauri'
import { watchIdleMainWindow } from './window-idle'
import { windowIsActive } from './window-activity'

const retained = new Set<symbol>()
/** Retain transient state in memory; never serialize form inputs or credentials. */
export function useRetainWindowState(required: boolean) {
  useEffect(() => {
    if (!required) return
    const key = Symbol()
    retained.add(key)
    return () => {
      retained.delete(key)
    }
  }, [required])
}
export function useMainWindowIdle(onWorkbench: boolean) {
  useEffect(() => {
    if (!onWorkbench) return
    return watchIdleMainWindow({
      target: window,
      isActive: windowIsActive,
      canRelease: () => !retained.size && !document.querySelector('[role="dialog"], dialog[open]'),
      release: () => {
        void hostInvoke('release_idle_main_window').catch(() => {})
      },
    })
  }, [onWorkbench])
}
