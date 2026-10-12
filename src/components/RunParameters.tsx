// SPDX-License-Identifier: MPL-2.0
import { useId, useState, type ReactNode } from 'react'
import type { CapabilityField } from '@lumiplug/shared'
import { Badge, Button, FieldGroup } from './ui'
import { RunParameterRow } from './RunParameterRow'
import { multilineRunField } from '../lib/tool-run'
import type { ReactElement } from 'react'
import type { InputHintControlProps } from './ui'
import { ChevronDown, ChevronUp } from 'lucide-react'

/** Runtime values are editable; the saved parameter contract is inspection only. */
export function RunParameters({
  fields,
  label = '外部参数',
  renderValue,
  error,
  action,
  needsInput = () => false,
  renderAction,
}: {
  action?: ReactNode
  label?: string
  fields: CapabilityField[]
  renderValue: (
    field: CapabilityField,
    descriptionId?: string,
    inputId?: string,
  ) => ReactElement<InputHintControlProps>
  renderAction?: (field: CapabilityField) => ReactNode
  error?: { key: string | null; message: string } | null
  needsInput?: (field: CapabilityField) => boolean
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const required = fields.filter((field) => field.required || needsInput(field))
  const optional = fields.filter((field) => !field.required && !needsInput(field))
  // An invalid optional value must stay visible and focusable after submit.
  const advancedOpen = expanded || optional.some((field) => field.key === error?.key)
  const rows = (items: CapabilityField[]) => (
    <div className="tools-run-parameter-list" role="list" aria-label={label}>
      {items.map((field) => {
        const index = fields.indexOf(field)
        const inputId = `${id}-${index}-value`
        return (
          <RunParameterRow
            key={field.key}
            listItem
            label={field.schema.title || field.key}
            hint={field.schema.description}
            multiline={multilineRunField(field)}
            error={error?.key === field.key ? error.message : undefined}
            tags={
              <>
                <Badge>{field.aiVisible ? '外部可见' : '外部不可见'}</Badge>
                <Badge tone={field.required || needsInput(field) ? 'accent' : 'neutral'}>
                  {field.required || needsInput(field) ? '必填' : '可选'}
                </Badge>
              </>
            }
            action={renderAction?.(field)}
          >
            {renderValue(field, undefined, inputId)}
          </RunParameterRow>
        )
      })}
    </div>
  )
  return (
    <FieldGroup label={label} action={action}>
      <div className="tools-run-parameter-viewport" role="region" aria-label={`${label}配置`}>
        {rows(required)}
        {!!optional.length && (
          <div className="tools-run-advanced">
            <Button
              variant="text"
              aria-expanded={advancedOpen}
              aria-controls={`${id}-advanced`}
              icon={advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              onClick={() => setExpanded(!advancedOpen)}
            >
              {advancedOpen ? '收起高级参数' : `高级参数（${optional.length}）`}
            </Button>
            <div id={`${id}-advanced`} hidden={!advancedOpen} aria-label="高级参数">
              {rows(optional)}
            </div>
          </div>
        )}
      </div>
    </FieldGroup>
  )
}
