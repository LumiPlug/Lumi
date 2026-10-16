// SPDX-License-Identifier: MPL-2.0
export const MAIN_WINDOW_IDLE_MS = 5 * 60_000
export function watchIdleMainWindow({
  target,
  isActive,
  canRelease,
  release,
}: {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  isActive: () => boolean
  canRelease: () => boolean
  release: () => void
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    clearTimeout(timer)
    if (isActive()) return
    timer = setTimeout(() => {
      if (!isActive() && canRelease()) release()
    }, MAIN_WINDOW_IDLE_MS + 100)
  }
  target.addEventListener('lumi-window-activity', changed)
  target.addEventListener('visibilitychange', changed, true)
  changed()
  return () => {
    clearTimeout(timer)
    target.removeEventListener('lumi-window-activity', changed)
    target.removeEventListener('visibilitychange', changed, true)
  }
}
