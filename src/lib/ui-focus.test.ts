// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { trackFocusInput } from '../components/ui/focus'

function focusDocument(initial?: string) {
  const attributes = new Map<string, string>()
  if (initial) attributes.set('data-ui-focus-input', initial)
  const doc = Object.assign(new EventTarget(), {
    documentElement: {
      getAttribute: (key: string) => attributes.get(key) ?? null,
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
    },
  }) as unknown as Document
  return { doc, mode: () => attributes.get('data-ui-focus-input') }
}
function key(doc: Document, key: string, options = {}) {
  doc.dispatchEvent(Object.assign(new Event('keydown'), { key, ...options }))
}

describe('shared focus input intent', () => {
  it('switches from pointer to keyboard on navigation without moving focus', () => {
    const { doc, mode } = focusDocument()
    const stop = trackFocusInput(doc)
    doc.dispatchEvent(new Event('pointerdown'))
    expect(mode()).toBe('pointer')
    key(doc, 'Tab', { shiftKey: true })
    expect(mode()).toBe('keyboard')
    doc.dispatchEvent(new Event('pointerdown'))
    key(doc, 'ArrowRight')
    expect(mode()).toBe('keyboard')
    stop()
    expect(mode()).toBeUndefined()
  })
  it('ignores shortcuts, modifier keys and composition when deciding focus appearance', () => {
    const { doc, mode } = focusDocument()
    const stop = trackFocusInput(doc)
    doc.dispatchEvent(new Event('pointerdown'))
    key(doc, 'Shift')
    key(doc, 'c', { metaKey: true })
    key(doc, 'Process', { isComposing: true })
    expect(mode()).toBe('pointer')
    key(doc, 'Enter')
    expect(mode()).toBe('keyboard')
    stop()
  })
  it('keeps the tracker active for nested surfaces and restores its previous attribute on teardown', () => {
    const { doc, mode } = focusDocument('previous')
    const stopOuter = trackFocusInput(doc)
    const stopInner = trackFocusInput(doc)
    stopInner()
    doc.dispatchEvent(new Event('pointerdown'))
    expect(mode()).toBe('pointer')
    stopOuter()
    expect(mode()).toBe('previous')
    key(doc, 'Tab')
    doc.dispatchEvent(new Event('pointerdown'))
    expect(mode()).toBe('previous')
  })
})
