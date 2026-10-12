// SPDX-License-Identifier: MPL-2.0

import type { HomeTheme, JsonObject } from '@lumiplug/shared'
export const HOME_METHODS = new Set([
  'context.get',
  'capabilities.list',
  'tools.list',
  'tools.call',
  'storage.get',
  'storage.set',
  'storage.delete',
  'toast.show',
])
export function homeBridgeRequest(
  value: unknown,
): { id: number; method: string; args: JsonObject } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(request.id) ||
    (request.id as number) < 1 ||
    typeof request.method !== 'string' ||
    !HOME_METHODS.has(request.method) ||
    !request.args ||
    typeof request.args !== 'object' ||
    Array.isArray(request.args)
  )
    return null
  try {
    if (new TextEncoder().encode(JSON.stringify(request)).length > 64 * 1024) return null
  } catch {
    return null
  }
  return request as { id: number; method: string; args: JsonObject }
}
export function readHomeTheme(): HomeTheme {
  const style = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  const aliases = new Set([
    '--bg',
    '--content-card',
    '--panel',
    '--hover',
    '--input',
    '--line',
    '--text',
    '--secondary',
    '--quiet',
    '--accent',
    '--accent-bg',
    '--button',
    '--button-text',
  ])
  for (let index = 0; index < style.length; index += 1) {
    const key = style.item(index)
    if (key.startsWith('--lumi-') || aliases.has(key))
      tokens[key] = style.getPropertyValue(key).trim()
  }
  return {
    mode: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    tokens,
  }
}
