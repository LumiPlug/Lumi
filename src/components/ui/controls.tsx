// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../../i18n'
import { useId, useRef, useLayoutEffect, useImperativeHandle } from 'react'
import { revealInputEnd } from './input-viewport'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
  Ref,
} from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'text'
  loading?: boolean
  loadingLabel?: string
  icon?: ReactNode
}
export function Button({
  variant = 'secondary',
  loading = false,
  loadingLabel = t('处理中…'),
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  onClick,
  ...props
}: ButtonProps) {
  useLocale()

  return (
    <button
      {...props}
      type={type}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true })
        onClick?.(event)
      }}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy'] || undefined}
      className={`ui-button ui-button--${variant} ${className}`}
    >
      <span
        aria-hidden={loading || undefined}
        className={`ui-button-content${loading ? ' ui-button-content--hidden' : ''}`}
      >
        {icon}
        {children}
      </span>
      <span
        aria-hidden={!loading || undefined}
        className={`ui-button-loading${loading ? '' : ' ui-button-content--hidden'}`}
      >
        {loadingLabel}
      </span>
    </button>
  )
}
export function IconButton({
  label,
  tone = 'neutral',
  iconSize = 'default',
  glow = false,
  children,
  className = '',
  loading = false,
  loadingAnimation = 'none',
  disabled,
  ...props
}: Omit<ButtonProps, 'icon' | 'variant' | 'aria-label'> & {
  label: string
  tone?: 'neutral' | 'accent' | 'success' | 'danger'
  iconSize?: 'default' | 'small'
  glow?: boolean
  loadingAnimation?: 'none' | 'spin'
}) {
  useLocale()

  return (
    <Button
      {...props}
      variant="ghost"
      loadingLabel=""
      aria-busy={loading || props['aria-busy']}
      disabled={disabled || loading}
      aria-label={loading ? t('{v0}，处理中', { v0: label }) : label}
      className={`ui-icon-button${iconSize === 'small' ? ' ui-icon-button--small' : ''}${loading && loadingAnimation === 'spin' ? ' ui-icon-button--spinning' : ''} ui-tone--${tone}${glow ? ' ui-icon-button--glow' : ''} ${className}`}
    >
      {children}
      {glow && (
        <span className="ui-icon-glow" aria-hidden="true">
          {children}
        </span>
      )}
    </Button>
  )
}
export function Input({
  className = '',
  revealEnd = false,
  ref,
  onBlur,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement>; revealEnd?: boolean }) {
  useLocale()

  const element = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => element.current!, [])
  const frame = useRef<number | null>(null)
  useLayoutEffect(() => {
    const input = element.current
    if (!revealEnd || !input) return
    revealInputEnd(input)
    const observer = new ResizeObserver(() => revealInputEnd(input))
    observer.observe(input)
    return () => {
      observer.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [revealEnd, props.value, props.defaultValue, props.disabled])
  return (
    <input
      {...props}
      ref={element}
      onBlur={(event) => {
        onBlur?.(event)
        if (revealEnd) {
          if (frame.current !== null) cancelAnimationFrame(frame.current)
          frame.current = requestAnimationFrame(() => {
            if (element.current) revealInputEnd(element.current)
          })
        }
      }}
      className={`ui-input ${className}`}
    />
  )
}
export function Select({
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  useLocale()

  return <select {...props} className={`ui-input ui-select ${className}`} />
}
export function Textarea({
  className = '',
  rows = 5,
  showCount = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>
  showCount?: boolean
}) {
  useLocale()

  const countId = useId()
  const counting = showCount && props.maxLength !== undefined && typeof props.value === 'string'
  const textarea = (
    <textarea
      {...props}
      rows={rows}
      aria-describedby={
        [props['aria-describedby'], counting ? countId : undefined].filter(Boolean).join(' ') ||
        undefined
      }
      className={`ui-input ui-textarea ${className}`}
    />
  )
  return counting ? (
    <div className="ui-counted-textarea">
      {textarea}
      <span id={countId} className="ui-textarea-count">
        {t('剩余 {v0} 字', { v0: Math.max(0, props.maxLength! - String(props.value).length) })}
      </span>
    </div>
  ) : (
    textarea
  )
}
export function Checkbox({
  label,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode
  ref?: Ref<HTMLInputElement>
}) {
  useLocale()

  return (
    <label className={`ui-checkbox ${className}`}>
      <input {...props} type="checkbox" />
      {label}
    </label>
  )
}

/** Native checkbox behavior with switch semantics and a shared sliding thumb. */
export function Switch({
  label,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & {
  label: ReactNode
  ref?: Ref<HTMLInputElement>
}) {
  useLocale()

  return (
    <label className={`ui-switch ${className}`}>
      <input {...props} type="checkbox" role="switch" />
      {label}
    </label>
  )
}

export function ChoiceCard({
  label,
  description,
  selected,
  className = '',
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: ReactNode
  description: ReactNode
  selected: boolean
}) {
  useLocale()

  return (
    <button
      {...props}
      type="button"
      className={`ui-choice-card ${className}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true })
        onClick?.(event)
      }}
    >
      <strong>{label}</strong>
      <span>{description}</span>
      {selected && (
        <svg
          className="ui-choice-card-check"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m5 12 4 4 10-10" />
        </svg>
      )}
    </button>
  )
}

/** For composed navigation, file rows and card hit areas whose content owns its layout. */
export function SurfaceButton({
  className = '',
  type = 'button',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  useLocale()

  return (
    <button
      {...props}
      type={type}
      className={`ui-surface-button ${className}`}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true })
        onClick?.(event)
      }}
    />
  )
}
export function NavigationButton({
  label,
  icon,
  current,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  label: string
  icon: ReactNode
  current: boolean
}) {
  useLocale()

  return (
    <SurfaceButton
      {...props}
      className={`nav-item${current ? ' nav-item-active' : ''}`}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
    >
      <span className="nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-tooltip" aria-hidden="true">
        {label}
      </span>
    </SurfaceButton>
  )
}
