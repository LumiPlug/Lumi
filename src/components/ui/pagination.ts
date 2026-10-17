// SPDX-License-Identifier: MPL-2.0
export function paginationItems(page: number, pages: number): (number | 'start-gap' | 'end-gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, 'end-gap', pages]
  if (page >= pages - 3) return [1, 'start-gap', pages - 4, pages - 3, pages - 2, pages - 1, pages]
  return [1, 'start-gap', page - 1, page, page + 1, 'end-gap', pages]
}
