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
        Lumi: server,
      },
    },
    null,
    2,
  )
}

export function mcpAvailability(connection: McpConnectionInfo | null): string {
  if (!connection) return '请在 Lumi 桌面应用中查看并复制当前会话的 MCP 配置。'
  if (connection.coreState !== 'ready') return '本地服务尚未就绪，请启动 Lumi 后重试连接。'
  return '请保持 Lumi 运行，使用以下配置连接本机服务。'
}

const templates: Record<PromptType, string> = {
  connection: `请帮我在当前 AI 软件中配置 Lumi MCP 连接。

1. 确认当前 AI 软件支持的 MCP 配置方式，将下面的连接信息转换为该软件需要的格式。
2. 使用 Streamable HTTP 连接本机 Lumi，保留完整 URL 和认证请求头。需要我操作的步骤，请清楚说明。
3. 配置完成后尝试 MCP 握手和工具发现，报告实际结果；连接不可用时说明原因，不声称已连接。
4. 这次只完成连接配置，不创建或调整工作台。`,
  assistant: `请使用 Lumi 官方 HTML/CSS/JavaScript 模板，为我开发个人工作台；用户无需安装 Node 或运行构建。

1. 调用 Lumi.get_context 确认版本和真实功能，再调用 Lumi.get_workbench 读取现有源码与版本。
2. 已有 HTML 主页继续修改 sourceFiles，并保留 projectId；首次调用 Lumi.get_workbench_template 或 Lumi.export_workbench_project 获取当前版本的静态模板、SDK 和知识库。
3. 阅读 LUMI_DEVELOPMENT.md 和 knowledge，按我的目标自由编写根目录 index.html、app.js、style.css，可添加其他离线静态资源或使用其他框架的静态输出。固定入口与 SDK 协议。
4. 通过 window.lumi 的 context/capabilities/tools/storage/theme/toast 接口使用 Lumi，工具参数按真实 tools/list Schema。
5. 构造 manifest/files/sourceFiles JSON，以开始开发时读取的 expectedVersion 调用 Lumi.publish_workbench 发布主页。工程导出和历史版本查看、恢复分别使用 Lumi.export_workbench_project、Lumi.list_workbench_versions、Lumi.restore_workbench_version。无需让用户安装 Node。版本冲突先取回最新源码合并。
6. 在 Lumi 主页验证真实加载和交互。模拟环境不代表真实执行；Runner 未接入时明确说明。保留键盘、主题、减少动态效果与窄窗口支持。`,
  features: `请使用 Lumi 官方 HTML/CSS/JavaScript 模板，为我自由开发常用功能主页。

1. 调用 Lumi.get_context 和 Lumi.get_workbench，确认版本、当前源码与 expectedVersion；首次取 Lumi.get_workbench_template。继续开发同一主页时保留 projectId。
2. 阅读工程入口和 knowledge，调用 Lumi.list_capabilities 与 tools/list 查看真实目录及 Schema。
3. 自由开发 index.html、app.js、style.css，可增加静态资源；其他框架也须输出这三个根目录文件。通过 window.lumi.tools.list/call、storage、theme、toast 使用公开能力。
4. 保留 projectId 和 SDK 契约。通过 Lumi.publish_workbench 提交 manifest/files/sourceFiles JSON，使用开发前读取的 expectedVersion，冲突先取回源码合并。
5. 回到 Lumi 验证真实功能。Runner 尚未实现时说明范围，不模拟执行。`,
}

export function buildWorkbenchPrompt(
  type: PromptType,
  connection: McpConnectionInfo | null,
): string {
  if (type !== 'connection') return templates[type]
  const stdio = connection?.stdioCommand
    ? `\n\n如果当前 AI 软件只支持 stdio，可使用以下代理配置（与 HTTP 共用同一服务和会话令牌）：\n${formatMcpConfig(connection, 'stdio')}`
    : ''
  const config = connection
    ? `传输方式：Streamable HTTP\n通用 MCP 配置（请按当前 AI 软件的配置格式调整）：\n${formatMcpConfig(connection)}${stdio}\n\n普通重启后，此配置继续有效；修改端口并重启或手动刷新令牌后，请重新复制配置。连接后先调用 Lumi.get_context 确认功能范围，再调用 Lumi.list_capabilities 读取目录。`
    : '尚未获取桌面会话配置。请让我打开 Lumi 桌面应用，在「设置 → MCP 连接」复制配置后再继续；不要猜测端口或认证令牌。'
  return `${templates[type]}\n\nLumi MCP 连接信息\n${mcpAvailability(connection)}\n\n${config}`
}

export function parseMcpPort(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const port = Number(value.trim())
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null
}
export function mcpPortError(error: unknown): string {
  const code = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  return (
    (
      {
        mcp_port_invalid: '请输入 1024–65535 之间的整数端口。',
        mcp_port_in_use: '该端口已被占用，请选择其他端口。',
        mcp_port_unavailable: '该端口无法使用，请选择其他端口。',
        mcp_port_settings_save_failed: '端口设置保存失败，请检查本地存储后重试。',
      } as Record<string, string>
    )[code] ?? '端口设置未能读取或保存，请重试。'
  )
}
