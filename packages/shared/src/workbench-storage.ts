// SPDX-License-Identifier: MPL-2.0

export const HOME_STORAGE_LIMITS = {
  keys: 4096,
  keyBytes: 1024,
  valueBytes: 1024 * 1024,
  totalBytes: 5 * 1024 * 1024,
  sdkValueBytes: 256 * 1024,
  rpcBytes: 8 * 1024 * 1024,
  sessions: 32,
} as const

export function homeRpcByteLimit(method: string): number {
  return ['storage.set', 'storage.native'].includes(method)
    ? HOME_STORAGE_LIMITS.rpcBytes
    : 64 * 1024
}

export type HomeStorageArea = 'local' | 'session'
export type HomeStorageMutation =
  | { area: HomeStorageArea; operation: 'set'; key: string; value: string }
  | { area: HomeStorageArea; operation: 'delete'; key: string }
  | { area: HomeStorageArea; operation: 'clear' }
export type HomeStorageSnapshot = {
  local: [string, string][]
  session: [string, string][]
}
