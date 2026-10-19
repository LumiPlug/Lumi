// SPDX-License-Identifier: MPL-2.0
import { t, useLocale, translateKnown } from '../../i18n'
import { cloneElement, useId } from 'react'
import type { ReactElement, ReactNode, HTMLAttributes } from 'react'
import { Tooltip } from './Tooltip'

type Control = HTMLAttributes<HTMLElement> & { id?: string; 'aria-invalid'?: boolean }
export function FieldTitle({
  htmlFor,
  label,
  hint,
  optional = false,
}: {
  htmlFor?: string
  label: string
  hint?: ReactNode
  optional?: boolean
}) {
  useLocale()

  return (
    <span className="ui-field-title">
      {htmlFor ? (
        <label htmlFor={htmlFor}>
          {label}
          {optional && <small>{t('可选')}</small>}
        </label>
      ) : (
        <span className="ui-field-label">
          {label}
          {optional && <small>{t('可选')}</small>}
        </span>
      )}
      {hint && <Tooltip label={label}>{hint}</Tooltip>}
    </span>
  )
}
export function Field({
  label,
  hint,
  description,
  error,
  inline = false,
  optional = false,
  className = '',
  controlWidth = 'default',
  action,
  children,
}: {
  label: string
  hint?: ReactNode
  description?: ReactNode
  error?: string
  inline?: boolean
  optional?: boolean
  className?: string
  controlWidth?: 'default' | 'wide'
  action?: ReactNode
  children: ReactElement<Control>
}) {
  useLocale()

  const generated = useId()
  const id = children.props.id ?? generated
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy =
    [children.props['aria-describedby'], description && descriptionId, error && errorId]
      .filter(Boolean)
      .join(' ') || undefined
  const control = cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': !!error || children.props['aria-invalid'],
  })
  return (
    <div
      className={`ui-field${inline ? ' ui-field--inline' : ''}${controlWidth === 'wide' ? ' ui-field--wide' : ''} ${className}`}
    >
      <FieldTitle htmlFor={id} label={label} hint={hint} optional={optional} />
      <div className="ui-field-control">
        {action ? (
          <div className="ui-field-control-row">
            {control}
            {action}
          </div>
        ) : (
          control
        )}
        {description && (
          <p id={descriptionId} className="ui-field-description">
            {description}
          </p>
        )}
        {error && (
          <p id={errorId} className="ui-field-error">
            {translateKnown(error)}
          </p>
        )}
      </div>
    </div>
  )
}
export function Card({
  children,
  className = '',
  density = 'normal',
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  density?: 'normal' | 'compact' | 'flush'
  interactive?: boolean
}) {
  useLocale()

  return (
    <div
      {...props}
      className={`ui-card ui-card--${density}${interactive ? ' ui-card--interactive' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
export function Badge({
  children,
  tone = 'neutral',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'protocol'
}) {
  useLocale()

  return (
    <span {...props} className={`ui-badge ui-tone--${tone} ${className}`}>
      {children}
    </span>
  )
}
