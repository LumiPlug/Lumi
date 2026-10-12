// SPDX-License-Identifier: MPL-2.0
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
}: {
  read: () => Promise<T>
  update: (value: T) => void
  fail: () => void
  interval: number
  wakeTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
}): () => void {
  let disposed = false
  let reading = false
  let wakePending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    if (disposed) return
    if (reading) {
      wakePending = true
      return
    }
    clearTimeout(timer)
    reading = true
    try {
      const value = await read()
      if (!disposed) update(value)
    } catch {
      if (!disposed) fail()
    } finally {
      reading = false
      if (!disposed) {
        const delay = wakePending ? 0 : interval
        wakePending = false
        timer = setTimeout(() => void refresh(), delay)
      }
    }
  }
  const wake = () => void refresh()
  wakeTarget?.addEventListener('focus', wake)
  wakeTarget?.addEventListener('visibilitychange', wake, true)
  void refresh()
  return () => {
    disposed = true
    clearTimeout(timer)
    wakeTarget?.removeEventListener('focus', wake)
    wakeTarget?.removeEventListener('visibilitychange', wake, true)
  }
}
