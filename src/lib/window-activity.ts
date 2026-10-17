// SPDX-License-Identifier: MPL-2.0
import { useEffect } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { hostInvoke } from './tauri'

export const activityEvent = 'lumi-window-activity'
let nativeVisible = true
export function windowIsActive(): boolean {
  return nativeVisible && (typeof document === 'undefined' || !document.hidden)
}
export function useNativeWindowActivity() {
  useEffect(() => {
    if (!isTauri()) return
    let stopped = false
    let revision = 0
    let unlisten: (() => void) | undefined
    const update = (visible: boolean) => {
      if (stopped || nativeVisible === visible) return
      nativeVisible = visible
      window.dispatchEvent(new Event(activityEvent))
    }
    void getCurrentWindow()
      .listen<boolean>(activityEvent, ({ payload }) => {
        revision++
        update(payload)
      })
      .then(async (dispose) => {
        if (stopped) return dispose()
        unlisten = dispose
        const epoch = revision
        const visible = await hostInvoke<boolean>('get_window_activity')
        if (epoch === revision) update(visible)
      })
      .catch(() => {
        /* Browser previews use document visibility. */
      })
    return () => {
      stopped = true
      unlisten?.()
    }
  }, [])
}
