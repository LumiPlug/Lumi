// SPDX-License-Identifier: MPL-2.0
import { useSyncExternalStore } from 'react'
import zhCN from './zh-CN.json'
import en from './en.json'

export type Locale = 'zh-CN' | 'en'
export type MessageKey = keyof typeof zhCN
// Source-language keys are checked at call sites; values always remain plain text.
const english: Record<MessageKey, string> = en
const generatedMessages = new Map<string, { key: MessageKey; values?: Record<string, unknown> }>()
const englishKeys = new Map(Object.entries(en).map(([key, value]) => [value, key as MessageKey]))
export const localeStorageKey = 'lumi.locale'
export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en'
}
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN'
  if (isLocale(window.__LUMI_LOCALE__)) return window.__LUMI_LOCALE__
  try {
    const saved = window.localStorage.getItem(localeStorageKey)
    return isLocale(saved) ? saved : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}
let locale = initialLocale()
const listeners = new Set<() => void>()
export function getLocale(): Locale {
  return locale
}
function updateDocument(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
/** Receives only validated host or storage preferences. Does not remount any UI. */
export function applyLocale(value: unknown): void {
  if (!isLocale(value)) return
  const changed = locale !== value
  locale = value
  updateDocument()
  if (changed) for (const listener of listeners) listener()
}
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

type ParametersIn<S extends string> = S extends `${string}{v${infer I}}${infer Rest}`
  ? `v${I}` | ParametersIn<Rest>
  : never
type MessageArguments<K extends MessageKey> = [ParametersIn<K>] extends [never]
  ? []
  : [values: Record<ParametersIn<K>, unknown>]
export function t<K extends MessageKey>(key: K, ...args: MessageArguments<K>): string {
  const text = (locale === 'en' ? english[key] : zhCN[key]) ?? zhCN[key]
  const values = args[0] as Record<string, unknown> | undefined
  // One pass: inserted user text (including braces) is never reinterpreted.
  const pattern = text.replace(
    /\{(v\d+)\|([^|{}]*)\|([^{}]*)\}/g,
    (_, name: string, one: string, other: string) =>
      new Intl.PluralRules(locale).select(Number(values?.[name])) === 'one' ? one : other,
  )
  const result = pattern.replace(/\{(v\d+)\}/g, (token, name: string) =>
    values && Object.hasOwn(values, name) ? String(values[name]) : token,
  )
  if (generatedMessages.size >= 1024)
    generatedMessages.delete(generatedMessages.keys().next().value!)
  generatedMessages.set(result, { key, values })
  return result
}
/** Only for known host error messages, never user names, documents, or logs. */
export function translateKnown(message: string): string {
  const generated = generatedMessages.get(message)
  const key =
    generated?.key ??
    (Object.hasOwn(zhCN, message) ? (message as MessageKey) : englishKeys.get(message))
  if (!key) return message
  // Re-render stored application feedback in the current language. Never called
  // on business names, document bodies, stdout, stderr, or third-party results.
  const translate = t as (key: MessageKey, values?: Record<string, unknown>) => string
  return translate(key, generated?.values)
}
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale).format(value)
}
export function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(date)
}
updateDocument()
