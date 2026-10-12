// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef } from 'react'

type Preview = {
  row: HTMLTableRowElement
  layer: HTMLDivElement
  startY: number
  top: number
  animation?: Animation
}

/** Shared, inert row snapshot: real controls and their drafts stay mounted in the table. */
export function useTableDragPreview() {
  const preview = useRef<Preview | null>(null)
  function clear() {
    const current = preview.current
    if (!current) return
    preview.current = null
    current.animation?.cancel()
    current.row.classList.remove('ui-table-drag-source')
    current.layer.remove()
  }
  useEffect(() => clear, [])

  function begin(row: HTMLTableRowElement, y: number, viewport: HTMLElement) {
    clear()
    const table = row.closest('table')
    if (!table) return
    const box = row.getBoundingClientRect()
    const clip = viewport.getBoundingClientRect()
    const left = Math.max(box.left, clip.left + viewport.clientLeft)
    const right = Math.min(box.right, clip.left + viewport.clientLeft + viewport.clientWidth)
    if (right <= left) return
    const tableStyle = getComputedStyle(table)
    const [inlineSpacing = 0, blockSpacing = inlineSpacing] = tableStyle.borderSpacing
      .split(' ')
      .map(parseFloat)
    const layer = document.createElement('div')
    layer.className = 'ui-table-drag-preview'
    layer.setAttribute('aria-hidden', 'true')
    layer.inert = true
    layer.dataset.uiDepth =
      table.closest<HTMLElement>('[data-ui-depth]')?.dataset.uiDepth ?? 'heavy'
    Object.assign(layer.style, {
      left: `${left}px`,
      top: `${box.top - blockSpacing}px`,
      width: `${right - left}px`,
      height: `${box.height + 2 * blockSpacing}px`,
    })
    const snapshotTable = table.cloneNode(false) as HTMLTableElement
    Object.assign(snapshotTable.style, {
      width: `${box.width + 2 * inlineSpacing}px`,
      minWidth: '0',
      marginInlineStart: `${box.left - left - inlineSpacing}px`,
    })
    const columns = document.createElement('colgroup')
    for (const cell of row.cells) {
      const column = document.createElement('col')
      column.style.width = `${cell.getBoundingClientRect().width}px`
      columns.append(column)
    }
    const snapshot = row.cloneNode(true) as HTMLTableRowElement
    const originalInputs = row.querySelectorAll<HTMLInputElement>('input')
    snapshot.querySelectorAll<HTMLInputElement>('input').forEach((input, index) => {
      const original = originalInputs[index]
      if (original) {
        input.value = original.value
        input.checked = original.checked
      }
    })
    // No duplicate IDs, validation targets, form submission or accessibility controls.
    for (const element of [snapshotTable, snapshot, ...snapshot.querySelectorAll('*')]) {
      for (const attribute of [
        'id',
        'for',
        'name',
        'form',
        'data-validation',
        'data-parameter-row',
        'data-parameter-handle',
      ])
        element.removeAttribute(attribute)
    }
    const body = document.createElement('tbody')
    body.append(snapshot)
    snapshotTable.append(columns, body)
    layer.append(snapshotTable)
    document.body.append(layer)
    row.classList.add('ui-table-drag-source')
    preview.current = { row, layer, startY: y, top: box.top - blockSpacing }
  }
  function move(y: number) {
    const current = preview.current
    if (current) current.layer.style.transform = `translateY(${y - current.startY}px)`
  }
  function end(animate = true, onEnd?: () => void) {
    const current = preview.current
    if (!current) {
      onEnd?.()
      return
    }
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clear()
      onEnd?.()
      return
    }
    // React commits the final ordering before measuring the landing slot.
    requestAnimationFrame(() => {
      if (preview.current !== current) return
      if (!current.row.isConnected) {
        clear()
        onEnd?.()
        return
      }
      const spacing = parseFloat(getComputedStyle(current.row.closest('table')!).borderSpacing) || 0
      const target = current.row.getBoundingClientRect().top - spacing - current.top
      const styles = getComputedStyle(current.layer)
      current.animation = current.layer.animate(
        [
          { transform: current.layer.style.transform || 'translateY(0)' },
          { transform: `translateY(${target}px)` },
        ],
        {
          duration: parseFloat(styles.getPropertyValue('--lumi-motion-press')) || 100,
          easing: styles.getPropertyValue('--lumi-ease-out').trim() || 'ease-out',
          fill: 'forwards',
        },
      )
      current.animation.onfinish = () => {
        if (preview.current === current) {
          clear()
          onEnd?.()
        }
      }
    })
  }
  return { begin, move, end }
}
