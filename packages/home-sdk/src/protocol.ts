// SPDX-License-Identifier: MPL-2.0

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Tool = {
  name: string
  description: string
  inputSchema: Record<string, Json>
  outputSchema: Record<string, Json>
}
export type Capability = {
  id: string
  name: string
  namespace: string
  description: string
  version: number
  status: string
  enabled: boolean
  toolCount: number
}
export type Theme = {
  mode: 'dark' | 'light'
  reducedMotion: boolean
  tokens: Record<string, string>
}
export type HostInfo = {
  lumiVersion: string
  sdkVersion: string
  bridgeVersion: number
  projectId: string
  mode: 'lumi' | 'mock'
}
export type Reply =
  | { id: number; ok: true; data: Json }
  | { id: number; ok: false; error: { code: string; message: string } }
export class LumiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LumiError'
  }
}
