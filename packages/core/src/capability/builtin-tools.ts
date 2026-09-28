// SPDX-License-Identifier: MPL-2.0

import { CORE_VERSION } from '@lumiplug/shared'
import type { AiToolView, CapabilityDefinition, JsonObject, JsonSchema } from '@lumiplug/shared'

const emptyInput: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }
const objectOutput: JsonSchema = { type: 'object', additionalProperties: true }
const safeName: JsonSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9._-]{0,63}$' }

export const BUILTIN_TOOLS: AiToolView[] = [
  {
    name: 'lumi.get_context',
    description: '读取 Lumi 的版本和当前支持的功能。连接后先调用此工具，确认哪些功能实际可用。',
    inputSchema: emptyInput,
    outputSchema: objectOutput,
  },
  {
    name: 'lumi.list_capabilities',
    description: '读取能力目录及草稿、启用状态。仅返回公开信息，不返回内部执行配置。',
    inputSchema: emptyInput,
    outputSchema: objectOutput,
  },
  {
    name: 'lumi.create_capability_draft',
    description:
      '在 Lumi 中创建能力草稿。草稿不会启用或执行；用户在应用中审阅后才能启用。名称与命名空间使用英文字母开头的标识符。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['terminal', 'http', 'mcp'] },
        name: safeName,
        namespace: { ...safeName, description: '工具分组，默认为 local；lumi 为保留命名空间。' },
        description: { type: 'string', maxLength: 1000 },
      },
      required: ['kind', 'name'],
      additionalProperties: false,
    },
    outputSchema: objectOutput,
  },
]

/** Deliberate allow-list: never return the UI summary's runnerType or settings. */
export function publicCapability(definition: CapabilityDefinition): JsonObject {
  return {
    id: definition.id,
    name: definition.name,
    namespace: definition.namespace,
    description: definition.description,
    version: definition.version,
    status: definition.status,
    enabled: definition.enabled,
    toolCount: definition.tools.length,
  }
}

export function publicContext(): JsonObject {
  return {
    name: 'Lumi',
    version: CORE_VERSION,
    features: {
      capabilityDiscovery: true,
      capabilityDrafts: true,
      runnerExecution: false,
      workbenchEditing: false,
      memory: false,
      skills: false,
    },
    guidance:
      '使用 lumi.list_capabilities 查看目录；能力变化后重新调用 tools/list。只能创建草稿，启用由用户在应用中完成。尚未接入的执行与工作台编辑功能不要声称已完成。',
  }
}
