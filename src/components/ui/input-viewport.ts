// SPDX-License-Identifier: MPL-2.0
/** Reveal a full input value's suffix without taking focus or disturbing editing. */
export function revealInputEnd(input: HTMLInputElement): void {
  if (input.ownerDocument.activeElement === input) return
  if (['text', 'search', 'url', 'tel', 'password'].includes(input.type))
    input.setSelectionRange(input.value.length, input.value.length)
  input.scrollLeft = input.scrollWidth
}
