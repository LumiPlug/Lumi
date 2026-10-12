// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import { revealInputEnd } from '../components/ui/input-viewport'
function input() {
  const ownerDocument = { activeElement: {} }
  const element = {
    ownerDocument,
    type: 'text',
    value: '/很长的目录/项目🚀/gushan_server',
    scrollWidth: 800,
    scrollLeft: 0,
    setSelectionRange: vi.fn(),
  }
  return element
}
describe('long input suffix visibility', () => {
  it('reveals the suffix without truncating the value or taking focus', () => {
    const element = input()
    const value = element.value,
      activeElement = element.ownerDocument.activeElement
    revealInputEnd(element as unknown as HTMLInputElement)
    expect(element.scrollLeft).toBe(800)
    expect(element.setSelectionRange).toHaveBeenCalledWith(value.length, value.length)
    expect(element.value).toBe(value)
    expect(element.ownerDocument.activeElement).toBe(activeElement)
  })
  it('does not disturb scrolling or selection while the user is editing', () => {
    const element = input()
    element.scrollLeft = 32
    element.ownerDocument.activeElement = element
    revealInputEnd(element as unknown as HTMLInputElement)
    expect(element.scrollLeft).toBe(32)
    expect(element.setSelectionRange).not.toHaveBeenCalled()
  })
  it('does not try to select unsupported input types', () => {
    const element = input()
    element.type = 'number'
    revealInputEnd(element as unknown as HTMLInputElement)
    expect(element.setSelectionRange).not.toHaveBeenCalled()
  })
})
