// SPDX-License-Identifier: MPL-2.0

import { isTauri } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

export async function copyText(text: string): Promise<boolean> {
  if (isTauri()) {
    try {
      await writeText(text)
      return true
    } catch {
      return false
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older desktop webviews can still copy within the user's button action.
    const previous = document.activeElement
    const field = document.createElement('textarea')
    field.value = text
    field.style.position = 'fixed'
    field.style.left = '-10000px'
    document.body.append(field)
    field.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    } finally {
      field.remove()
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
    }
    return copied
  }
}
