// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpConnectionInfo, WorkbenchView } from '@lumiplug/shared'
import { refreshRunState } from './run-task-refresh'
import { getWorkbench } from './tauri'

export function useWorkbenchDocument(connection: McpConnectionInfo | null, active: boolean) {
  const [view, setView] = useState<WorkbenchView | null>(null)
  const [loadError, setLoadError] = useState(false)
  const requestEpoch = useRef(0)
  const reading = useRef<Promise<boolean> | null>(null)
  const ready = connection?.coreState === 'ready'
  const refresh = useCallback(() => {
    if (!ready) return Promise.resolve(false)
    if (reading.current) return reading.current
    const epoch = requestEpoch.current
    const pending = (async () => {
      try {
        const next = await getWorkbench()
        if (epoch !== requestEpoch.current) return false
        setView((current) => (!current || next.version >= current.version ? next : current))
        setLoadError(false)
        return true
      } catch {
        if (epoch === requestEpoch.current) setLoadError(true)
        return false
      } finally {
        if (epoch === requestEpoch.current) reading.current = null
      }
    })()
    reading.current = pending
    return pending
  }, [ready])
  useEffect(() => {
    requestEpoch.current += 1
    reading.current = null
    if (!active || !ready) return
    const stop = refreshRunState({
      wakeTarget: window,
      interval: 2000,
      read: refresh,
      update: () => {},
      fail: () => {},
    })
    return () => {
      requestEpoch.current += 1
      stop()
    }
  }, [active, ready, connection?.endpoint, connection?.sessionToken, refresh])
  const accept = (next: WorkbenchView) => {
    setView((current) => (!current || next.version >= current.version ? next : current))
    setLoadError(false)
  }
  return { view, loadError, ready, refresh, accept }
}
