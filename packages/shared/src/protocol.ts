// SPDX-License-Identifier: MPL-2.0

import { HOME_CONTRACT } from './home-contract'

export const CORE_VERSION = HOME_CONTRACT.lumiVersion
export const CORE_PROTOCOL_VERSION = 1
export const DEFAULT_MCP_PORT = 38491
export interface McpPortSettings {
  defaultPort: number
  configuredPort: number
  activePort: number
}
export const LOOPBACK_HOST = '127.0.0.1'
export const SESSION_TOKEN_HEADER = 'x-lumiplug-session-token'
export const SESSION_TOKEN_ENV = 'LUMIPLUG_SESSION_TOKEN'

export interface SidecarReadyHandshake {
  kind: 'sidecar.ready'
  protocolVersion: number
  coreVersion: string
  port: number
  pid: number
}

export interface CoreHealth {
  status: 'ok'
  protocolVersion: number
  coreVersion: string
  pid: number
  readyAt: string
}

export type CoreLifecycleState =
  'disconnected' | 'error' | 'ready' | 'restarting' | 'starting' | 'stopping' | 'stopped'

export interface UiCoreStatus {
  state: CoreLifecycleState
  protocolVersion: number
  coreVersion: string | null
  userDataPathAvailable: boolean
  restartCount: number
  lastError: string | null
  canStart?: boolean
  canStop?: boolean
}

export type DesktopAction =
  | 'open'
  | 'usage'
  | 'skills'
  | 'knowledge'
  | 'core-status'
  | 'core-start'
  | 'core-stop'
  | 'settings'
export interface DesktopRequest {
  id: string
  action: DesktopAction
  coreGeneration: number
}

/** Credentials persist in native app storage; never store them in frontend storage. */
export interface McpConnectionInfo {
  endpoint: string
  authHeader: string
  sessionToken: string
  coreState: CoreLifecycleState
  stdioCommand: string | null
}

export interface McpConnectionCheck {
  /** Successful external tool discovery/call in this Core session; not a live connection. */
  lastExternalActivityAt: string | null
  ok: boolean
  serverName: string | null
  serverVersion: string | null
  toolCount: number
  error: string | null
}

export interface CoreError {
  code: string
  message: string
}

export interface CoreResponse<TData> {
  ok: boolean
  requestId: string
  data?: TData
  error?: CoreError
}
