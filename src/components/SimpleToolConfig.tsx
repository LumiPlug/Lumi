// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
import {
  Input,
  Textarea,
  Button,
  Select,
  Field,
  Checkbox,
  FieldGroup,
  FieldRow,
  InputHint,
} from './ui'
import { useId } from 'react'
import type { ReactNode } from 'react'
import type { CapabilityDefinition, CapabilityField, JsonValue } from '@lumiplug/shared'
import { JsonEditor, KeyValues, RawInputContext } from './ToolConfigFields'
import { TerminalWorkingDirectory } from './TerminalWorkingDirectory'
import { ToolFieldTitle } from './ToolHint'
import { TerminalParameters } from './TerminalParameters'

export function ToolIdentity({
  definition: d,
  change,
  disabled,
  children,
}: {
  definition: CapabilityDefinition
  change: (d: CapabilityDefinition) => void
  disabled: boolean
  children?: ReactNode
}) {
  useLocale()

  const descriptionId = useId()
  return (
    <>
      <Field label={t('工具名称')} inline className="tool-field">
        <Input
          data-validation="name"
          value={d.name}
          disabled={disabled}
          maxLength={64}
          placeholder={t('例如：开发助手')}
          onChange={(e) => change({ ...d, name: e.target.value })}
        />
      </Field>
      {children}
      <Field label={t('用途说明')} optional className="tool-field">
        <Textarea
          id={descriptionId}
          rows={5}
          value={d.description}
          disabled={disabled}
          maxLength={1000}
          showCount
          placeholder={t('告诉自己和 AI，这个工具用来做什么')}
          onChange={(e) => change({ ...d, description: e.target.value })}
        />
      </Field>
    </>
  )
}
function Parameters({
  definition: d,
  change,
  disabled,
  terminal,
}: {
  definition: CapabilityDefinition
  change: (d: CapabilityDefinition) => void
  disabled: boolean
  terminal: boolean
}) {
  useLocale()

  const fields = d.tools[0]?.fields ?? []
  const location = terminal
    ? 'argument'
    : d.runner.settings.type === 'http' && d.runner.settings.bodyMode
      ? 'body'
      : 'query'
  function update(next: CapabilityField[]) {
    change({ ...d, tools: d.tools.map((t) => ({ ...t, fields: next })) })
  }
  if (terminal)
    return <TerminalParameters key={d.id} fields={fields} change={update} disabled={disabled} />
  const add = !disabled && (
    <Button
      type="button"
      className="tool-button"
      onClick={() =>
        update([
          ...fields,
          {
            key: `param${fields.length + 1}`,
            schema: { type: 'string', default: '', description: '' },
            required: false,
            aiVisible: true,
            value: null,
            binding: { location, key: `param${fields.length + 1}` },
          },
        ])
      }
    >
      {t('添加参数')}
    </Button>
  )
  const rows = fields.map((f, i) => {
    const editors = [
      <Field key="name" label={terminal ? t('变量名') : t('参数名')} className="tool-field">
        <Input
          data-validation={`tools[0].fields[${i}].key`}
          value={f.key}
          disabled={disabled}
          placeholder={terminal ? 'PROJECT' : 'keyword'}
          onChange={(e) =>
            update(
              fields.map((x, j) =>
                j === i
                  ? { ...x, key: e.target.value, binding: { location, key: e.target.value } }
                  : x,
              ),
            )
          }
        />
      </Field>,
      <Field key="default" label={t('默认值')} className="tool-field">
        <Input
          disabled={disabled || f.schema.default === undefined}
          value={typeof f.schema.default === 'string' ? f.schema.default : ''}
          onChange={(e) =>
            update(
              fields.map((x, j) =>
                j === i ? { ...x, schema: { ...x.schema, default: e.target.value } } : x,
              ),
            )
          }
        />
      </Field>,
      <Field key="description" label={t('输入说明')} className="tool-field">
        <Input
          value={f.schema.description ?? ''}
          disabled={disabled}
          placeholder={t('供自己和 AI 理解参数')}
          onChange={(e) =>
            update(
              fields.map((x, j) =>
                j === i ? { ...x, schema: { ...x.schema, description: e.target.value } } : x,
              ),
            )
          }
        />
      </Field>,
    ]
    const remove = !disabled && (
      <Button
        type="button"
        className="tool-button"
        aria-label={t('删除参数 {v0}', { v0: f.key || i + 1 })}
        onClick={() => update(fields.filter((_, j) => j !== i))}
      >
        {t('删除')}
      </Button>
    )
    const options = (
      <>
        <Checkbox
          label={t('必填')}
          disabled={disabled}
          checked={f.required}
          onChange={(event) =>
            update(fields.map((x, j) => (j === i ? { ...x, required: event.target.checked } : x)))
          }
        />
        <Checkbox
          label={t('使用默认值')}
          disabled={disabled}
          checked={f.schema.default !== undefined}
          onChange={(event) =>
            update(
              fields.map((x, j) => {
                if (j !== i) return x
                const schema = { ...x.schema }
                if (event.target.checked) schema.default = ''
                else delete schema.default
                return { ...x, schema }
              }),
            )
          }
        />
      </>
    )
    return (
      <FieldRow
        key={i}
        label={`${terminal ? t('外部参数') : t('请求参数')} ${i + 1}`}
        fields={editors}
        options={options}
        action={remove}
      />
    )
  })
  return (
    <FieldGroup
      label={terminal ? t('外部参数') : t('请求参数')}
      hint={
        terminal
          ? t(
              '无需参数时可留空。默认值和说明会提供给 AI，请勿填写凭据。命令通过 $变量名 读取；Windows 使用 %变量名%。',
            )
          : t('无需传参时可留空。默认值和说明会提供给 AI，请勿填写凭据。')
      }
      action={add}
    >
      {rows}
    </FieldGroup>
  )
}
export default function SimpleToolConfig({
  definition: d,
  change,
  editable,
  busy,
  discover,
  onRawChange,
  identity = true,
}: {
  definition: CapabilityDefinition
  change: (d: CapabilityDefinition) => void
  editable: boolean
  busy: boolean
  discover: () => void
  onRawChange: () => void
  identity?: boolean
}) {
  useLocale()

  const s = d.runner.settings,
    disabled = !editable || busy
  const toolNameId = useId()
  const argumentsId = useId()
  function setting(key: string, value: unknown) {
    change({
      ...d,
      runner: { ...d.runner, settings: { ...s, [key]: value } },
      tools:
        s.type === 'mcp'
          ? d.tools.map((t) => {
              const next = { ...t }
              delete next.upstreamName
              delete next.upstreamSignature
              return next
            })
          : d.tools,
    } as CapabilityDefinition)
  }
  function mode(value: string) {
    if (s.type !== 'http') return
    const settings = {
      ...s,
      bodyMode: value === 'query' ? undefined : (value as 'json' | 'form'),
      body: value === 'json' ? s.body : undefined,
    }
    change({
      ...d,
      runner: { type: 'http', settings },
      tools: d.tools.map((t) => ({
        ...t,
        fields: t.fields.map((f) => ({
          ...f,
          binding: { location: value === 'query' ? 'query' : 'body', key: f.binding?.key ?? f.key },
        })),
      })),
    })
  }
  return (
    <RawInputContext.Provider value={onRawChange}>
      <div className="tool-config-layout">
        {identity && <ToolIdentity definition={d} change={change} disabled={disabled} />}
        {s.type === 'terminal' && (
          <>
            <TerminalWorkingDirectory
              value={s.cwd}
              change={(value) => setting('cwd', value)}
              disabled={disabled}
              readOnly={!editable}
            />
            <Parameters definition={d} change={change} disabled={disabled} terminal />
            <Field label={t('Shell 命令')} className="tool-field">
              <Textarea
                className="tool-code"
                data-validation="runner.settings.command"
                rows={7}
                spellCheck={false}
                value={s.command ?? ''}
                disabled={disabled}
                placeholder={t('# 支持多行命令\nprintf "%s\\n" "$PROJECT"')}
                onChange={(e) => setting('command', e.target.value)}
              />
            </Field>
          </>
        )}
        {s.type === 'http' && (
          <>
            <div className="tool-http-address">
              <Field label={t('请求方式')} inline className="tool-field">
                <Select
                  data-validation="runner.settings.method"
                  value={s.method}
                  disabled={disabled}
                  onChange={(e) => setting('method', e.target.value)}
                >
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('请求地址')} inline className="tool-field">
                <Input
                  data-validation="runner.settings.url"
                  value={s.url}
                  disabled={disabled}
                  placeholder="https://example.com/api"
                  onChange={(e) => setting('url', e.target.value)}
                />
              </Field>
            </div>
            <KeyValues
              label={t('请求头')}
              path="runner.settings.fixedHeaders"
              value={s.fixedHeaders}
              change={(v) => setting('fixedHeaders', v)}
              editable={!disabled}
            />
            <Field label={t('请求参数格式')} inline className="tool-field">
              <Select
                value={s.bodyMode ?? 'query'}
                disabled={disabled}
                onChange={(e) => mode(e.target.value)}
              >
                <option value="query">{t('Query 查询参数')}</option>
                <option value="form">{t('Form 表单')}</option>
                <option value="json">Body（JSON）</option>
              </Select>
            </Field>
            <Parameters definition={d} change={change} disabled={disabled} terminal={false} />
            {s.bodyMode === 'json' && (
              <JsonEditor
                label={t('请求 Body（JSON，可选）')}
                value={s.body ?? {}}
                path="runner.settings.body"
                kind="object"
                disabled={disabled}
                onChange={(v) => setting('body', v)}
              />
            )}
            <JsonEditor
              label={t('允许返回字段（JSON 正则规则，可选）')}
              hint={t(
                '与返回 JSON 使用相同结构，叶值填正则，例如 {"data":{"name":".+","id":"^\\\\d+$"}}。数组用一个元素描述每项；匹配则保留原值，不匹配则移除。留空对象沿用原输出规则。',
              )}
              value={s.responseFilter ?? {}}
              path="runner.settings.responseFilter"
              kind="object"
              disabled={disabled}
              onChange={(v) => {
                const filter = v as Record<string, JsonValue>
                change({
                  ...d,
                  runner: {
                    type: 'http',
                    settings: {
                      ...s,
                      responseMode: 'json',
                      responseFilter: Object.keys(filter).length ? filter : undefined,
                    },
                  },
                })
              }}
            />
          </>
        )}
        {s.type === 'mcp' && (
          <>
            <Field label={t('连接方式')} inline className="tool-field">
              <Select
                disabled={disabled}
                value={s.transport}
                onChange={(e) => setting('transport', e.target.value)}
              >
                <option value="streamable-http">{t('HTTP 服务')}</option>
                <option value="stdio">{t('本机程序（stdio）')}</option>
              </Select>
            </Field>
            {s.transport === 'streamable-http' ? (
              <>
                <Field label={t('MCP 地址')} inline className="tool-field">
                  <Input
                    data-validation="runner.settings.url"
                    value={s.url ?? ''}
                    disabled={disabled}
                    placeholder="https://example.com/mcp"
                    onChange={(e) => setting('url', e.target.value)}
                  />
                </Field>
                <KeyValues
                  label="Header"
                  path="runner.settings.headers"
                  value={s.headers ?? {}}
                  change={(v) => setting('headers', v)}
                  editable={!disabled}
                />
              </>
            ) : (
              <>
                <Field label={t('启动程序')} inline className="tool-field">
                  <Input
                    data-validation="runner.settings.command"
                    value={s.command ?? ''}
                    disabled={disabled}
                    placeholder={t('例如 npx')}
                    onChange={(e) => setting('command', e.target.value)}
                  />
                </Field>
                <div className="ui-field tool-field">
                  <ToolFieldTitle htmlFor={argumentsId} label={t('启动参数')} />
                  <InputHint label={t('启动参数')} hint={t('每行填写一个启动参数。')} multiline>
                    <Textarea
                      id={argumentsId}
                      rows={3}
                      value={s.args.join('\n')}
                      disabled={disabled}
                      onChange={(e) => setting('args', e.target.value.split('\n'))}
                      onBlur={() => {
                        if (editable) setting('args', s.args.filter(Boolean))
                      }}
                    />
                  </InputHint>
                </div>
              </>
            )}
            <div className="ui-field ui-field--inline tool-field">
              <ToolFieldTitle htmlFor={toolNameId} label={t('工具名')} optional />
              <div className="ui-field-control">
                <div className="tool-control-row">
                  <InputHint
                    label={t('工具名')}
                    hint={t(
                      '留空读取全部工具，填写则精确匹配上游名称。读取会连接服务或启动程序，获取真实工具及参数。修改连接或工具名后请重新读取。',
                    )}
                  >
                    <Input
                      id={toolNameId}
                      value={s.toolName ?? ''}
                      disabled={disabled}
                      placeholder={t('留空读取全部工具')}
                      onChange={(e) => setting('toolName', e.target.value)}
                    />
                  </InputHint>
                  {editable && (
                    <Button
                      type="button"
                      className="tool-button"
                      disabled={busy}
                      onClick={discover}
                    >
                      {t('读取工具')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="tool-discovery">
              {d.tools.every((t) => t.upstreamName) && (
                <p className="tool-help">
                  {t('已读取 ')}
                  {d.tools.length} {t(' 个操作：')}
                  {d.tools.map((t) => t.upstreamName).join('、')}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </RawInputContext.Provider>
  )
}
