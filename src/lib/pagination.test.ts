// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { paginationItems } from '../components/ui/pagination'

describe('pagination page window', () => {
  it('keeps seven slots across every page, including both ellipsis transitions', () => {
    for (const pages of [8, 9, 12, 124, 1000]) {
      for (let page = 1; page <= pages; page++) {
        const items = paginationItems(page, pages)
        const numbers = items.filter((item): item is number => typeof item === 'number')
        expect(items).toHaveLength(7)
        expect(numbers[0]).toBe(1)
        expect(numbers.at(-1)).toBe(pages)
        expect(numbers).toContain(page)
        expect(new Set(items).size).toBe(items.length)
        expect(numbers.every((value, index) => index === 0 || value > numbers[index - 1]!)).toBe(true)
        if (page > 1) expect(numbers).toContain(page - 1)
        if (page < pages) expect(numbers).toContain(page + 1)
      }
    }
  })

  it('shows every page without ellipses for short lists and the empty one-page state', () => {
    for (let pages = 1; pages <= 7; pages++) {
      for (let page = 1; page <= pages; page++) {
        expect(paginationItems(page, pages)).toEqual(
          Array.from({ length: pages }, (_, index) => index + 1),
        )
      }
    }
  })
})
