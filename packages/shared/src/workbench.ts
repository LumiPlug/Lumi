// SPDX-License-Identifier: MPL-2.0

import type { JsonObject, JsonSchema, JsonValue } from './json'
export type HomeManifest = {
  formatVersion: 2
  template: 'lumi-html-home'
  lumiVersion: string
  sdkVersion: string
  bridgeVersion: 1
  projectId: string
  name: string
  entry: 'index.html'
}
export type HomeFile = { path: string; encoding: 'base64' | 'utf8'; content: string }
export type HomeBundle = { manifest: HomeManifest; files: HomeFile[]; sourceFiles: HomeFile[] }
export type WorkbenchSnapshot = {
  version: number
  updatedAt: string | null
  bundle: HomeBundle | null
}
export type WorkbenchView = {
  version: number
  updatedAt: string | null
  manifest: HomeManifest | null
  compatible: boolean
  runtimeUrl: string | null
}
export type HomeTheme = {
  mode: 'dark' | 'light'
  reducedMotion: boolean
  tokens: Record<string, string>
}
export type HomeRpcRequest = { version: number; method: string; args: JsonObject }
export type HomeRpcResponse =
  { ok: true; data: JsonValue } | { ok: false; error: { code: string; message: string } }

export const HOME_LIMITS = {
  fileCount: 512,
  fileBytes: 4 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  requestBytes: 24 * 1024 * 1024,
  rpcBytes: 64 * 1024,
} as const
export const HOME_PAGE_BUILTINS = [
  'Lumi.get_context',
  'Lumi.list_capabilities',
  'Lumi.create_capability_draft',
  'Lumi.list_tasks',
  'Lumi.get_task',
  'Lumi.stop_task',
  'Lumi.restart_task',
] as const
export function emptyWorkbench(): WorkbenchSnapshot {
  return { version: 0, updatedAt: null, bundle: null }
}

const string: JsonSchema = { type: 'string' }
const file: JsonSchema = {
  type: 'object',
  properties: {
    path: { ...string, minLength: 1, maxLength: 240 },
    encoding: { ...string, enum: ['base64', 'utf8'] },
    content: { ...string, maxLength: 6 * 1024 * 1024 },
  },
  required: ['path', 'encoding', 'content'],
  additionalProperties: false,
}
export const homeBundleSchema: JsonSchema = {
  type: 'object',
  properties: {
    manifest: {
      type: 'object',
      properties: {
        formatVersion: { type: 'integer', const: 2 },
        template: { ...string, const: 'lumi-html-home' },
        lumiVersion: string,
        sdkVersion: string,
        bridgeVersion: { type: 'integer', const: 1 },
        projectId: {
          ...string,
          pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
        },
        name: { ...string, minLength: 1, maxLength: 100, pattern: '\\S' },
        entry: { ...string, const: 'index.html' },
      },
      required: [
        'formatVersion',
        'template',
        'lumiVersion',
        'sdkVersion',
        'bridgeVersion',
        'projectId',
        'name',
        'entry',
      ],
      additionalProperties: false,
    },
    files: { type: 'array', minItems: 1, maxItems: HOME_LIMITS.fileCount, items: file },
    sourceFiles: { type: 'array', minItems: 1, maxItems: HOME_LIMITS.fileCount, items: file },
  },
  required: ['manifest', 'files', 'sourceFiles'],
  additionalProperties: false,
}
