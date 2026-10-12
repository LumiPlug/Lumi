// SPDX-License-Identifier: MPL-2.0
import { cloneElement, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export type InputHintControlProps = Pick<
  HTMLAttributes<HTMLElement>,
  'id' | 'aria-describedby' | 'aria-invalid'
>

/** Input adornment uses the existing portal tooltip, never an inline clipped bubble. */
export function InputHint({
  label,
  hint,
  multiline = false,
  children,
  ...props
}: InputHintControlProps & {
  label: string
  hint?: ReactNode
  multiline?: boolean
  children: ReactElement<InputHintControlProps>
}) {
  const describedBy =
    [
      ...new Set([children.props['aria-describedby'], props['aria-describedby']].filter(Boolean)),
    ].join(' ') || undefined
  const control = cloneElement(children, {
    id: props.id ?? children.props.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? children.props['aria-invalid'],
  })
  if (!hint || (typeof hint === 'string' && !hint.trim())) return control
  return (
    <div className={`ui-input-hint${multiline ? ' ui-input-hint--multiline' : ''}`}>
      {control}
      <Tooltip label={label} icon="help">
        {hint}
      </Tooltip>
    </div>
  )
}
