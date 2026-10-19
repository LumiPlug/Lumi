// SPDX-License-Identifier: MPL-2.0
import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import type { CapabilityField } from '@lumiplug/shared'
import { moveParameter } from './tool-parameters'
import { useTableDragPreview } from '../components/ui'

type Drag = {
  id: number
  pointerId: number
  x: number
  y: number
  startY: number
  originalIds: number[]
  moved: boolean
}

/** Keep row identity and local input drafts attached during reordering. */
export function useParameterOrder({
  fields,
  rowIds,
  viewport,
  change,
  disabled,
}: {
  fields: CapabilityField[]
  rowIds: RefObject<number[]>
  viewport: RefObject<HTMLDivElement | null>
  change: (fields: CapabilityField[]) => void
  disabled: boolean
}) {
  const latest = useRef({ fields, change, disabled })
  latest.current = { fields, change, disabled }
  const drag = useRef<Drag | null>(null)
  const preview = useTableDragPreview()
  const frame = useRef<number | null>(null)
  const [movingId, setMovingId] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')

  function move(id: number, target: number) {
    const from = rowIds.current.indexOf(id)
    const next = moveParameter(latest.current.fields, from, target)
    if (next === latest.current.fields) return false
    rowIds.current = moveParameter(rowIds.current, from, target)
    // Pointer frames may run before React has committed the previous move.
    latest.current = { ...latest.current, fields: next }
    latest.current.change(next)
    return true
  }
  function focus(id: number) {
    requestAnimationFrame(() => {
      const handle = viewport.current?.querySelector<HTMLElement>(`[data-parameter-handle="${id}"]`)
      handle?.focus({ preventScroll: true })
      handle?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    })
  }
  function announce(id: number) {
    const index = rowIds.current.indexOf(id)
    const field = latest.current.fields[index]
    if (field)
      setAnnouncement(
        t('{v0}已移至第 {v1} 项，共 {v2} 项。', {
          v0: field.key,
          v1: index + 1,
          v2: latest.current.fields.length,
        }),
      )
  }

  useEffect(() => {
    function finish(cancelled: boolean) {
      const current = drag.current
      if (!current) return
      drag.current = null
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      setMovingId(null)
      preview.end(!cancelled, () => focus(current.id))
      if (cancelled && current.moved) {
        const byId = new Map(rowIds.current.map((id, index) => [id, latest.current.fields[index]!]))
        const restoredIds = [
          ...current.originalIds.filter((id) => byId.has(id)),
          ...rowIds.current.filter((id) => !current.originalIds.includes(id)),
        ]
        const restored = restoredIds.map((id) => byId.get(id)!)
        rowIds.current = restoredIds
        latest.current = { ...latest.current, fields: restored }
        latest.current.change(restored)
        setAnnouncement(t('已取消排序，恢复原顺序。'))
      } else if (current.moved) announce(current.id)
    }
    function tick() {
      const current = drag.current
      frame.current = null
      if (!current || !current.moved) return
      preview.move(current.y)
      if (latest.current.disabled) {
        finish(true)
        return
      }
      let scrollParent: HTMLElement | null = viewport.current
      while (scrollParent) {
        if (
          scrollParent.scrollHeight > scrollParent.clientHeight &&
          /auto|scroll/.test(getComputedStyle(scrollParent).overflowY)
        )
          break
        scrollParent = scrollParent.parentElement
      }
      if (scrollParent) {
        const box = scrollParent.getBoundingClientRect()
        let top = Math.max(0, box.top)
        let bottom = Math.min(window.innerHeight, box.bottom)
        // A fixed-height list can be partially clipped by the outer form in a small window.
        for (let parent = scrollParent.parentElement; parent; parent = parent.parentElement) {
          if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) {
            const bounds = parent.getBoundingClientRect()
            top = Math.max(top, bounds.top)
            bottom = Math.min(bottom, bounds.bottom)
          }
        }
        const edge = Math.min(
          parseFloat(getComputedStyle(scrollParent).getPropertyValue('--lumi-control-height')) ||
            36,
          Math.max(0, bottom - top) / 4,
        )
        if (edge > 0 && current.x >= box.left && current.x <= box.right) {
          const direction =
            current.y < top + edge
              ? -Math.min(1, (top + edge - current.y) / edge)
              : current.y > bottom - edge
                ? Math.min(1, (current.y - bottom + edge) / edge)
                : 0
          scrollParent.scrollTop += direction * 12
        }
      }
      const rows = Array.from(
        viewport.current?.querySelectorAll<HTMLElement>('[data-parameter-row]') ?? [],
      )
      let target = -1
      let distance = Infinity
      for (const [index, row] of rows.entries()) {
        const box = row.getBoundingClientRect()
        const nextDistance = Math.abs(current.y - (box.top + box.height / 2))
        if (nextDistance < distance) {
          target = index
          distance = nextDistance
        }
      }
      if (target >= 0) move(current.id, target)
      frame.current = requestAnimationFrame(tick)
    }
    function pointerMove(event: globalThis.PointerEvent) {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      current.x = event.clientX
      current.y = event.clientY
      if (!current.moved && Math.abs(current.y - current.startY) >= 4) current.moved = true
      if (current.moved) {
        event.preventDefault()
        if (frame.current === null) frame.current = requestAnimationFrame(tick)
      }
    }
    function pointerUp(event: globalThis.PointerEvent) {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      current.x = event.clientX
      current.y = event.clientY
      if (current.moved) {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        tick()
      }
      finish(false)
    }
    function pointerCancel(event: globalThis.PointerEvent) {
      if (drag.current?.pointerId === event.pointerId) finish(true)
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (drag.current && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(true)
      }
    }
    function blur() {
      finish(true)
    }
    window.addEventListener('pointermove', pointerMove, { passive: false })
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => {
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
      preview.end(false)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      drag.current = null
    }
  }, [])

  function pointerDown(event: PointerEvent<HTMLButtonElement>, id: number) {
    if (disabled || fields.length < 2 || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    drag.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startY: event.clientY,
      originalIds: [...rowIds.current],
      moved: false,
    }
    const row = event.currentTarget.closest('tr')
    if (row && viewport.current) preview.begin(row, event.clientY, viewport.current)
    setMovingId(id)
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (disabled || drag.current || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return
    event.preventDefault()
    const index = rowIds.current.indexOf(id)
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? fields.length - 1
          : index + (event.key === 'ArrowUp' ? -1 : 1)
    if (move(id, target)) {
      announce(id)
      focus(id)
    }
  }
  return { pointerDown, keyDown, movingId, announcement }
}
