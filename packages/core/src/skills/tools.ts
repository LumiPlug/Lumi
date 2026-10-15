// SPDX-License-Identifier: MPL-2.0

import type { AiToolView, JsonSchema } from '@lumiplug/shared'

const id: JsonSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' }
function tool(
  name: string,
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): AiToolView {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true },
  }
}

export const SKILL_TOOLS: AiToolView[] = [
  tool(
    'Lumi.search_skills',
    '任务开始时按用途查询 Lumi 托管技能。仅返回可用技能摘要；匹配后调用 Lumi.get_skill 加载说明。空查询列出目录，offset/limit 分页。不会安装或执行。',
    {
      query: { type: 'string', maxLength: 1000 },
      offset: { type: 'integer', minimum: 0, maximum: 100000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
  ),
  tool(
    'Lumi.get_skill',
    '加载已发现的 Lumi 技能完整 SKILL.md 和附件目录。遵循说明处理当前任务，引用文件通过 Lumi.read_skill_file 按需读取；加载不执行脚本，也不补齐插件、账号或依赖。',
    { id },
    ['id'],
  ),
  tool(
    'Lumi.read_skill_file',
    '按技能 ID 和相对路径读取附件、参考资料、模板或脚本。只限已托管且未归档技能，拒绝目录穿越与符号链接；文本最多 256 KiB，图片最多 1 MiB，其余返回不支持状态。此工具只读不执行。',
    {
      id,
      path: { type: 'string', minLength: 1, maxLength: 4096 },
    },
    ['id', 'path'],
  ),
]
