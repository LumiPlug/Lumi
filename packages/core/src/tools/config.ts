// SPDX-License-Identifier: MPL-2.0
import type { ValidateFunction } from 'ajv'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Ajv from 'ajv/dist/2020.js'
import { validateCapabilityDefinition, validResponseFilter } from '@lumiplug/shared'
import type {
  CapabilityDefinition,
  CapabilityTool,
  JsonObject,
  JsonSchema,
  JsonValue,
} from '@lumiplug/shared'
export class ToolError extends Error {
  constructor(
    public readonly code: string,
    public readonly key: string | null = null,
  ) {
    super(code)
    this.name = 'ToolError'
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: false })
function strings(value: unknown): boolean {
  return (
    record(value) &&
    Object.entries(value).every(
      ([key, val]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        typeof val === 'string' &&
        !key.includes('\0') &&
        !val.includes('\0'),
    )
  )
}
export function safeUrl(value: string): URL {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error()
    return url
  } catch {
    throw new ToolError('tool_config_incomplete')
  }
}
export function parseDefinition(value: unknown): CapabilityDefinition {
  try {
    if (
      !record(value) ||
      !record(value.runner) ||
      !record(value.runner.settings) ||
      !Array.isArray(value.tools)
    )
      throw new Error()
    const def = value as unknown as CapabilityDefinition
    if (
      typeof def.name !== 'string' ||
      typeof def.namespace !== 'string' ||
      typeof def.description !== 'string' ||
      typeof def.enabled !== 'boolean' ||
      typeof def.createdAt !== 'string' ||
      typeof def.updatedAt !== 'string' ||
      def.tools.length > 128
    )
      throw new Error()
    const settings = def.runner.settings
    if (settings.type === 'terminal') {
      if (
        typeof settings.cwd !== 'string' ||
        typeof settings.shell !== 'string' ||
        (settings.command !== undefined && typeof settings.command !== 'string') ||
        !strings(settings.environment)
      )
        throw new Error()
    } else if (settings.type === 'http') {
      if (
        typeof settings.url !== 'string' ||
        !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(settings.method) ||
        !Number.isInteger(settings.timeoutMs) ||
        settings.timeoutMs < 100 ||
        settings.timeoutMs > 300000 ||
        !strings(settings.fixedHeaders) ||
        (settings.responseMode !== undefined &&
          !['json', 'text'].includes(settings.responseMode)) ||
        (settings.bodyMode !== undefined && !['json', 'form'].includes(settings.bodyMode)) ||
        (settings.body !== undefined && !record(settings.body)) ||
        (settings.responseFilter !== undefined && !validResponseFilter(settings.responseFilter))
      )
        throw new Error()
    } else if (settings.type === 'mcp') {
      if (
        !['stdio', 'streamable-http'].includes(settings.transport) ||
        (settings.command !== null && typeof settings.command !== 'string') ||
        (settings.url !== null && typeof settings.url !== 'string') ||
        !Array.isArray(settings.args) ||
        !settings.args.every((a) => typeof a === 'string') ||
        !strings(settings.environment) ||
        (settings.headers !== undefined && !strings(settings.headers)) ||
        (settings.toolName !== undefined && typeof settings.toolName !== 'string')
      )
        throw new Error()
    } else throw new Error()
    for (const tool of def.tools) {
      if (
        !record(tool) ||
        typeof tool.name !== 'string' ||
        typeof tool.description !== 'string' ||
        !Array.isArray(tool.fields) ||
        tool.fields.length > 128 ||
        !record(tool.outputSchema)
      )
        throw new Error()
      ajv.compile(tool.outputSchema)
      if (tool.upstreamInputSchema !== undefined) {
        if (!record(tool.upstreamInputSchema)) throw new Error()
        new Ajv({ strict: false, validateFormats: false }).compile(tool.upstreamInputSchema)
      }
      if (
        tool.upstreamOutputSchemaMissing !== undefined &&
        typeof tool.upstreamOutputSchemaMissing !== 'boolean'
      )
        throw new Error()
      for (const field of tool.fields) {
        if (
          !record(field) ||
          typeof field.key !== 'string' ||
          ['__proto__', 'constructor', 'prototype'].includes(field.key) ||
          typeof field.required !== 'boolean' ||
          typeof field.aiVisible !== 'boolean' ||
          field.value === undefined ||
          !record(field.schema)
        )
          throw new Error()
        ajv.compile(field.schema)
        if (
          field.binding !== null &&
          (!record(field.binding) ||
            !['argument', 'body', 'header', 'mcpArgument', 'path', 'query', 'stdin'].includes(
              field.binding.location,
            ) ||
            typeof field.binding.key !== 'string' ||
            ['__proto__', 'constructor', 'prototype'].includes(field.binding.key))
        )
          throw new Error()
      }
    }
    if (!validateCapabilityDefinition(def).valid) throw new Error()
    return structuredClone(def)
  } catch {
    throw new ToolError('tool_config_invalid')
  }
}
export function checkExecutable(def: CapabilityDefinition): void {
  const s = def.runner.settings
  if (s.type === 'terminal') {
    if (
      !path.isAbsolute(terminalDirectory(s.cwd)) ||
      !fs.statSync(terminalDirectory(s.cwd), { throwIfNoEntry: false })?.isDirectory()
    )
      throw new ToolError('tool_config_incomplete', 'runner.cwd')
    if (
      !def.tools.every((t) => ['run', 'start'].includes(t.name)) ||
      !(s.command !== undefined
        ? s.command.trim()
        : def.tools[0]?.fields.some(
            (f) => f.key === 'command' && f.aiVisible && f.schema.type === 'string' && f.required,
          ))
    )
      throw new ToolError('tool_config_incomplete', 'runner.command')
    if (
      s.command !== undefined &&
      def.tools.some((t) =>
        t.fields.some(
          (f) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(f.key) || f.key === 'LUMIPLUG_SESSION_TOKEN',
        ),
      )
    )
      throw new ToolError('tool_config_invalid')
  }
  if (s.type === 'http') {
    try {
      safeUrl(s.url.replace(/\{[^}]+\}/g, 'placeholder'))
    } catch {
      throw new ToolError('tool_config_incomplete', 'runner.url')
    }
    if (['GET', 'DELETE'].includes(s.method) && s.body && Object.keys(s.body).length)
      throw new ToolError('tool_config_incomplete')
    if (s.responseFilter !== undefined && !validResponseFilter(s.responseFilter))
      throw new ToolError('tool_config_invalid')
    try {
      new Headers(s.fixedHeaders)
    } catch {
      throw new ToolError('tool_config_incomplete')
    }
    for (const tool of def.tools)
      for (const f of tool.fields) {
        if (!f.binding || !['body', 'header', 'path', 'query'].includes(f.binding.location))
          throw new ToolError('tool_config_incomplete')
        if (['GET', 'DELETE'].includes(s.method) && f.binding.location === 'body')
          throw new ToolError('tool_config_incomplete')
      }
  }
  if (s.type === 'mcp') {
    if (s.transport === 'stdio' && !s.command?.trim())
      throw new ToolError('tool_config_incomplete', 'runner.command')
    if (s.transport === 'streamable-http') {
      try {
        safeUrl(s.url ?? '')
      } catch {
        throw new ToolError('tool_config_incomplete', 'runner.url')
      }
    }
    if (def.tools.some((tool) => !tool.upstreamName || !tool.upstreamSignature))
      throw new ToolError('tool_config_incomplete')
  }
  for (const tool of def.tools)
    for (const f of tool.fields) {
      if (!f.aiVisible && (f.value === null || !ajv.compile(f.schema)(f.value)))
        throw new ToolError('tool_config_incomplete')
    }
}
/** Blank or the original factory default uses the user's home, never the Core launcher cwd. */
export function terminalDirectory(cwd: string): string {
  return !cwd.trim() || cwd === '.' ? os.homedir() : cwd
}
/** A declared property allow-list, including nested objects; no undeclared response fields. */
export function projectOutput(value: JsonValue, schema: JsonSchema): JsonValue {
  if (Array.isArray(value))
    return schema.items ? value.slice(0, 1000).map((v) => projectOutput(v, schema.items!)) : []
  if (record(value)) {
    const out: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (Object.hasOwn(value, key) && !['__proto__', 'constructor', 'prototype'].includes(key))
        out[key] = projectOutput(value[key] as JsonValue, child)
    return out
  }
  return value
}

/** Build the upstream input once; hidden names/values never become public arguments. */
export function mergeMcpArguments(tool: CapabilityTool, args: JsonObject): JsonObject {
  const merged: JsonObject = {}
  for (const field of tool.fields) {
    const value = field.aiVisible ? args[field.key] : field.value
    if (value !== undefined) merged[field.binding?.key ?? field.key] = value
  }
  return merged
}
const upstreamValidators = new Map<string, ValidateFunction>()
export function validateMcpArguments(
  tool: CapabilityTool,
  args: JsonObject,
  alreadyMerged = false,
): boolean {
  if (!tool.upstreamInputSchema) return true
  const key = JSON.stringify(tool.upstreamInputSchema)
  let validate = upstreamValidators.get(key)
  if (!validate) {
    validate = new Ajv({ strict: false, validateFormats: false }).compile(tool.upstreamInputSchema)
    if (upstreamValidators.size >= 128)
      upstreamValidators.delete(upstreamValidators.keys().next().value!)
    upstreamValidators.set(key, validate)
  }
  return !!validate(alreadyMerged ? args : mergeMcpArguments(tool, args))
}
