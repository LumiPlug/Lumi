// SPDX-License-Identifier: MPL-2.0

import type { Duplex } from 'node:stream'

export const BROWSER_WEBSOCKET_ENDPOINT = 'ws://127.0.0.1:43127/ws'
export interface BrowserTransport {
  start(accept: (socket: Duplex) => void): Promise<void>
  stop(): Promise<void>
  status(): { paired: boolean; enrollmentExpiresAt: string | null }
  resetPairing(): Promise<void>
  openEnrollment(): void
}
