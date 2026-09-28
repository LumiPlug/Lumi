# Lumi MCP 设计与连接说明

Lumi 提供一个本机 MCP 入口，让 AI 软件读取能力目录、创建能力草稿，并发现用户已启用的工具。HTTP 与 stdio 都连接同一个 Core、SQLite 和 Capability Registry。

## 第一版工具

| 工具 | 参数 | 结果 | 行为 |
| --- | --- | --- | --- |
| `lumi.get_context` | 空对象 | Lumi 版本、可用功能和使用指引 | 只读；连接后先调用 |
| `lumi.list_capabilities` | 空对象 | 能力 ID、名称、命名空间、说明、版本、草稿／启用状态及工具数量 | 只读；不返回内部执行配置 |
| `lumi.create_capability_draft` | `kind`、`name`，可选 `namespace`、`description` | 新草稿的公开摘要 | 写入同一数据库；来源为 AI，始终禁用 |
| `<namespace>.<tool>` | 由公开 JSON Schema 定义 | Registry 执行结果或明确的执行错误 | 仅用户已启用的工具可发现和调用 |

`kind` 支持 `terminal`、`http`、`mcp`，当前创建的是基础草稿，不包含已完成的执行配置。标识符由英文字母开头，最长 64 个字符；`lumi` 命名空间保留给内置工具。

内置工具经过与能力工具相同的 Registry 调用边界。参数按公开 JSON Schema 校验，不接受未声明的参数。成功调用同时返回 `structuredContent` 和兼容客户端的 JSON 文本内容。未知或禁用工具返回协议错误；参数或执行问题返回 `isError: true`。

## 连接方式

### Streamable HTTP

端点为当前桌面会话的 `http://127.0.0.1:<port>/mcp`。端口由桌面壳分配，认证请求头为 `x-lumiplug-session-token`。

在「设置 → MCP 连接」选择 Streamable HTTP，复制完整配置，按 AI 软件要求调整外层配置格式。例如：

```json
{
  "mcpServers": {
    "lumi": {
      "url": "http://127.0.0.1:<当前端口>/mcp",
      "headers": {
        "x-lumiplug-session-token": "<当前会话令牌>"
      }
    }
  }
}
```

以上是结构说明，实际配置必须从正在运行的 Lumi 获取。配置中的端口和令牌不会固定写入代码或前端本地存储。应用完全退出再启动后，需要更新客户端配置；关闭窗口保留托盘时，同一 Core 继续运行。

### stdio 代理

只支持 stdio 的客户端可在设置中选择 stdio 代理，复制对应配置。代理由客户端启动，只转发协议，不启动第二套 Core 或数据库。其配置包含当前代理程序的绝对路径、`--core-url` 参数，以及环境变量 `LUMIPLUG_SESSION_TOKEN`。

HTTP、stdio、应用内部 API 共用同一个会话令牌。stdio 配置将令牌放在环境变量中，避免写进客户端启动参数。代理仅接受本机 `127.0.0.1` HTTP 地址，禁止跟随重定向，诊断只写 stderr，stdout 只包含 MCP 消息。

### 自检与客户端使用

设置中的「检查连接」使用官方客户端实际完成 MCP 握手和 `tools/list`，成功时显示发现的工具数量。这是 Lumi 端点自检，不代表某个外部 AI 软件已经完成配置。

AI 软件连接后应先调用 `lumi.get_context`，再调用 `lumi.list_capabilities`。主页三种系统提示词都包含当前连接配置，以及确认功能范围的指引。

## 协议与工具刷新

采用官方 TypeScript SDK 2.1.0，提供无状态 Streamable HTTP。每个 POST 由独立的 SDK Server/Transport 处理，业务数据始终来自同一个 Registry。

- 支持官方 v1 和 v2 客户端握手、ping、`tools/list` 和 `tools/call`。
- 不分配 `Mcp-Session-Id`；当前不提供独立 GET SSE 流或 DELETE 会话终止，两者返回 405。
- 工具按名称确定性排序，每次 `tools/list` 重新读取已启用能力。
- 不声明工具变化推送；客户端在用户启用或禁用能力后主动刷新工具列表。
- 调用时再次确认工具存在且已启用，避免旧工具列表绕过禁用状态。
- 当前一次返回整个工具目录，不发分页游标；无效游标返回协议错误。

## 边界与错误

Core 只监听 loopback，所有 MCP 请求校验 Host、Origin 和会话令牌。允许不带 Origin 的本机 AI 客户端；拒绝不受信任的浏览器 Origin。

能力工具仅通过 `deriveAiToolView()` 投影公开参数与 Schema。公开目录使用字段允许列表；不序列化完整能力再删除敏感字段。执行设置、不可见字段名／值、binding、内部地址和认证令牌不进入 MCP 结果。错误返回固定说明，不回传数据库错误或 Schema 校验的原始输入。

请求体上限 64 KiB；网关和代理各限制最多 128 个在途请求。stdio 请求超时 30 秒，关闭 stdin 时结束代理并取消在途转发。应用停止时关闭网关 Transport。

公开工具名称最长 128 字符。启用时拒绝与内置工具或其他已启用能力冲突的名称，避免同名工具被错误路由。

## 当前功能范围与后续接入

当前可执行的是读取上下文、读取目录和创建草稿。Terminal／HTTP／上游 MCP Runner 尚未接入；调用此类已启用能力返回明确的执行不可用错误，不模拟结果。

工作台文档编辑、Memory 和 Skills 工具按各自里程碑接入，`lumi.get_context` 目前会明确标记这些功能不可用。后续工具仍经过 Registry；工作台编辑采用受限 JSON 文档和草稿预览，不提供任意 HTML／JS／CSS 执行入口。

## 验证

`pnpm test` 先构建 Core 和 stdio 代理，再运行协议集成测试。覆盖官方 v1／v2 客户端、HTTP／stdio 同目录、实际草稿保存、启用／禁用后的刷新、隐藏字段 canary、输入校验、令牌／Host／Origin 校验、无效 JSON、超限请求和 stdio 消息 ID／通知行为。

协议依据：[MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
