// SPDX-License-Identifier: MPL-2.0

import { isTauri } from '@tauri-apps/api/core'
import { hostInvoke } from './tauri'

export async function copyText(text: string): Promise<boolean> {
  if (isTauri()) {
    try {
      await hostInvoke('copy_text', { text })
      return true
    } catch {
      return false
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
