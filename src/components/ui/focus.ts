// SPDX-License-Identifier: MPL-2.0
import { useEffect } from 'react'

const trackers = new WeakMap<Document, { users: number; release: () => void }>()

/** Share input intent with portal controls without changing focus or tab order. */
export function trackFocusInput(doc: Document) {
  const existing = trackers.get(doc)
  if (existing) {
    existing.users += 1
    return () => release(doc)
  }
  const root = doc.documentElement
  const attribute = 'data-ui-focus-input'
  const previous = root.getAttribute(attribute)
  root.setAttribute(attribute, 'keyboard')
  const pointer = () => root.setAttribute(attribute, 'pointer')
  const keyboard = (event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)
    )
      return
    root.setAttribute(attribute, 'keyboard')
  }
  const options = { capture: true }
  doc.addEventListener('pointerdown', pointer, options)
  doc.addEventListener('keydown', keyboard, options)
  trackers.set(doc, {
    users: 1,
    release: () => {
      doc.removeEventListener('pointerdown', pointer, options)
      doc.removeEventListener('keydown', keyboard, options)
      if (previous === null) root.removeAttribute(attribute)
      else root.setAttribute(attribute, previous)
    },
  })
  return () => release(doc)
}

function release(doc: Document) {
  const tracker = trackers.get(doc)
  if (!tracker || --tracker.users) return
  tracker.release()
  trackers.delete(doc)
}

export function useFocusInput() {
  useEffect(() => trackFocusInput(document), [])
}
