// SPDX-License-Identifier: MPL-2.0
import { useEffect, useState } from 'react'
export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('lumi.theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'lumi.theme') setTheme(event.newValue === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e0e11' : '#f0f0ee')
    try {
      localStorage.setItem('lumi.theme', theme)
    } catch {
      /* Local display remains usable. */
    }
  }, [theme])
  return [theme, setTheme] as const
}
