// SPDX-License-Identifier: MPL-2.0
import type { CSSProperties, ReactNode } from 'react'
import { FieldTitle } from './Field'

export function FieldGroup({
  label,
  hint,
  action,
  children,
}: {
  label: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <fieldset className="ui-field-group">
      <legend>
        <span className="ui-field-group-heading">
          <FieldTitle label={label} hint={hint} />
          {action && <span className="ui-field-group-actions">{action}</span>}
        </span>
      </legend>
      {children}
    </fieldset>
  )
}
/** Keep a record's inputs and options together; overflow belongs to this row only. */
export function FieldRow({
  fields,
  options,
  action,
  label,
  size = 'default',
}: {
  fields: ReactNode[]
  options?: ReactNode
  action?: ReactNode
  label: string
  size?: 'default' | 'compact'
}) {
  return (
    <div className="ui-field-row-viewport" role="region" aria-label={label} tabIndex={0}>
      <div
        className={`ui-field-row${size === 'compact' ? ' ui-field-row--compact' : ''}`}
        style={{ '--ui-field-row-count': fields.length } as CSSProperties}
      >
        {fields.map((field, index) => (
          <div className="ui-field-row-field" key={index}>
            {field}
          </div>
        ))}
        <div className="ui-field-row-options">{options}</div>
        <div>{action}</div>
      </div>
    </div>
  )
}
