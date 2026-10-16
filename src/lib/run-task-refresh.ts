// SPDX-License-Identifier: MPL-2.0
import { activityEvent, windowIsActive } from './window-activity'
import type { ToolTask } from '@lumiplug/shared'

/** Keep a complete selected task even when an earlier metadata list predates its creation. */
export function completeTaskSnapshot(
  metadata: ToolTask[],
  full: ToolTask | null,
  capabilityId: string,
): ToolTask[] {
  if (!full) return metadata
  if (full.capabilityId !== capabilityId) throw new Error('task_not_found')
  return metadata.some((task) => task.id === full.id)
    ? metadata.map((task) => (task.id === full.id ? full : task))
    : [full, ...metadata]
}

/** One read in flight. Wake-ups coalesce; disposal rejects late reads and clears all listeners. */
export function refreshRunState<T>({
  read,
  update,
  fail,
  interval,
  wakeTarget,
  isActive = windowIsActive,
  shouldPoll = () => true,
}: {
  read: () => Promise<T>
  update: (value: T) => void
  fail: () => void
  interval: number | ((value: T) => number)
  isActive?: () => boolean
  shouldPoll?: (value: T) => boolean
  wakeTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
}): () => void {
  let disposed = false
  let reading = false
  let wakePending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    if (disposed || !isActive()) return
    if (reading) {
      wakePending = true
      return
    }
    clearTimeout(timer)
    reading = true
    let nextInterval = typeof interval === 'number' ? interval : 2000
    let continuing = true
    try {
      const value = await read()
      continuing = shouldPoll(value)
      nextInterval = typeof interval === 'number' ? interval : interval(value)
      if (!disposed) update(value)
    } catch {
      if (!disposed) fail()
    } finally {
      reading = false
      if (!disposed && isActive() && (continuing || wakePending)) {
        const delay = wakePending ? 0 : nextInterval
        wakePending = false
        timer = setTimeout(() => void refresh(), delay)
      }
    }
  }
  const wake = () => {
    clearTimeout(timer)
    wakePending = false
    if (isActive()) void refresh()
  }
  wakeTarget?.addEventListener('focus', wake)
  wakeTarget?.addEventListener('visibilitychange', wake, true)
  wakeTarget?.addEventListener(activityEvent, wake)
  void refresh()
  return () => {
    disposed = true
    clearTimeout(timer)
    wakeTarget?.removeEventListener('focus', wake)
    wakeTarget?.removeEventListener('visibilitychange', wake, true)
    wakeTarget?.removeEventListener(activityEvent, wake)
  }
}
