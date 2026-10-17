// SPDX-License-Identifier: MPL-2.0
import { useRef } from 'react'
import type { ReactNode } from 'react'

export type ChoiceItem<T extends string> = {
  value: T
  label: ReactNode
  count?: number
  disabled?: boolean
  id?: string
  panelId?: string
  className?: string
  accessibleLabel?: string
}
export function nextChoiceIndex(
  items: readonly { disabled?: boolean }[],
  index: number,
  key: string,
): number | undefined {
  const available = items.flatMap((item, i) => (item.disabled ? [] : [i]))
  if (!available.length) return undefined
  if (key === 'Home') return available[0]
  if (key === 'End') return available.at(-1)
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return undefined
  const current = available.indexOf(index)
  return available[
    (current + (key === 'ArrowRight' ? 1 : -1) + available.length) % available.length
  ]
}
type ChoiceProps<T extends string> = {
  items: readonly ChoiceItem<T>[]
  value: T
  onValueChange: (value: T) => void
  label: string
  className?: string
  appearance?: 'default' | 'enclosed' | 'chips'
  buttonRef?: (element: HTMLButtonElement | null, index: number) => void
}
function Choices<T extends string>({
  items,
  value,
  onValueChange,
  label,
  className = '',
  appearance = 'default',
  buttonRef,
  tabs,
}: ChoiceProps<T> & { tabs: boolean }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = items.findIndex((item) => item.value === value && !item.disabled)
  const focusIndex = selectedIndex < 0 ? items.findIndex((item) => !item.disabled) : selectedIndex
  return (
    <div
      className={`ui-choices${appearance === 'default' ? '' : ` ui-choices--${appearance}`} ${className}`}
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          id={item.id}
          role={tabs ? 'tab' : undefined}
          ref={(element) => {
            buttons.current[index] = element
            buttonRef?.(element, index)
          }}
          disabled={item.disabled}
          tabIndex={index === focusIndex ? 0 : -1}
          aria-label={item.accessibleLabel}
          aria-controls={tabs ? item.panelId : undefined}
          aria-selected={tabs ? item.value === value : undefined}
          aria-pressed={!tabs ? item.value === value : undefined}
          className={`ui-choice ${item.className ?? ''}`}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true })
            onValueChange(item.value)
          }}
          onFocus={(event) =>
            event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          }
          onKeyDown={(event) => {
            const key =
              getComputedStyle(event.currentTarget).direction === 'rtl'
                ? ({ ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' }[event.key] ?? event.key)
                : event.key
            const next = nextChoiceIndex(items, index, key)
            if (next === undefined) return
            event.preventDefault()
            buttons.current[next]?.focus({ preventScroll: true })
            onValueChange(items[next]!.value)
          }}
        >
          {appearance === 'chips' && <span className="ui-choice-dot" aria-hidden="true" />}
          {item.label}
          {item.count !== undefined && (
            <span className="ui-choice-count" aria-hidden={item.accessibleLabel ? true : undefined}>
              {item.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
export function Tabs<T extends string>(props: ChoiceProps<T>) {
  return <Choices {...props} tabs />
}
export function Segmented<T extends string>(props: ChoiceProps<T>) {
  return <Choices {...props} tabs={false} />
}
