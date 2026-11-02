// SPDX-License-Identifier: MPL-2.0

/** Exact HTTP(S) link identity: query/fragment are not authorization boundaries. */
export function normalizeBrowserUrl(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('browser_url_invalid')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('browser_url_invalid')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('browser_url_invalid')
  }
  return parsed.origin + parsed.pathname
}

export function normalizeBrowserBlockedUrls(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new Error('browser_blocked_urls_invalid')
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || value.length > 2048)
      throw new Error('browser_blocked_urls_invalid')
    const url = normalizeBrowserUrl(value)
    if (url.length > 2048) throw new Error('browser_blocked_urls_invalid')
    return url
  })
  return [...new Set(normalized)].sort()
}

/** Changing from per-tab authorization to all ordinary pages needs fresh consent. */
export const BROWSER_SCOPE_CONSENT_VERSION = 2
