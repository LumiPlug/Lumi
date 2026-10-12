// SPDX-License-Identifier: MPL-2.0
import { useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, Ref, HTMLAttributes } from 'react'
import type { CapabilityField, JsonValue } from '@lumiplug/shared'
import { GripVertical, Trash2 } from 'lucide-react'
import { Button, Checkbox, Switch, Card, FieldGroup, FieldTitle, IconButton, Input } from './ui'
import { RawInputContext } from './ToolConfigFields'
import {
  parseParameterDefault,
  parameterDefaultText,
  setParameterVisibility,
} from '../lib/tool-parameters'
import { useParameterOrder } from '../lib/useParameterOrder'

/** Identical table surface and column geometry in the editor and manual run window. */
export function TerminalParameterTable({
  children,
  actions = false,
  viewportRef,
  ...props
}: {
  children: ReactNode
  actions?: boolean
  viewportRef?: Ref<HTMLDivElement>
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <Card density="flush" className="tools-parameter-surface">
      <div
        {...props}
        ref={viewportRef}
        className="ui-field-row-viewport tools-parameter-viewport"
        role="region"
        aria-label="外部参数配置表"
        tabIndex={0}
      >
        <table
          className={`tools-parameter-table${actions ? '' : ' tools-parameter-table--run'}`}
          aria-label="外部参数"
        >
          <colgroup>
            <col className="tools-parameter-option" />
            <col />
            <col />
            <col />
            <col className="tools-parameter-required-column" />
            {actions && <col className="tools-parameter-action" />}
          </colgroup>
          <thead>
            <tr>
              {['外部可见', '参数名', '参数值', '描述', '必填'].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className={
                    ['外部可见', '必填'].includes(label) ? 'tools-parameter-centered' : undefined
                  }
                >
                  <FieldTitle label={label} />
                </th>
              ))}
              {actions && (
                <th scope="col">
                  <span className="sr-only">删除</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  )
}

function ValueInput({
  field,
  index,
  disabled,
  change,
}: {
  field: CapabilityField
  index: number
  disabled: boolean
  change: (value: JsonValue | undefined) => void
}) {
  const value = parameterDefaultText(field)
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const last = useRef(value)
  const errorId = useId()
  const markRaw = useContext(RawInputContext)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setText(value)
      setInvalid(false)
    }
  }, [value])
  return (
    <>
      <Input
        aria-label={`参数 ${index + 1} 参数值`}
        data-validation={`tools[0].fields[${index}].${field.aiVisible ? 'schema.default' : 'value'}`}
        type={field.aiVisible ? 'text' : 'password'}
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          markRaw()
          setText(event.target.value)
          try {
            const next = parseParameterDefault(field, event.target.value)
            last.current = event.target.value
            change(next)
            setInvalid(false)
          } catch {
            setInvalid(true)
          }
        }}
      />
      {invalid && (
        <span id={errorId} className="tool-error">
          参数值格式与参数类型不符。
        </span>
      )}
    </>
  )
}

/** Business composition of shared controls for the terminal parameter draft. */
export function TerminalParameters({
  fields,
  change,
  disabled = false,
}: {
  fields: CapabilityField[]
  change: (fields: CapabilityField[]) => void
  disabled?: boolean
}) {
  const addId = useId()
  const viewport = useRef<HTMLDivElement>(null)
  const nextId = useRef(0)
  const rowIds = useRef<number[]>([])
  while (rowIds.current.length < fields.length) rowIds.current.push(nextId.current++)
  const order = useParameterOrder({ fields, rowIds, viewport, change, disabled })
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [focusedRow, setFocusedRow] = useState<number | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  function update(index: number, next: CapabilityField) {
    change(fields.map((field, position) => (position === index ? next : field)))
  }
  function add() {
    let key = `PARAM_${fields.length + 1}`
    while (fields.some((field) => field.key === key)) key += '_'
    change([
      ...fields,
      {
        key,
        schema: { type: 'string', title: '', description: '' },
        required: false,
        aiVisible: true,
        value: null,
        binding: { location: 'argument', key },
      },
    ])
  }
  return (
    <FieldGroup
      label="外部参数"
      hint="命令通过 $参数名 读取（Windows 使用 %参数名%）。公开参数值和说明会提供给 AI，请勿填写凭据。"
      action={
        !disabled && (
          <Button id={addId} onClick={add}>
            添加参数
          </Button>
        )
      }
    >
      <span className="sr-only" role="status" aria-live="polite">
        {order.announcement}
      </span>
      <TerminalParameterTable
        actions
        viewportRef={viewport}
        onMouseLeave={() => {
          pointer.current = null
          setHoveredRow(null)
        }}
        onScroll={() => {
          const point = pointer.current
          if (!point || order.movingId !== null) return
          const row = document
            .elementFromPoint(point.x, point.y)
            ?.closest<HTMLElement>('[data-parameter-row]')
          setHoveredRow(
            row && viewport.current?.contains(row) ? Number(row.dataset.parameterRow) : null,
          )
        }}
      >
        {fields.map((field, index) => {
          const id = rowIds.current[index]!
          const active = hoveredRow === id || focusedRow === id || order.movingId === id
          return (
            <tr
              key={id}
              data-parameter-row={id}
              onMouseEnter={(event) => {
                pointer.current = { x: event.clientX, y: event.clientY }
                setHoveredRow(id)
              }}
              onMouseMove={(event) => {
                pointer.current = { x: event.clientX, y: event.clientY }
              }}
              onMouseLeave={() => setHoveredRow((current) => (current === id ? null : current))}
              onFocusCapture={() => setFocusedRow(id)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setFocusedRow((current) => (current === id ? null : current))
              }}
            >
              <td className="tools-parameter-visibility">
                <div className="tools-parameter-visibility-controls">
                  <div className="tools-parameter-icon-slot">
                    <span hidden={!active}>
                      <Button
                        variant="text"
                        className="tools-parameter-order"
                        title="拖动排序；方向键调整，Home／End 移至首尾，Escape 取消拖动"
                        data-parameter-handle={id}
                        aria-label={`排序参数 ${index + 1}：${field.key}`}
                        aria-pressed={order.movingId === id}
                        aria-keyshortcuts="ArrowUp ArrowDown Home End"
                        disabled={disabled || fields.length < 2}
                        onPointerDown={(event) => order.pointerDown(event, id)}
                        onKeyDown={(event) => order.keyDown(event, id)}
                      >
                        <GripVertical size={16} aria-hidden="true" />
                      </Button>
                    </span>
                  </div>
                  <Checkbox
                    label={null}
                    aria-label={`参数 ${index + 1} 外部可见`}
                    checked={field.aiVisible}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, setParameterVisibility(field, event.target.checked))
                    }
                  />
                </div>
              </td>
              <td>
                <Input
                  aria-label={`参数 ${index + 1} 参数名`}
                  data-validation={`tools[0].fields[${index}].key`}
                  value={field.key}
                  disabled={disabled}
                  onChange={(event) =>
                    update(index, {
                      ...field,
                      key: event.target.value,
                      binding: {
                        location: field.binding?.location ?? 'argument',
                        key: event.target.value,
                      },
                    })
                  }
                />
              </td>
              <td>
                <ValueInput
                  field={field}
                  index={index}
                  disabled={disabled}
                  change={(value) => {
                    if (!field.aiVisible) update(index, { ...field, value: value ?? null })
                    else {
                      const schema = { ...field.schema }
                      if (value === undefined) delete schema.default
                      else schema.default = value
                      update(index, { ...field, schema })
                    }
                  }}
                />
              </td>
              <td>
                <Input
                  aria-label={`参数 ${index + 1} 描述`}
                  value={field.schema.description ?? ''}
                  disabled={disabled}
                  onChange={(event) =>
                    update(index, {
                      ...field,
                      schema: { ...field.schema, description: event.target.value },
                    })
                  }
                />
              </td>
              <td className="tools-parameter-centered">
                <Switch
                  label={null}
                  aria-label={`参数 ${index + 1} 必填`}
                  checked={field.required}
                  disabled={disabled}
                  onChange={(event) => update(index, { ...field, required: event.target.checked })}
                />
              </td>
              <td>
                <div className="tools-parameter-icon-slot">
                  <span hidden={!active}>
                    <IconButton
                      label={`删除参数 ${field.key || index + 1}`}
                      disabled={disabled}
                      onClick={() => {
                        const nextFocus = rowIds.current[index + 1] ?? rowIds.current[index - 1]
                        rowIds.current.splice(index, 1)
                        change(fields.filter((_, position) => position !== index))
                        requestAnimationFrame(() => {
                          const target =
                            nextFocus === undefined
                              ? document.getElementById(addId)
                              : viewport.current?.querySelector<HTMLInputElement>(
                                  `[data-parameter-row="${nextFocus}"] input:not(:disabled)`,
                                )
                          target?.focus()
                        })
                      }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </span>
                </div>
              </td>
            </tr>
          )
        })}
      </TerminalParameterTable>
    </FieldGroup>
  )
}
