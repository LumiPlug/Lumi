// SPDX-License-Identifier: MPL-2.0
import type {
  CapabilityDefinition,
  CapabilityField,
  CapabilityTool,
  JsonObject,
  JsonValue,
  ToolTask,
  ToolRunOverrides,
} from '@lumiplug/shared'

export type RunValues = Record<string, string>

/** Choose from the saved contract so typing does not replace the focused control. */
export function multilineRunField(field: CapabilityField): boolean {
  if (!field.aiVisible) return false
  if (field.schema.type === 'object' || field.schema.type === 'array') return true
  return (
    field.schema.type === 'string' &&
    !field.schema.enum &&
    (field.key === 'command' ||
      field.schema.maxLength === undefined ||
      Number(field.schema.maxLength) > 160 ||
      (typeof field.schema.default === 'string' && /[\r\n]/.test(field.schema.default)))
  )
}

/** A readable view of returned data; escape content so it cannot create links or images. */
export function runResultMarkdown(text: string): string {
  const escape = (value: string) => value.replace(/[\\`*_[\]{}<>#+.!|~-]/g, '\\$&')
  let value: JsonValue
  try {
    value = JSON.parse(text) as JsonValue
  } catch {
    return escape(text).replace(/\n/g, '  \n')
  }
  const rows: string[] = []
  let limited = false
  const visit = (item: JsonValue, path: string[], depth: number) => {
    if (rows.length >= 100) {
      limited = true
      return
    }
    if (item !== null && typeof item === 'object' && depth < 8) {
      const entries = Array.isArray(item)
        ? item.map((child, index) => [String(index + 1), child] as const)
        : Object.entries(item)
      if (!entries.length) {
        rows.push(`${path.length ? `**${escape(path.join(' / '))}**\n\n` : ''}无内容`)
        return
      }
      for (const [key, child] of entries) {
        visit(child, [...path, key], depth + 1)
        if (limited) break
      }
      return
    }
    const content =
      item === null
        ? '空值'
        : item === true
          ? '是'
          : item === false
            ? '否'
            : typeof item === 'object'
              ? JSON.stringify(item)
              : String(item)
    rows.push(
      `${path.length ? `**${escape(path.join(' / '))}**\n\n` : ''}${escape(content).replace(/\n/g, '  \n')}`,
    )
  }
  visit(value, [], 0)
  return rows.join('\n\n') + (limited ? '\n\n内容较长，其余内容请查看原始数据。' : '')
}
/** Execution evidence only: a remote final response belongs to the result stage. */
export function runLogText(task: ToolTask): string {
  if (task.runnerType !== 'terminal')
    return (task.events ?? []).map((event) => event.message).join('\n')
  return [
    task.stdout.replace(/\r?\n$/, ''),
    task.stderr
      ? task.stderr
          .replace(/\r?\n$/, '')
          .split(/\r?\n/)
          .map((line) => `[stderr] ${line}`)
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
export function needsRunInput(field: CapabilityField, requiredInputs?: string[]): boolean {
  return (
    field.aiVisible &&
    (requiredInputs
      ? requiredInputs.includes(field.key)
      : field.required && field.schema.default === undefined)
  )
}
export function formatRunValue(field: CapabilityField, value: JsonValue): string {
  return field.schema.type === 'string' && typeof value === 'string' ? value : JSON.stringify(value)
}
export function runFieldValue(field: CapabilityField, values: RunValues): string {
  return Object.hasOwn(values, field.key)
    ? values[field.key]!
    : !field.aiVisible && field.value !== null
      ? formatRunValue(field, field.value)
      : field.schema.default !== undefined
        ? formatRunValue(field, field.schema.default)
        : ''
}
export type RunInputResult =
  { ok: true; args: JsonObject } | { ok: false; key: string | null; message: string }
export function prepareRunInputs(tool: CapabilityTool, values: RunValues): RunInputResult {
  const entries: Array<[string, JsonValue]> = []
  for (const field of tool.fields.filter((f) => f.aiVisible)) {
    if (!Object.hasOwn(values, field.key)) continue
    try {
      const text = values[field.key]!
      entries.push([
        field.key,
        field.schema.type === 'string' ? text : (JSON.parse(text) as JsonValue),
      ])
    } catch {
      return { ok: false, key: field.key, message: '请填写有效的 JSON 参数。' }
    }
  }
  const args = Object.fromEntries(entries) as JsonObject
  return { ok: true, args }
}
export function runParameterPreview(
  tool: CapabilityTool,
  values: RunValues,
  effective?: JsonObject,
) {
  return tool.fields
    .filter((f) => f.aiVisible)
    .map((field) => {
      const source = Object.hasOwn(values, field.key)
        ? '本次输入'
        : field.schema.default !== undefined
          ? '工具默认值'
          : field.required
            ? '未填写（必填）'
            : '未提供'
      return {
        key: field.key,
        source,
        value:
          effective && Object.hasOwn(effective, field.key)
            ? formatRunValue(field, effective[field.key]!)
            : Object.hasOwn(values, field.key) || field.schema.default !== undefined
              ? runFieldValue(field, values)
              : null,
      }
    })
}

export function safeRunAddress(address: string): string {
  try {
    const url = new URL(address)
    url.username = ''
    url.password = ''
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '…')
    url.pathname = url.pathname.replace(/\/(token|secret|api[_-]?key)\/[^/]+/gi, '/$1/…')
    return url.toString()
  } catch {
    return (
      address
        .split(/[?#]/)[0]!
        .replace(/(\/\/)[^/@]+@/, '$1')
        .replace(/\/(token|secret|api[_-]?key)\/[^/]+/gi, '/$1/…') || '尚未配置'
    )
  }
}

/** Display targets without credentials or query values from fixed connection settings. */
export function runTargetDetails(
  definition: CapabilityDefinition,
  operation: string,
): Array<[string, string]> {
  const runner = definition.runner.settings

  if (runner.type === 'terminal')
    return [['工作目录', !runner.cwd || runner.cwd === '.' ? '用户主目录（默认）' : runner.cwd]]
  if (runner.type === 'http')
    return [
      ['请求方式', runner.method],
      ['请求地址', safeRunAddress(runner.url)],
    ]
  const selected = definition.tools.find((tool) => tool.name === operation)
  return [
    [
      runner.transport === 'stdio' ? '本机连接' : '访问地址',
      runner.transport === 'stdio'
        ? `本机进程（stdio） · ${runner.command?.split(/[\\/]/).at(-1) || '尚未配置'}`
        : safeRunAddress(runner.url ?? ''),
    ],
    ['工具名称', runner.toolName || '全部工具'],
    ...(definition.tools.length > 1
      ? [['本次调用', selected?.upstreamName ?? selected?.name ?? '待选择'] as [string, string]]
      : []),
  ]
}

export function prepareManualInputs(
  tool: CapabilityTool,
  values: RunValues,
):
  | { ok: true; args: JsonObject; fixedParameters: ToolRunOverrides['fixedParameters'] }
  | { ok: false; key: string | null; message: string } {
  const publicInputs = prepareRunInputs(tool, values)
  if (!publicInputs.ok) return publicInputs
  const fixedParameters: JsonObject = {}
  for (const field of tool.fields.filter((f) => !f.aiVisible)) {
    if (!Object.hasOwn(values, field.key)) continue
    try {
      fixedParameters[field.key] =
        field.schema.type === 'string' ? values[field.key]! : JSON.parse(values[field.key]!)
    } catch {
      return { ok: false, key: field.key, message: '请填写有效的 JSON 参数。' }
    }
  }
  return { ...publicInputs, fixedParameters }
}

/** Full host-only inspection, including current edits, never saved or sent to AI. */
export function runConfigurationPreview(
  definition: CapabilityDefinition,
  settings: CapabilityDefinition['runner']['settings'],
  operation: string,
  values: RunValues,
  effective?: JsonObject,
  frozen = false,
) {
  const current = structuredClone(definition)
  current.runner.settings = structuredClone(settings)
  const selected = current.tools.find((tool) => tool.name === operation)
  const parameters: JsonObject = {}
  for (const field of selected?.fields ?? []) {
    if (frozen && field.aiVisible && effective && Object.hasOwn(effective, field.key))
      parameters[field.key] = effective[field.key]!
    else if (Object.hasOwn(values, field.key)) {
      const raw = values[field.key]!
      try {
        parameters[field.key] = field.schema.type === 'string' ? raw : JSON.parse(raw)
      } catch {
        parameters[field.key] = raw
      }
    } else if (field.aiVisible && effective && Object.hasOwn(effective, field.key))
      parameters[field.key] = effective[field.key]!
    else if (!field.aiVisible) parameters[field.key] = field.value
    else if (field.schema.default !== undefined) parameters[field.key] = field.schema.default
    if (!field.aiVisible && Object.hasOwn(values, field.key)) field.value = parameters[field.key]!
  }
  return {
    本次工具: operation ? `${definition.namespace}.${operation}` : null,
    本次运行参数: parameters,
    完整工具配置: current,
  }
}
