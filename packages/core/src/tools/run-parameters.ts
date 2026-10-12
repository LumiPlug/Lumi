// SPDX-License-Identifier: MPL-2.0
import Ajv from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import { deriveAiToolView } from '@lumiplug/shared'
import type {
  CapabilityDefinition,
  CapabilityTool,
  JsonObject,
  ToolRunPreparation,
} from '@lumiplug/shared'
import { validateMcpArguments } from './config'
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false, useDefaults: true })
const validators = new Map<string, ValidateFunction>()
function compile(schema: object) {
  const key = JSON.stringify(schema)
  let validate = validators.get(key)
  if (!validate) {
    validate = ajv.compile(schema)
    if (validators.size >= 128) {
      const oldest = validators.keys().next().value!
      ajv.removeSchema(validators.get(oldest)?.schema)
      validators.delete(oldest)
    }
    validators.set(key, validate)
  }
  return validate
}
export function prepareRunArguments(
  definition: CapabilityDefinition,
  tool: CapabilityTool,
  args: JsonObject,
): ToolRunPreparation {
  const view = deriveAiToolView(definition, tool)
  const requiredInputs = tool.fields
    .filter((field) => {
      if (!field.aiVisible || !field.required) return false
      if (field.schema.default === undefined) return true
      try {
        return !compile({
          type: 'object',
          properties: { value: view.inputSchema.properties![field.key] },
          required: ['value'],
        })({})
      } catch {
        return true
      }
    })
    .map((field) => field.key)
  const effective = structuredClone(args)
  try {
    const validate = compile(view.inputSchema)
    if (validate(effective)) {
      if (definition.runner.type === 'mcp' && !validateMcpArguments(tool, effective))
        return {
          ok: false,
          key: null,
          requiredInputs,
          message: '参数不符合上游工具的完整约束，请检查可见参数与预设配置。',
        }
      return { ok: true, effective, requiredInputs }
    }
    const error = validate.errors?.[0]
    const candidate = error?.instancePath
      ? error.instancePath.split('/')[1]!.replaceAll('~1', '/').replaceAll('~0', '~')
      : typeof error?.params.missingProperty === 'string'
        ? error.params.missingProperty
        : null
    const key = tool.fields.some((f) => f.aiVisible && f.key === candidate) ? candidate : null
    return {
      ok: false,
      key,
      requiredInputs,
      message:
        error?.keyword === 'required'
          ? '请填写本次运行必需的参数。'
          : '参数不符合工具要求，请检查格式和取值。',
    }
  } catch {
    return { ok: false, key: null, requiredInputs, message: '工具参数定义无效，请检查工具配置。' }
  }
}
