// SPDX-License-Identifier: MPL-2.0
import { Input, Textarea, Button, Checkbox, FieldGroup, FieldRow, InputHint, Badge } from './ui'
import { RunParameterRow } from './RunParameterRow'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { ToolFieldTitle } from './ToolHint'
export const RawInputContext = createContext(() => {})
export function JsonEditor({
  label,
  value,
  onChange,
  disabled = false,
  secret = false,
  path,
  kind,
  hint,
  layout = 'default',
}: {
  label: string
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  secret?: boolean
  path?: string
  kind?: 'object' | 'array'
  hint?: string
  layout?: 'default' | 'parameters'
}) {
  const markRaw = useContext(RawInputContext)
  const errorId = useId()
  const inputId = useId()
  const lastValue = useRef(JSON.stringify(value))
  useEffect(() => {
    const current = JSON.stringify(value)
    if (current !== lastValue.current) {
      setText(JSON.stringify(value, null, 2))
      setInvalid(false)
      lastValue.current = current
    }
  }, [value])
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [invalid, setInvalid] = useState(false)
  const [reveal, setReveal] = useState(false)
  function parse(text: string) {
    const value: unknown = JSON.parse(text)
    if (kind === 'array' && !Array.isArray(value)) throw new Error('array_required')
    if (kind === 'object' && (!value || typeof value !== 'object' || Array.isArray(value)))
      throw new Error('object_required')
    return value
  }
  const control =
    secret && !reveal ? (
      <Input
        id={inputId}
        data-validation={path}
        type="password"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          markRaw()
          setText(e.target.value)
          try {
            const value = parse(e.target.value)
            lastValue.current = JSON.stringify(value)
            onChange(value)
            setInvalid(false)
          } catch {
            setInvalid(true)
          }
        }}
        aria-invalid={invalid}
        aria-describedby={invalid && layout === 'default' ? errorId : undefined}
      />
    ) : (
      <Textarea
        id={inputId}
        data-validation={path}
        className="tool-code"
        rows={5}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          markRaw()
          setText(e.target.value)
          try {
            const value = parse(e.target.value)
            lastValue.current = JSON.stringify(value)
            onChange(value)
            setInvalid(false)
          } catch {
            setInvalid(true)
          }
        }}
        aria-invalid={invalid}
        aria-describedby={invalid && layout === 'default' ? errorId : undefined}
      />
    )
  const invalidMessage = `请输入有效${kind === 'object' ? ' JSON 对象' : kind === 'array' ? ' JSON 数组' : ' JSON'}；修正后再保存。`
  if (layout === 'parameters')
    return (
      <RunParameterRow
        label={label}
        hint={hint}
        multiline={!secret || reveal}
        tags={
          <Badge>{kind === 'object' ? 'JSON 对象' : kind === 'array' ? 'JSON 数组' : 'JSON'}</Badge>
        }
        error={invalid ? invalidMessage : undefined}
      >
        {control}
      </RunParameterRow>
    )
  return (
    <div className="ui-field tool-field">
      <ToolFieldTitle htmlFor={inputId} label={label} />
      {secret && (
        <Checkbox
          className="tool-check"
          label="显示内容"
          checked={reveal}
          onChange={(e) => setReveal(e.target.checked)}
        />
      )}
      <InputHint label={label} hint={hint} multiline={!secret || reveal}>
        {control}
      </InputHint>
      {invalid && (
        <span id={errorId} className="tool-error">
          请输入有效{kind === 'object' ? ' JSON 对象' : kind === 'array' ? ' JSON 数组' : ' JSON'}
          ；修正后再保存。
        </span>
      )}
    </div>
  )
}
export function KeyValues({
  label,
  value,
  change,
  editable,
  path,
  fixedKeys = false,
  layout = 'default',
}: {
  label: string
  value: Record<string, string>
  change: (value: Record<string, string>) => void
  editable: boolean
  path?: string
  fixedKeys?: boolean
  layout?: 'default' | 'parameters'
}) {
  const [reveal, setReveal] = useState(false)
  const markRaw = useContext(RawInputContext)
  const [entries, setEntries] = useState(() => Object.entries(value))
  const signature = useRef(JSON.stringify(value))
  useEffect(() => {
    const next = JSON.stringify(value)
    if (next !== signature.current) {
      signature.current = next
      setEntries(Object.entries(value))
    }
  }, [value])
  const invalid = entries.some(
    ([key], i) =>
      !key.trim() ||
      entries.some(([other], j) => j !== i && other.toLowerCase() === key.toLowerCase()),
  )
  function update(next: [string, string][]) {
    markRaw()
    setEntries(next)
    if (
      next.some(
        ([key], i) =>
          !key?.trim() ||
          next.some(([other], j) => j !== i && other?.toLowerCase() === key.toLowerCase()),
      )
    )
      return
    const result = Object.fromEntries(next) as Record<string, string>
    signature.current = JSON.stringify(result)
    change(result)
  }
  return (
    <FieldGroup
      label={label}
      action={
        <>
          {entries.length > 0 && (
            <Checkbox
              label="显示固定值"
              checked={reveal}
              onChange={(e) => setReveal(e.target.checked)}
            />
          )}
          {editable && !fixedKeys && (
            <Button
              type="button"
              className="tool-button"
              onClick={() => {
                let key = `KEY_${entries.length + 1}`
                while (entries.some(([existing]) => existing === key)) key += '_'
                update([...entries, [key, '']])
              }}
            >
              添加{label}
            </Button>
          )}
        </>
      }
    >
      {entries.map(([key, val], index) =>
        layout === 'parameters' && fixedKeys ? (
          <RunParameterRow key={index} label={key}>
            <Input
              aria-label={`${label} 固定值 ${index + 1}`}
              type={reveal ? 'text' : 'password'}
              value={val}
              disabled={!editable}
              onChange={(event) =>
                update(
                  entries.map<[string, string]>((entry, i) =>
                    i === index ? [entry[0]!, event.target.value] : entry,
                  ),
                )
              }
            />
          </RunParameterRow>
        ) : (
          <FieldRow
            key={index}
            label={`${label} ${index + 1}`}
            size="compact"
            fields={[
              <Input
                key="name"
                aria-label={`${label} 名称 ${index + 1}`}
                data-validation={path}
                aria-invalid={
                  !key.trim() ||
                  entries.some(
                    ([other], i) => i !== index && other.toLowerCase() === key.toLowerCase(),
                  )
                }
                aria-describedby={invalid ? 'tool-validation-error' : undefined}
                value={key}
                disabled={!editable}
                readOnly={fixedKeys}
                onChange={(e) =>
                  update(
                    entries.map<[string, string]>((entry, i) =>
                      i === index ? [e.target.value, entry[1]!] : entry,
                    ),
                  )
                }
              />,
              <Input
                key="value"
                aria-label={`${label} 固定值 ${index + 1}`}
                type={reveal ? 'text' : 'password'}
                value={val}
                disabled={!editable}
                onChange={(e) =>
                  update(
                    entries.map<[string, string]>((entry, i) =>
                      i === index ? [entry[0]!, e.target.value] : entry,
                    ),
                  )
                }
              />,
            ]}
            action={
              editable &&
              !fixedKeys && (
                <Button
                  type="button"
                  className="tool-button"
                  onClick={() => update(entries.filter((_, i) => i !== index))}
                  aria-label={`删除${label} ${key}`}
                >
                  删除
                </Button>
              )
            }
          />
        ),
      )}

      {invalid && <p className="tool-error">名称不能为空或重复，请修正后再保存。</p>}
      {!entries.length && (!editable || fixedKeys) && <p className="tool-help">未设置</p>}
    </FieldGroup>
  )
}
