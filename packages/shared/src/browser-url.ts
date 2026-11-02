// SPDX-License-Identifier: MPL-2.0

import type { BrowserPageRule } from './browser-user'

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

/** Normalize the complete rule table; duplicate exact links are ambiguous, not last-write-wins. */
export function normalizeBrowserPageRules(values: unknown): BrowserPageRule[] {
  if (!Array.isArray(values) || values.length > 100) throw new Error('browser_page_rules_invalid')
  const seen = new Set<string>()
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['url', 'label', 'permission'].includes(key)) ||
        typeof value.url !== 'string' || value.url.length > 2048 ||
        typeof value.label !== 'string' || value.label.length > 120 ||
        !['allow', 'block'].includes(value.permission)) throw new Error('browser_page_rules_invalid')
    const url = normalizeBrowserUrl(value.url)
    if (url.length > 2048 || seen.has(url)) throw new Error('browser_page_rules_invalid')
    seen.add(url)
    return {url, label: value.label.trim(), permission: value.permission as 'allow' | 'block'}
  })
}

export function browserBlockedUrlsFromRules(rules: BrowserPageRule[]): string[] {
  return normalizeBrowserBlockedUrls(rules.filter(rule => rule.permission === 'block').map(rule => rule.url))
}
