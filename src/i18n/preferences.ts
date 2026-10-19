// SPDX-License-Identifier: MPL-2.0
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { hostInvoke } from '../lib/tauri'
import { applyLocale, isLocale, localeStorageKey } from '.'
import type { Locale } from '.'

export async function saveLocale(value: Locale): Promise<void> {
  if (!isLocale(value)) throw new Error('invalid_locale')
  if (isTauri()) {
    const saved = await hostInvoke<Locale>('set_ui_locale', { locale: value })
    if (!isLocale(saved)) throw new Error('invalid_locale')
    applyLocale(saved)
    // Native persistence is authoritative; this cache is best-effort only.
    try {
      window.localStorage.setItem(localeStorageKey, saved)
    } catch {
      /* Native value is saved. */
    }
  } else {
    window.localStorage.setItem(localeStorageKey, value)
    applyLocale(value)
  }
}

/** Subscribe before reading so a concurrent preference change cannot be lost. */
export async function connectLocale(onFailure: () => void): Promise<() => void> {
  if (!isTauri()) {
    const storage = (event: StorageEvent) => {
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return
      if (event.key === localeStorageKey || event.key === null)
        applyLocale(isLocale(event.newValue) ? event.newValue : 'zh-CN')
    }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }
  let revision = 0
  const dispose = await listen<Locale>('lumi-locale-changed', ({ payload }) => {
    if (!isLocale(payload)) return
    revision++
    applyLocale(payload)
  })
  try {
    const readingAt = revision
    const saved = await hostInvoke<Locale>('get_ui_locale')
    if (readingAt === revision) applyLocale(saved)
  } catch {
    // Retain the preloaded locale rather than resetting an existing preference.
    onFailure()
  }
  return dispose
}
