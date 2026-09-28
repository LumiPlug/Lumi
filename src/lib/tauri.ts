// SPDX-License-Identifier: MPL-2.0

import { invoke } from '@tauri-apps/api/core'
import type {
  CapabilityDraftKind,
  CapabilitySummary,
  McpConnectionInfo,
  McpConnectionCheck,
  UiCoreStatus,
} from '@lumiplug/shared'

export const disconnectedStatus: UiCoreStatus = {
  state: 'disconnected',
  protocolVersion: 1,
  coreVersion: null,
  userDataPathAvailable: false,
  restartCount: 0,
  lastError: null,
}

export async function getCoreStatus(): Promise<UiCoreStatus> {
  try {
    return await invoke<UiCoreStatus>('get_core_status')
  } catch {
    return disconnectedStatus
  }
}

export async function getMcpConnectionInfo(): Promise<McpConnectionInfo | null> {
  try {
    return await invoke<McpConnectionInfo>('get_mcp_connection_info')
  } catch {
    return null
  }
}

export async function checkMcpConnection(): Promise<McpConnectionCheck> {
  return invoke<McpConnectionCheck>('check_mcp_connection')
}

export async function listCapabilities(): Promise<CapabilitySummary[]> {
  try {
    return await invoke<CapabilitySummary[]>('list_capabilities')
  } catch {
    return []
  }
}

export async function createCapabilityDraft(
  kind: CapabilityDraftKind,
  name: string,
): Promise<CapabilitySummary> {
  return invoke<CapabilitySummary>('create_capability_draft', { kind, name })
}
