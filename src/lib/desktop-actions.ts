// SPDX-License-Identifier: MPL-2.0
import type { DesktopRequest } from '@lumiplug/shared'

/** Subscribe before reading; acknowledge after handling. Events racing an IPC read
 * request another drain, so startup/recreated windows never lose native actions. */
export function connectDesktopActions({
  subscribe,
  read,
  acknowledge,
  handle,
  fail,
  delivered = new Set<string>(),
}: {
  subscribe: (wake: () => void) => Promise<() => void>
  read: () => Promise<DesktopRequest | null>
  acknowledge: (id: string) => Promise<void>
  handle: (request: DesktopRequest) => void
  fail: () => void
  delivered?: Set<string>
}): () => void {
  let disposed = false
  let draining = false
  let dirty = false
  let unsubscribe: (() => void) | undefined
  const wake = () => {
    dirty = true
    if (draining || disposed) return
    draining = true
    void (async () => {
      try {
        while (!disposed && dirty) {
          dirty = false
          while (!disposed) {
            const request = await read()
            if (disposed || !request) break
            if (!delivered.has(request.id)) {
              handle(request)
              delivered.add(request.id)
              if (delivered.size > 128) delivered.delete(delivered.values().next().value!)
            }
            await acknowledge(request.id)
          }
        }
      } catch {
        if (!disposed) fail()
      } finally {
        draining = false
        if (dirty && !disposed) wake()
      }
    })()
  }
  void subscribe(wake)
    .then((dispose) => {
      if (disposed) dispose()
      else {
        unsubscribe = dispose
        wake()
      }
    })
    .catch(() => {
      if (!disposed) fail()
    })
  return () => {
    disposed = true
    unsubscribe?.()
  }
}
