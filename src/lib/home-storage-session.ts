// SPDX-License-Identifier: MPL-2.0

let fallback: string | undefined
export function homeStorageSession(): string {
  const key = 'lumi.home.storage-session'
  try {
    const existing = window.sessionStorage.getItem(key)
    if (
      existing &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(existing)
    )
      return existing
    const id = crypto.randomUUID()
    window.sessionStorage.setItem(key, id)
    return id
  } catch {
    // Still isolate this window if the host WebView disables sessionStorage.
    return (fallback ??= crypto.randomUUID())
  }
}
