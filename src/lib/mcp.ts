// SPDX-License-Identifier: MPL-2.0

import type { McpConnectionInfo } from '@lumiplug/shared'

export type PromptType = 'connection' | 'assistant' | 'features'
export type McpTransport = 'http' | 'stdio'

export function formatMcpConfig(
  connection: McpConnectionInfo,
  transport: McpTransport = 'http',
): string {
  if (transport === 'stdio' && !connection.stdioCommand) return ''
  const server =
    transport === 'stdio'
      ? {
          command: connection.stdioCommand,
          args: ['--core-url', new URL(connection.endpoint).origin],
          env: { LUMIPLUG_SESSION_TOKEN: connection.sessionToken },
        }
      : { url: connection.endpoint, headers: { [connection.authHeader]: connection.sessionToken } }
  return JSON.stringify(
    {
      mcpServers: {
        lumi: server,
      },
    },
    null,
    2,
  )
}

export function mcpAvailability(connection: McpConnectionInfo | null): string {
  if (!connection) return '请在 Lumi 桌面应用中查看并复制当前会话的 MCP 配置。'
  if (connection.coreState !== 'ready') return '本地服务尚未就绪，请启动 Lumi 后重试连接。'
  if (!connection.gatewayAvailable) return '当前版本尚未启用 MCP 网关，配置暂不能完成连接。'
  return '请保持 Lumi 运行，使用以下配置连接本机服务。'
}

const templates: Record<PromptType, string> = {
  connection: `请帮我在当前 AI 软件中配置 Lumi MCP 连接。

1. 确认当前 AI 软件支持的 MCP 配置方式，将下面的连接信息转换为该软件需要的格式。
2. 使用 Streamable HTTP 连接本机 Lumi，保留完整 URL 和认证请求头。需要我操作的步骤，请清楚说明。
3. 配置完成后尝试 MCP 握手和工具发现，报告实际结果；连接不可用时说明原因，不声称已连接。
4. 这次只完成连接配置，不创建或调整工作台。`,
  assistant: `你是我的 Lumi 工作助手。请先配置 Lumi MCP 连接，再根据我的工作方式设计个人工作台。

1. 使用下面的连接信息配置当前 AI 软件，确认 MCP 握手和工具发现成功。
2. 了解我的角色、目标、日常任务和常用工具，信息不足时询问关键问题。
3. 按需要安排今日重点、待办事项、项目进展与常用能力，保持 Lumi 当前主题配色和简洁布局。
4. 仅使用实际可用的工具与工作台编辑能力。连接或编辑接口不可用时，先给出方案，不声称已应用。
5. 根据我的反馈持续调整工作台，并帮助我优化这段提示词。`,
  features: `你是我的 Lumi 功能入口设计助手。请先配置 Lumi MCP 连接，再把可用功能组织成清晰的工作台入口。

1. 使用下面的连接信息配置当前 AI 软件，确认 MCP 握手和工具发现成功。
2. 了解我的常用工作流程，梳理实际可用的能力、Skills 和 Memory。
3. 按用途组织功能入口，展示名称、简短说明和可用操作，将常用功能优先安排。
4. 根据需要调整分组、顺序、布局与交互，保持 Lumi 当前主题配色，只展示真实可用的功能。
5. 使用实际提供的工作台编辑能力完成调整；连接或编辑接口不可用时，先给出方案，不声称已应用。`,
}

export function buildWorkbenchPrompt(
  type: PromptType,
  connection: McpConnectionInfo | null,
): string {
  const stdio = connection?.stdioCommand
    ? `\n\n如果当前 AI 软件只支持 stdio，可使用以下代理配置（与 HTTP 共用同一服务和会话令牌）：\n${formatMcpConfig(connection, 'stdio')}`
    : ''
  const config = connection
    ? `传输方式：Streamable HTTP\n通用 MCP 配置（请按当前 AI 软件的配置格式调整）：\n${formatMcpConfig(connection)}${stdio}\n\n此配置属于当前 Lumi 会话；应用重新启动后，请重新复制配置。连接后先调用 lumi.get_context 确认功能范围，再调用 lumi.list_capabilities 读取目录。`
    : '尚未获取桌面会话配置。请让我打开 Lumi 桌面应用，在「设置 → MCP 连接」复制配置后再继续；不要猜测端口或认证令牌。'
  return `${templates[type]}\n\nLumi MCP 连接信息\n${mcpAvailability(connection)}\n\n${config}`
}
