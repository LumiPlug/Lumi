// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
import type { CapabilityDefinition, JsonValue } from '@lumiplug/shared'
import { Field, Input, InputHint, Select, Textarea } from './ui'
import type { Ref } from 'react'
import { safeRunAddress } from '../lib/tool-run'
import { RunParameterRow } from './RunParameterRow'
import { JsonEditor, KeyValues } from './ToolConfigFields'

/** Only existing request values are editable; execution targets stay fixed. */
export default function RunConfigurationFields({
  settings: s,
  operationName,
  operations,
  operation,
  onOperationChange,
  operationRef,
  change,
  disabled,
  section = 'all',
}: {
  settings: CapabilityDefinition['runner']['settings']
  operationName?: string
  operations?: Array<{ name: string; upstreamName?: string }>
  operation?: string
  onOperationChange?: (value: string) => void
  operationRef?: Ref<HTMLSelectElement>
  change: (settings: CapabilityDefinition['runner']['settings']) => void
  disabled: boolean
  section?: 'all' | 'connection' | 'values'
}) {
  useLocale()

  const set = (key: string, value: unknown) => change({ ...s, [key]: value } as typeof s)
  const address = (value: string) => (
    <div className="tool-run-connection-item">
      <InputHint label={s.type === 'http' ? t('请求地址') : t('MCP地址')} hint={value}>
        <Input
          aria-label={s.type === 'http' ? t('请求地址（固定）') : t('MCP地址（固定）')}
          readOnly
          value={value}
          title={value}
        />
      </InputHint>
    </div>
  )
  if (s.type === 'terminal') return null
  return (
    <>
      {s.type === 'http' && (
        <>
          {section !== 'values' && (
            <Field
              label={t('请求：')}
              inline
              controlWidth="wide"
              className="tool-field tool-run-connection"
            >
              <div className="tool-run-connection-controls" role="group" aria-label={t('请求目标')}>
                <div className="tool-run-connection-item tool-run-connection-method">
                  <Input aria-label={t('请求方式（固定）')} readOnly value={s.method} />
                </div>
                {address(safeRunAddress(s.url))}
              </div>
            </Field>
          )}
          {section !== 'connection' && (
            <KeyValues
              layout="parameters"
              label={t('请求头')}
              value={s.fixedHeaders}
              fixedKeys
              change={(v) => set('fixedHeaders', v)}
              editable={!disabled}
            />
          )}
          {section !== 'connection' &&
            s.bodyMode &&
            Object.entries(s.body ?? {}).map(([key, value]) => {
              const update = (next: unknown) =>
                set('body', {
                  ...((s.body as Record<string, JsonValue>) ?? {}),
                  [key]: next as JsonValue,
                })
              return typeof value === 'string' ? (
                <RunParameterRow key={key} label={t('正文参数 {v0}', { v0: key })} multiline>
                  <Textarea
                    rows={3}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => update(e.target.value)}
                  />
                </RunParameterRow>
              ) : (
                <JsonEditor
                  key={key}
                  label={t('正文参数 {v0}', { v0: key })}
                  layout="parameters"
                  value={value}
                  disabled={disabled}
                  onChange={update}
                />
              )
            })}
        </>
      )}
      {s.type === 'mcp' && (
        <>
          {section !== 'values' && (
            <Field
              label="MCP："
              inline
              controlWidth="wide"
              className="tool-field tool-run-connection"
            >
              <div
                className="tool-run-connection-controls tool-run-connection-controls--mcp"
                role="group"
                aria-label={t('MCP连接及工具')}
              >
                {address(
                  s.transport === 'stdio'
                    ? `stdio · ${s.command?.split(/[\\/]/).at(-1) || t('尚未配置')}`
                    : safeRunAddress(s.url ?? ''),
                )}
                {onOperationChange ? (
                  <Select
                    aria-label={t('MCP工具')}
                    ref={operationRef}
                    value={operation ?? ''}
                    disabled={disabled}
                    title={operations?.find((tool) => tool.name === operation)?.upstreamName ?? ''}
                    onChange={(event) => onOperationChange(event.target.value)}
                  >
                    <option value="">{t('请选择工具（可留空）')}</option>
                    {operations?.map((tool) => (
                      <option key={tool.name} value={tool.name}>
                        {tool.upstreamName ?? tool.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    aria-label={t('MCP工具（本次运行）')}
                    readOnly
                    value={operationName ?? ''}
                  />
                )}
              </div>
            </Field>
          )}
          {section !== 'connection' && (
            <KeyValues
              layout="parameters"
              label={t('请求头')}
              value={s.headers ?? {}}
              fixedKeys
              change={(v) => set('headers', v)}
              editable={!disabled}
            />
          )}
        </>
      )}
    </>
  )
}
