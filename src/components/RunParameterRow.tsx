// SPDX-License-Identifier: MPL-2.0
import { useId, type ReactElement, type ReactNode } from 'react'
import { InputHint, type InputHintControlProps } from './ui'
/** Runtime row geometry is shared; the caller owns protocol labels, tags and values. */
export function RunParameterRow({
  label,
  tags,
  hint,
  multiline = false,
  children,
  error,
  action,
  listItem = false,
}: {
  label: string
  tags?: ReactNode
  hint?: string
  multiline?: boolean
  children: ReactElement<InputHintControlProps>
  error?: string
  action?: ReactNode
  listItem?: boolean
}) {
  const generated = useId(),
    id = children.props.id ?? `${generated}-value`
  const descriptionId = `${generated}-description`,
    errorId = `${generated}-error`
  const describedBy =
    [children.props['aria-describedby'], hint?.trim() && descriptionId, error && errorId]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div className="tools-run-parameter-row" role={listItem ? 'listitem' : undefined}>
      <div className="tools-run-parameter-name">
        <label htmlFor={id}>{label}</label>
      </div>
      <div className="tools-run-parameter-tags">{tags}</div>
      <div className="tools-run-parameter-value">
        <InputHint
          id={id}
          label={label}
          hint={hint}
          multiline={multiline}
          aria-describedby={describedBy}
          aria-invalid={!!error || children.props['aria-invalid']}
        >
          {children}
        </InputHint>
        {hint?.trim() && (
          <span className="sr-only" id={descriptionId}>
            {hint}
          </span>
        )}
        {action}
        {error && (
          <p className="ui-field-error" id={errorId}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
