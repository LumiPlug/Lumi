// SPDX-License-Identifier: MPL-2.0
import { t, useLocale, formatMonth } from '../../i18n'
import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, IconButton } from './controls'
import { useSurfaceDepth } from './SurfaceEffects'

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
/** Controlled floating range calendar; drafts never change the caller's applied range. */
export function DateRangeCalendar({
  anchorRef,
  start,
  end,
  onApply,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>
  start: string
  end: string
  onApply: (start: string, end: string) => void
  onClose: () => void
}) {
  useLocale()

  const depth = useSurfaceDepth()
  const panel = useRef<HTMLDivElement>(null)
  const [month, setMonth] = useState(() => new Date(`${start}T12:00:00`))
  const [draft, setDraft] = useState({ start, end })
  const pendingFocus = useRef<string | null>(null)
  const initialFocus = useRef(true)
  const [focusDay, setFocusDay] = useState(start)
  const [choosingEnd, setChoosingEnd] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const element = panel.current,
      anchor = anchorRef.current
    if (!element || !anchor) return
    const previous = document.activeElement
    const place = () => {
      const rect = anchor.getBoundingClientRect(),
        box = element.getBoundingClientRect()
      setPosition({
        left: Math.max(16, Math.min(rect.right - box.width, window.innerWidth - box.width - 16)),
        top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - box.height - 16)),
      })
    }
    place()
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !element!.contains(event.target) &&
        !anchor!.contains(event.target)
      )
        onClose()
    }
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
      if (event.key === 'Tab') {
        const controls = [
          ...element!.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled):not([tabindex="-1"])',
          ),
        ].filter((control) => control.offsetParent !== null)
        const first = controls[0],
          last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', keys, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', keys, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [anchorRef, onClose])
  useLayoutEffect(() => {
    if (!position || !initialFocus.current) return
    initialFocus.current = false
    panel.current
      ?.querySelector<HTMLButtonElement>('[data-calendar-day][aria-pressed="true"]:not(:disabled)')
      ?.focus()
  }, [position])
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    panel.current
      ?.querySelector<HTMLButtonElement>(
        `[data-calendar-day="${pendingFocus.current}"]:not(:disabled)`,
      )
      ?.focus()
    pendingFocus.current = null
  }, [month])
  const viewStart = new Date(month.getFullYear(), month.getMonth(), 1)
  const viewEnd = new Date(month.getFullYear(), month.getMonth() + 2, 0)
  const tabDay =
    focusDay >= dateKey(viewStart) && focusDay <= dateKey(viewEnd) ? focusDay : dateKey(viewStart)
  function moveMonth(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1))
  }
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={t('选择日期范围')}
      className="ui-tooltip ui-range-calendar"
      data-ui-depth={depth}
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
    >
      <div className="ui-range-calendar-nav">
        <IconButton label={t('上个月')} onClick={() => moveMonth(-1)}>
          <ChevronLeft />
        </IconButton>
        <span>{t('选择开始和结束日期')}</span>
        <IconButton label={t('下个月')} onClick={() => moveMonth(1)}>
          <ChevronRight />
        </IconButton>
      </div>
      <div className="ui-range-calendar-months">
        {[0, 1].map((offset) => {
          const first = new Date(month.getFullYear(), month.getMonth() + offset, 1)
          const gridStart = new Date(first)
          gridStart.setDate(1 - ((first.getDay() + 6) % 7))
          return (
            <section key={offset} aria-label={formatMonth(first)}>
              <strong>{formatMonth(first)}</strong>
              <div className="ui-range-calendar-grid">
                {[t('一'), t('二'), t('三'), t('四'), t('五'), t('六'), t('日')].map((label) => (
                  <span key={label} aria-hidden="true">
                    {label}
                  </span>
                ))}
                {Array.from({ length: 42 }, (_, index) => {
                  const date = new Date(gridStart)
                  date.setDate(date.getDate() + index)
                  const key = dateKey(date),
                    inMonth = date.getMonth() === first.getMonth(),
                    selected = key === draft.start || key === draft.end
                  return (
                    <Button
                      key={key}
                      data-calendar-day={key}
                      data-in-range={(key > draft.start && key < draft.end) || undefined}
                      aria-label={key}
                      aria-pressed={selected}
                      tabIndex={inMonth && key === tabDay ? 0 : -1}
                      onFocus={() => setFocusDay(key)}
                      disabled={!inMonth}
                      variant={selected ? 'primary' : 'text'}
                      onClick={() => {
                        if (!choosingEnd) {
                          setDraft({ start: key, end: key })
                          setChoosingEnd(true)
                        } else {
                          setDraft({
                            start: key < draft.start ? key : draft.start,
                            end: key < draft.start ? draft.start : key,
                          })
                          setChoosingEnd(false)
                        }
                      }}
                      onKeyDown={(event) => {
                        const delta = (
                          { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<
                            string,
                            number
                          >
                        )[event.key]
                        if (delta === undefined) return
                        event.preventDefault()
                        const next = new Date(date)
                        next.setDate(next.getDate() + delta)
                        const target = panel.current?.querySelector<HTMLButtonElement>(
                          `[data-calendar-day="${dateKey(next)}"]:not(:disabled)`,
                        )
                        if (target && target.offsetParent !== null) target.focus()
                        else {
                          pendingFocus.current = dateKey(next)
                          setFocusDay(dateKey(next))
                          setMonth(new Date(next.getFullYear(), next.getMonth(), 1))
                        }
                      }}
                    >
                      {date.getDate()}
                    </Button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
      <div className="ui-range-calendar-footer">
        <span aria-live="polite">
          {draft.start} — {draft.end}
          {choosingEnd ? t(' · 选择结束日期') : ''}
        </span>
        <div>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" onClick={() => onApply(draft.start, draft.end)}>
            {t('应用日期')}
          </Button>
        </div>
      </div>
    </div>,
    anchorRef.current?.closest('dialog') ?? document.body,
  )
}
