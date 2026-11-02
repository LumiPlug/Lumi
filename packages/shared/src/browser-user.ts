// SPDX-License-Identifier: MPL-2.0

export interface BrowserUserSession {
  id: string
  tabId: number
  title: string
  url: string
  origin: string
  state: string
}

export interface BrowserPageRule {
  url: string
  label: string
  permission: 'allow' | 'block'
}

export interface BrowserUserStatus {
  enabled: boolean
  requiresAuthorization: boolean
  blockedUrls: string[]
  pageRules: BrowserPageRule[]
  rulesRevision: number
  extensionId: string | null
  connectedHosts: number
  sessions: BrowserUserSession[]
  controlDomain: 'shared-lumi'
  transport: 'loopback-websocket'
  endpoint: string
  paired: boolean
  pairing: { id: string; code: string; expiresAt: string } | null
  issues: string[]
}

export type BrowserUserAction =
  | 'enable'
  | 'disable'
  | 'diagnose'
  | 'approvePairing'
  | 'resetPairing'
  | 'setBlockedUrls'
  | 'setPageRules'
export interface BrowserUserActionRequest {
  action: BrowserUserAction
  extensionId?: string
  confirmed?: boolean
  pairingId?: string
  pairingCode?: string
  scopeConfirmed?: boolean
  blockedUrls?: string[]
  pageRules?: BrowserPageRule[]
  expectedRulesRevision?: number
}
