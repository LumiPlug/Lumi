// SPDX-License-Identifier: MPL-2.0

export interface BrowserUserSession {
  id: string
  tabId: number
  title: string
  url: string
  origin: string
  state: string
}

export interface BrowserUserStatus {
  enabled: boolean
  extensionId: string | null
  connectedHosts: number
  sessions: BrowserUserSession[]
  controlDomain: 'shared-lumi'
  registration: {
    registered: boolean
    supported: boolean
    nativeHostPath: string
    issues: string[]
  }
  issues: string[]
}

export type BrowserUserAction = 'enable' | 'disable' | 'repair' | 'diagnose' | 'remove'
export interface BrowserUserActionRequest {
  action: BrowserUserAction
  extensionId?: string
  confirmed?: boolean
}
