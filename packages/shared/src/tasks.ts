// SPDX-License-Identifier: MPL-2.0
import type { JsonObject, JsonValue } from './json'
import type { CapabilityDefinition } from './capability'
export type TaskSource = 'manual' | 'ai' | 'workbench'
export type TaskStatus =
  'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted'
export interface ToolTask {
  id: string
  capabilityId: string
  capabilityName: string
  operation: string
  version: number
  runnerType: 'terminal' | 'http' | 'mcp'
  source: TaskSource
  status: TaskStatus
  startedAt: string
  finishedAt: string | null
  result: JsonValue | null
  error: string | null
  stdout: string
  stderr: string
  truncated: boolean
  cancellationUncertain: boolean
  /** Bounded local execution events. Older stored tasks may have no events. */
  events?: Array<{ at: string; message: string }>
  /** Same-session replay availability; arguments are never exposed here. */
  canRestart?: boolean
}
export const TOOL_ERRORS: Record<string, string> = {
  tool_archived: '工具已归档，请先恢复后再审阅启用。',
  tool_config_invalid: '配置格式不正确，请检查字段和 JSON。',
  tool_config_incomplete: '配置尚未完整，请检查目录、目标地址或操作参数。',
  tool_schema_invalid: '参数或输出 Schema 无效，请检查 JSON Schema。',
  tool_version_conflict: '配置已被修改。你的输入已保留，请查看最新版本后重新编辑。',
  capability_not_found: '工具已不存在，请刷新列表。',
  public_tool_name_conflict: '公开操作名称与其他工具冲突，请修改命名空间。',
  reserved_tool_namespace: 'Lumi 是系统保留命名空间，请使用其他名称。',
  public_tool_name_too_long: '公开操作名称过长，请缩短命名空间或操作名称。',
  ai_tool_not_found_or_disabled: '工具未启用，请先审阅配置并授权。',
  invalid_tool_arguments: '运行参数不符合要求，请检查必填项与参数类型。',
  tool_execution_failed: '执行失败，请检查配置和目标服务。',
  tool_terminal_environment_failed:
    '无法加载系统终端环境，请检查默认 Shell 及其启动配置是否能正常完成。',
  tool_response_filter_timeout: '返回字段匹配超时，请简化正则表达式后重试。',
  tool_http_failed: 'HTTP 请求失败，请检查目标服务、超时或响应格式。',
  tool_mcp_failed: 'MCP 连接或调用失败，请检查上游配置。',
  tool_mcp_schema_refresh_required:
    '这条旧 MCP 记录缺少输出来源信息，请重新发现工具并确认输出规则后再运行。',
  tool_mcp_changed: '上游操作已变化，工具已转为草稿。请重新读取操作并授权。',
  tool_output_too_large: '响应超过预览上限，请缩小请求返回内容。',
  tool_busy: '正在运行的任务已达上限，请停止任务或稍后重试。',
  task_not_found: '运行记录已不存在，请刷新。',
  task_restart_unavailable: '重启应用或修改配置后无法直接重跑，请重新填写运行参数。',
  tool_request_invalid: '请求无效，请刷新后重试。',
}

/** Manual preflight returns effective public arguments, never fixed values or runner settings. */
export type ToolRunPreparation =
  | { ok: true; effective: JsonObject; requiredInputs: string[] }
  | { ok: false; key: string | null; message: string; requiredInputs: string[] }

/** Host manual runs only; never saves or changes the AI tool definition. */
export interface ToolRunOverrides {
  settings: CapabilityDefinition['runner']['settings']
  fixedParameters: JsonObject
}

/** Desktop-only historical configuration; never included in public MCP task responses. */
export interface ToolTaskInputSnapshot {
  definition: CapabilityDefinition
  operation: string
  arguments: JsonObject
}
