# Lumi MCP 设计与连接说明

Lumi 提供一个本机 MCP 入口，让 AI 软件读取能力目录、创建能力草稿，并发现用户已启用的工具。HTTP 与 stdio 都连接同一个 Core、SQLite 和 Capability Registry。MCP 配置别名及服务名称统一为 `Lumi`，内置工具使用区分大小写的 `Lumi.` 前缀；应用显示名称也是 Lumi。

## 第一版工具

| 工具                           | 参数                                                                            | 结果                                                          | 行为                                |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `Lumi.get_context`             | 空对象                                                                          | Lumi 版本、可用功能和使用指引                                 | 只读；连接后先调用                  |
| `Lumi.list_capabilities`       | 空对象                                                                          | 能力 ID、名称、命名空间、说明、版本、草稿／启用状态及工具数量 | 只读；不返回内部执行配置            |
| `Lumi.create_capability_draft` | `kind`、`name`，可选 `namespace`、`description`；Terminal 可选 `command`、`cwd` | 新草稿的公开摘要                                              | 写入同一数据库；来源为 AI，始终禁用 |
| `<namespace>.<tool>`           | 由公开 JSON Schema 定义                                                         | Registry 执行结果或明确的执行错误                             | 仅用户已启用的工具可发现和调用      |

`kind` 支持 `terminal`、`http`、`mcp`，当前创建的是基础草稿，不包含已完成的执行配置。标识符由英文字母开头，最长 64 个字符；`Lumi` 命名空间保留给内置工具。

内置工具经过与能力工具相同的 Registry 调用边界。参数按公开 JSON Schema 校验，不接受未声明的参数。成功调用同时返回 `structuredContent` 和可读的 JSON 文本内容。未知或禁用工具返回协议错误；参数或执行问题返回 `isError: true`。

## 连接方式

### Streamable HTTP

端点为当前桌面会话的 `http://127.0.0.1:<port>/mcp`。默认端口固定为 `38491`，用户可在设置 → MCP端口中输入 `1024–65535` 的整数并保存，下次启动生效。端口被占用时明确报错，不回退到随机端口。认证请求头为 `x-lumiplug-session-token`。

在「设置 → MCP 连接」选择 Streamable HTTP，复制完整配置，按 AI 软件要求调整外层配置格式。例如：

```json
{
  "mcpServers": {
    "Lumi": {
      "url": "http://127.0.0.1:<当前端口>/mcp",
      "headers": {
        "x-lumiplug-session-token": "<当前会话令牌>"
      }
    }
  }
}
```

以上是结构说明，实际配置必须从正在运行的 Lumi 获取。端口保存在原生应用数据目录的 `mcp-settings.json`；令牌首次生成后保存在 `mcp-token`（Unix 权限 0600），前端不持久化凭据。应用重启保持端口和令牌；仅修改端口并重启或手动点击“刷新令牌”后，需要更新客户端配置。刷新通过宿主授权的 `/app/mcp/token` 即时更新认证，旧令牌不再接受新请求，工具任务不重启；关闭窗口保留托盘时，同一 Core 继续运行。

### stdio 代理

只支持 stdio 的客户端可在设置中选择 stdio 代理，复制对应配置。代理由客户端启动，只转发协议，不启动第二套 Core 或数据库。其配置包含当前代理程序的绝对路径、`--core-url` 参数，以及环境变量 `LUMIPLUG_SESSION_TOKEN`。

HTTP、stdio、应用内部 API 共用同一个会话令牌。stdio 配置将令牌放在环境变量中，避免写进客户端启动参数。代理仅接受本机 `127.0.0.1` HTTP 地址，禁止跟随重定向，诊断只写 stderr，stdout 只包含 MCP 消息。

### 自检与客户端使用

设置中的「检查连接」使用官方客户端实际完成 MCP 握手和 `tools/list`，成功时显示发现的工具数量。这是 Lumi 端点自检，不代表某个外部 AI 软件已经完成配置。

AI 软件连接后应先调用 `Lumi.get_context`，再调用 `Lumi.list_capabilities`。首页第一步的连接提示包含当前会话配置；第二步的工作助手和功能入口模板只包含构建指令，不包含端口、认证头或令牌。

## 协议与工具刷新

采用官方 TypeScript SDK 2.1.0，提供无状态 Streamable HTTP。每个 POST 由独立的 SDK Server/Transport 处理，业务数据始终来自同一个 Registry。

- 使用当前官方 SDK 客户端验证握手、ping、`tools/list` 和 `tools/call`。
- 不分配 `Mcp-Session-Id`；当前不提供独立 GET SSE 流或 DELETE 会话终止，两者返回 405。
- 工具按名称确定性排序，每次 `tools/list` 重新读取已启用能力。
- 不声明工具变化推送；客户端在用户启用或禁用能力后主动刷新工具列表。
- 调用时再次确认工具存在且已启用，避免旧工具列表绕过禁用状态。
- 当前一次返回整个工具目录，不发分页游标；无效游标返回协议错误。

## 边界与错误

Core 只监听 loopback，所有 MCP 请求校验 Host、Origin 和会话令牌。允许不带 Origin 的本机 AI 客户端；拒绝不受信任的浏览器 Origin。

能力工具仅通过 `deriveAiToolView()` 投影公开参数与 Schema。公开目录使用字段允许列表；不序列化完整能力再删除敏感字段。执行设置、不可见字段名／值、binding、内部地址和认证令牌不进入 MCP 结果。错误返回固定说明，不回传数据库错误或 Schema 校验的原始输入。

请求体上限 64 KiB；网关和代理各限制最多 128 个在途请求。stdio 代理默认单次转发等待预算为 310 秒（310000ms），覆盖 Core HTTP/MCP 最长 300 秒执行预算并保留转发余量。可通过 `--request-timeout-ms` 或 `LUMIPLUG_REQUEST_TIMEOUT_MS` 设置 100–3600000ms，命令行优先于环境变量；配置必须是整数。代理等待预算不替代 Runner 的执行超时，长 Terminal 操作应使用返回 taskId 的 start。关闭 stdin 时结束代理并取消在途转发。应用停止时关闭网关 Transport。

公开工具名称最长 128 字符。启用时拒绝与内置工具或其他已启用能力冲突的名称，避免同名工具被错误路由。

## 当前功能范围与后续接入

当前可执行读取上下文、目录、创建草稿、导出／发布／恢复主页，以及用户已整体授权的 Terminal／HTTP／上游 MCP 工具。三类执行与手动入口共用 Registry；Terminal 后台操作返回 taskId，其余调用等待结果。`Lumi.list_tasks/get_task/stop_task/restart_task` 读取记录、停止与同会话重新运行。固定值和内部配置不进入 AI 输入 Schema，结果经允许字段投影和脱敏，错误返回标准说明。公开 MCP 目录未提供授权或启停工具；用户已确认会话令牌是全部权限凭据，此处功能目录的限制不作为管理接口的独立权限边界。工具变化后客户端重新读取 tools/list。

`Lumi.get_context` 标记 `workbenchEditing: true`；Memory 和 Skills 仍不可用。主页采用官方 HTML/CSS/JavaScript 静态工程契约和隔离资源加载，SDK 不开放宿主内部权限。

## 验证

`pnpm test` 先构建 Core 和 stdio 代理，再运行协议集成测试。覆盖当前官方 SDK 客户端、HTTP／stdio 同目录、实际草稿保存、启用／禁用后的刷新、隐藏字段 canary、输入校验、令牌／Host／Origin 校验、无效 JSON、超限请求和 stdio 消息 ID／通知行为。

协议依据：[MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

首页“开始使用”还会检查当前 Core 会话的 `lastExternalActivityAt`。只有外部成功的工具发现或工具调用响应才会记录；内部握手自检通过随机探针标识排除。该记录仅保存在内存中，Core 重启后清空，表示曾成功访问而非持续在线。

桌面 IPC 通过本机 HTTP 读取应用 API，JSON 响应显式设置 UTF-8 字节长度的 Content-Length，避免分块传输影响桌面端直接 JSON 解析。

## 官方主页开发接口

| 工具                           | 输入                       | 结果                                        |
| ------------------------------ | -------------------------- | ------------------------------------------- |
| Lumi.get_workbench_template    | 空对象                     | 同版本完整模板文件树、SDK、知识库与锁文件   |
| Lumi.get_workbench             | 可选 version/includeBundle | 版本、manifest、sourceFiles；按需完整bundle |
| Lumi.publish_workbench         | expectedVersion/bundle     | 保存的新版本与manifest                      |
| Lumi.list_workbench_versions   | 空对象                     | 最近30个版本摘要                            |
| Lumi.restore_workbench_version | expectedVersion/version    | 恢复内容作为新版本，保留Storage             |
| Lumi.export_workbench_project  | directory，可选version     | 导出当前源码或新模板到绝对路径的空目录      |

版本、工程、SDK与工具链严格匹配当前Lumi；完整Schema通过tools/list提供。HTTP/stdio消息上限统一24MiB，包解码后16MiB/单文件4MiB/最多512文件。UI导入和MCP发布复用验证器与事务版本检查，冲突不写入。get_workbench默认不返回全部构建资源。

主页SDK通过宿主受限IPC到/app/workbench/rpc，context/capabilities/tools调用同一Registry，管理工具不在页面SDK目录中。页面只能创建能力草稿而不能启用；Runner继续明确失败。模板工具及工程源码不包含会话令牌。完整开发流程见[官方主页开发方案](HOMEPAGE_DEVELOPMENT_PLAN.md)。

Terminal 草稿可通过 MCP 写入固定多行 Shell 命令与可选目录；固定命令不生成运行时 command 参数。其他类型不能传入 Terminal 参数。创建仍仅保存禁用草稿，不执行、不授权，返回摘要不回传命令。

2026-10-06：端口与认证令牌固定持久化。首次升级到本模式需重新复制一次配置；之后普通重启无需更新客户端配置。原生宿主 nonce/hostToken 仍每次启动重新生成，和可持久化的外部 MCP 令牌分别管理。

## 2026-10-12 执行修复

- MCP foreground 调用把 SDK 的 `mcpReq.signal` 与 legacy `notifications/cancelled` 传到 Registry/TaskManager。Terminal.start 已返回 taskId 的后台任务保持独立生命周期，需通过 stop_task 停止。本轮保留 HTTP/MCP 同步等待契约，没有改为统一执行 ID。
- 无状态 HTTP 没有跨客户端 session 身份。仅一个在途请求匹配取消 ID 时响应取消；同 ID 多个在途调用时忽略歧义通知，防止误停其他调用。此处理不新增会话管理，不保证所有跨客户端 ID 重用情形的通知归属；可通过明确 task ID 管理后台任务。
- 上游业务 `isError` 和调用者取消不关闭健康共享连接。实际连接故障使缓存失效，仍有调用者时不提前关闭；最后一个使用者离开后释放。当前调用不自动重放，之后一次新调用可重新连接。
- 连接等待者各自可取消；共享握手仅在没有等待者时中止。单次发现总预算 10 秒，执行前目录校验总预算 10 秒，最多 128 页和 128 个匹配工具，取消信号覆盖分页。
- 原始输入 schema 以 `upstreamInputSchema` 保存，在合并公开参数和隐藏固定值后按完整 schema 校验，prepare/start/实际调用均有校验。公开投影仅在全部字段可见且绑定名称一致时保留根级约束；隐藏 schema 和内部绑定不直接公开。根级依赖、条件、组合约束不再因字段拆分丢失，仍要求可列举的根 properties，开放 additionalProperties 当前不支持。
- 未声明上游 outputSchema 时记录 `upstreamOutputSchemaMissing`，保留实际结构化 JSON 或文本包装，继续执行大小限制和已有私密脱敏。用户明确的非空输出白名单继续投影。migration 9 只添加 nullable 元数据列，不重写旧配置。
- 旧记录缺少来源标记且仍使用旧自动 text schema 时，无法与同样的用户显式白名单可靠区分；执行前返回 `tool_mcp_schema_refresh_required`，要求重新发现并确认规则，不调用上游、不静默返回空对象，也不自动放开白名单。其他旧白名单保持原样。旧记录在重新发现前预检可能没有根约束，实际调用会用当前上游完整 schema 再校验。
- Runner 自身截止时间结束记为 timed_out；用户停止、MCP 请求取消以及代理放弃等待导致的本地取消记为 cancelled。HTTP/MCP 保留 cancellationUncertain，外部已开始的副作用不保证撤销。代理超时回复 reason=request_timeout 和明确 timed out 文案，连接故障回复 reason=connection_failed，不将超时报成 Core unavailable；不会自动重试。
- 本轮未修改上游元数据脱敏或 HTTP/MCP 执行 ID 格式；用户已明确暂不处理这两项。
