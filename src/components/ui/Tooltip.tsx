// SPDX-License-Identifier: MPL-2.0
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSurfaceDepth } from './SurfaceEffects'
import { IconButton } from './controls'
import { CircleQuestionMark } from 'lucide-react'

export function Tooltip({
  label,
  children,
  icon = 'info',
}: {
  label: string
  children: ReactNode
  icon?: 'info' | 'help'
}) {
  const depth = useSurfaceDepth()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hovering = useRef(false)
  const focused = useRef(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  function cancelClose() {
    clearTimeout(timer.current)
  }
  function show() {
    cancelClose()
    setTarget(trigger.current?.closest('dialog') ?? document.body)
  }
  function leave() {
    hovering.current = false
    cancelClose()
    if (!focused.current) timer.current = setTimeout(() => setTarget(null), 120)
  }
  useLayoutEffect(() => {
    if (!target || !trigger.current || !tooltip.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const box = tooltip.current.getBoundingClientRect()
    const left = Math.max(16, Math.min(anchor.left, window.innerWidth - box.width - 16))
    const below = anchor.bottom + 8
    const top = Math.max(
      16,
      below + box.height <= window.innerHeight - 16 ? below : anchor.top - box.height - 8,
    )
    setPosition({ left, top })
    function close(event?: Event) {
      // Reading a long hint must not close it on the tooltip's own scroll.
      if (
        event?.type === 'scroll' &&
        event.target instanceof Node &&
        tooltip.current?.contains(event.target)
      )
        return
      cancelClose()
      setTarget(null)
      setPosition(null)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      cancelClose()
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [target])
  return (
    <>
      <IconButton
        ref={trigger}
        className="ui-tooltip-trigger"
        label={`${label}${icon === 'help' ? '输入提示' : '说明'}`}
        tone="accent"
        glow
        aria-describedby={target ? id : undefined}
        onMouseEnter={() => {
          hovering.current = true
          show()
        }}
        onMouseLeave={leave}
        onFocus={() => {
          focused.current = trigger.current?.matches(':focus-visible') ?? false
          show()
        }}
        onBlur={() => {
          focused.current = false
          if (!hovering.current) leave()
        }}
        onClick={show}
      >
        {icon === 'help' ? (
          <CircleQuestionMark size={16} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6" strokeLinecap="round" />
            <circle cx="12" cy="7" r=".9" fill="currentColor" stroke="none" />
          </svg>
        )}
      </IconButton>
      {target &&
        createPortal(
          <div
            id={id}
            ref={tooltip}
            role="tooltip"
            className={`ui-tooltip${icon === 'help' ? ' ui-tooltip--help' : ''}`}
            data-ui-depth={depth}
            style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
            onMouseEnter={() => {
              hovering.current = true
              cancelClose()
            }}
            onMouseLeave={leave}
          >
            {children}
          </div>,
          target,
        )}
    </>
  )
}
