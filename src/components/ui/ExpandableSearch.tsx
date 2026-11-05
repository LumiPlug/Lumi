// SPDX-License-Identifier: MPL-2.0
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { IconButton, Input } from './controls'

/** A right-anchored search control that shares space with horizontally scrolling tabs. */
export function ExpandableSearch({
  label,
  className = '',
  value,
  disabled,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'aria-label' | 'className'> & {
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (open) input.current?.focus({ preventScroll: true })
  }, [open])
  return (
    <div
      className={`ui-expandable-search ${className}`}
      data-open={open}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !value) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open && !event.nativeEvent.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus({ preventScroll: true })
        }
      }}
    >
      <div className="ui-expandable-search-field" inert={!open} aria-hidden={!open}>
        <Input
          {...props}
          id={id}
          ref={input}
          type="search"
          aria-label={label}
          value={value}
          disabled={disabled}
          tabIndex={open ? undefined : -1}
        />
      </div>
      <IconButton
        ref={trigger}
        label={label}
        title={value ? `${label}: ${value}` : label}
        tone={value ? 'accent' : 'neutral'}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Search aria-hidden="true" />
      </IconButton>
    </div>
  )
}
