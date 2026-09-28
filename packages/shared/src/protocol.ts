// SPDX-License-Identifier: MPL-2.0

import type { CapabilityDraftKind, CapabilitySummary } from './capability'
import type { JsonSchema, JsonValue } from './json'

export const CORE_VERSION = '0.1.0'
export const CORE_PROTOCOL_VERSION = 1
export const LOOPBACK_HOST = '127.0.0.1'
export const SESSION_TOKEN_HEADER = 'x-lumiplug-session-token'
export const SESSION_TOKEN_ENV = 'LUMIPLUG_SESSION_TOKEN'

export interface CoreLaunchConfig {
  host: typeof LOOPBACK_HOST
  port: number
  sessionToken: string
  userDataDir: string
  parentPid: number
}

export interface SidecarReadyHandshake {
  kind: 'sidecar.ready'
  protocolVersion: number
  coreVersion: string
  port: number
  pid: number
  mcpAvailable: boolean
}

export interface CoreHealth {
  status: 'ok'
  protocolVersion: number
  coreVersion: string
  pid: number
  readyAt: string
}

export type CoreLifecycleState =
  'disconnected' | 'error' | 'ready' | 'restarting' | 'starting' | 'stopped'

export interface UiCoreStatus {
  state: CoreLifecycleState
  protocolVersion: number
  coreVersion: string | null
  userDataPathAvailable: boolean
  restartCount: number
  lastError: string | null
}

/** Current desktop session only. Never persist this credential in UI storage. */
export interface McpConnectionInfo {
  transport: 'streamable-http'
  endpoint: string
  authHeader: string
  sessionToken: string
  gatewayAvailable: boolean
  coreState: CoreLifecycleState
  stdioCommand: string | null
}

export interface McpConnectionCheck {
  ok: boolean
  serverName: string | null
  serverVersion: string | null
  toolCount: number
  error: string | null
}

export interface CoreAppStatus {
  state: 'ready'
  protocolVersion: number
  coreVersion: string
  userDataPathAvailable: boolean
  capabilityCount: number
}

export interface CoreRequest<TBody extends JsonValue | undefined = JsonValue | undefined> {
  id: string
  method: 'GET' | 'POST'
  path: `/app/${string}`
  body?: TBody
}

export interface CoreError {
  code: string
  message: string
}

export interface CoreResponse<TData = JsonValue | undefined> {
  ok: boolean
  requestId: string
  data?: TData
  error?: CoreError
}

export type CoreEvent =
  | { type: 'core.status'; status: UiCoreStatus }
  | { type: 'capability.changed'; capability: CapabilitySummary }
  | { type: 'sidecar.ready'; handshake: SidecarReadyHandshake }

export interface ListCapabilitiesData {
  capabilities: CapabilitySummary[]
}

export interface CreateDraftData {
  capability: CapabilitySummary
}

export interface CapabilityDraftRequest {
  kind: CapabilityDraftKind
  name: string
  namespace?: string
}

export interface JsonSchemaEnvelope {
  schema: JsonSchema
}
