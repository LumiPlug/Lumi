// SPDX-License-Identifier: MPL-2.0

import { invoke } from '@tauri-apps/api/core'
export function knowledgeRequest<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return hostInvoke<T>('knowledge_request', { action, payload })
}
import type {
  CapabilityDraftKind,
  CapabilitySummary,
  HomeRpcRequest,
  HomeRpcResponse,
  McpConnectionInfo,
  McpConnectionCheck,
  McpPortSettings,
  UiCoreStatus,
  WorkbenchView,
  SkillInventory,
  SkillDirectory,
  SkillFilePreview,
} from '@lumiplug/shared'

declare global {
  interface Window {
    readonly __LUMI_HOST_NONCE__?: string
  }
}
export function hostInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(command, { ...args, hostNonce: window.__LUMI_HOST_NONCE__ ?? '' })
}
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
    return await hostInvoke('get_core_status')
  } catch {
    return disconnectedStatus
  }
}
export async function getMcpConnectionInfo(): Promise<McpConnectionInfo | null> {
  try {
    return await hostInvoke('get_mcp_connection_info')
  } catch {
    return null
  }
}
export function checkMcpConnection(): Promise<McpConnectionCheck> {
  return hostInvoke('check_mcp_connection')
}
export function getWorkbench(): Promise<WorkbenchView> {
  return hostInvoke('get_workbench')
}
export function workbenchRpc(request: HomeRpcRequest): Promise<HomeRpcResponse> {
  return hostInvoke('workbench_rpc', request)
}
export async function listCapabilities(): Promise<CapabilitySummary[]> {
  try {
    return await hostInvoke('list_capabilities')
  } catch {
    return []
  }
}
export function createCapabilityDraft(
  kind: CapabilityDraftKind,
  name: string,
): Promise<CapabilitySummary> {
  return hostInvoke('create_capability_draft', { kind, name })
}

export function skillsRequest(
  action: 'list' | 'scan' | 'archive' | 'project' | 'import',
  payload: Record<string, unknown> | null = null,
): Promise<SkillInventory> {
  return hostInvoke('skills_request', { action, payload })
}
export function openSkillSource(url: string): Promise<void> {
  return hostInvoke('open_skill_source', { url })
}

export function getSkillDirectory(id: string): Promise<SkillDirectory> {
  return hostInvoke('skills_request', { action: 'directory', payload: { id } })
}
export function getSkillFile(id: string, path: string): Promise<SkillFilePreview> {
  return hostInvoke('skills_request', { action: 'file', payload: { id, path } })
}
export function openSkillLink(url: string): Promise<void> {
  return hostInvoke('open_skill_link', { url })
}

export function getMcpPortSettings(): Promise<McpPortSettings> {
  return hostInvoke('get_mcp_port_settings')
}
export function setMcpPort(port: number): Promise<McpPortSettings> {
  return hostInvoke('set_mcp_port', { port })
}

export function refreshMcpToken(): Promise<McpConnectionInfo> {
  return hostInvoke('refresh_mcp_token')
}
