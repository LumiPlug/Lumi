<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 技术架构

### 托盘、窗口与托管 Core 控制（2026-10-19，未发布）

基于锁定 Tauri 2.12.0：macOS 主窗口关闭仅隐藏窗口；所有应用窗口均隐藏时才调用 set_dock_visibility(false)，若运行窗口仍可见或最小化则保留 Dock 访问。重开恢复 Dock、窗口、取消最小化与聚焦；其他平台不调用 Dock API。明确退出标志与自定义 Cmd+Q/退出菜单共用 app.exit(0)，关闭/后台 WebView 释放仍阻止无意退出，不改变现有最终 supervisor.shutdown 语义。

托盘复用工作台、AI 用量、Skills、项目知识（现有知识库）、设置及 Core 状态。固定 action 白名单、内存队列和前端订阅后读取/确认交付，支持创建早期/重建窗口与重复点击；导航经过工具未保存守卫。项目当前只有 zh-CN 界面，无通用翻译/语言设置体系，托盘采用与当前界面一致的中文，不以系统语言制造混合页面。Core 菜单显示真实状态并按所有权/过渡状态禁用启停；新增宿主授权控制仅操作本 supervisor 持有的 sidecar，不按端口查杀，不接管外部 Core。停止通过既有 ConfirmationDialog 确认会中断任务与 MCP，携带点击时 generation 防止误停后来重启的进程。手动停止抑制自动拉起，手动启动重置重试预算，退出仍走原 shutdown；失败/未确认退出不标成已停止。手动停止通过新增仅宿主授权的 POST /app/core/stop 调用入口层已有的 SIGTERM/SIGINT 清理回调（幂等），依次关闭采集、知识服务、任务、MCP、主页服务、HTTP与数据库；无回调的嵌入实例返回409。Rust 保留受管 child 句柄至 Terminated，最长等待10秒，失败/超时保留 pending 并禁用再次启动，不强杀或声称已停止；最终应用退出仍沿用原 child.kill 生命周期。

保护既有 Qoder 未提交改动，托盘分支从相同 HEAD 建立并携带工作区，不提交/推送/发布。自动化使用临时合成数据与隔离实例；不终止当前用户服务、不使用正式数据或修改登录项。

### Qoder 桌面 JSONL 补充（2026-10-19，未发布）

Qoder 新增 `~/.qoder/projects` 安全有界 JSONL 发现，复用现有 collector、缓存、upsert 账本及查询链路。只接收 assistant 且显式 sessionId/session_id 和稳定 message.id（兼容 uuid/id）的记录；缺少身份保守跳过，不以路径或正文制造请求 ID。JSONL 的 input_tokens 不扣缓存，cache_read_input_tokens/cache_creation_input_tokens 独立保留，总量为四项之和；缺项为未知，全零为 missing。时间支持 ISO 字符串、秒/毫秒安全整数及对应数字字符串，拒绝无效时间。Credits 不采集。

记录增加可选 qoderFormat=jsonl/sqlite 与 qoderRequest（显式会话/稳定请求身份的哈希），不新增数据库结构。JSONL 存储 ID 与旧 SQLite 分开命名，避免 rowid 和消息 ID 意外碰撞。SQLite message_id/id/uuid 的非空字符串可提供稳定身份；rowid、数字型库内 ID 及没有来源证据的旧账本不提供跨格式匹配证据。查询在完整持久账本按 qoderRequest 精确匹配，reported 优先于 missing、完整分项优先，跨格式同完整度优先 JSONL；同格式沿用完整/较大流式快照优先。其他请求全部保留，不按整会话、时间或 Token 接近丢弃历史。筛选、会话和 CSV 使用同一按请求选择，跨日期/模型筛选、轮转、删除及重启稳定，账本不删除或改写为另一格式。

核对后同会话仍包含两种格式的独立记录时，不能证明请求是否存在别名关联，来源 problems 增加 identity_unverified（有当前 ready/empty 来源时状态为 partial），保留计数但不宣称完全去重。诊断由持久账本重新计算，源删除后仍保留；整根 absent 的 detectedOnly 过滤仍沿用原行为。AI 用量首次读取该风险时、及用户每次刷新后，复用 useToast 顶部提醒“Qoder 部分跨格式请求身份无法关联，已保留历史，统计可能包含重复。”，后台每分钟轮询不重复弹出。来源状态合并两个根，旧 SQLite absent 不隐藏 JSONL 成功。UI 布局不变，vendor 与 codeburn.test.ts 不改。只用人工合成样例验证，真实公司机不在访问范围内。

### 四款本地用量来源接入（2026-10-18）

在现有 CodeBurn 固定版本之上增加 Lumi 自有采集组合层，不修改 vendor、不新增进程或远端接口。Qoder 读取标准 SharedClientCache SQLite 的 chat_message/token_info；QoderWork 读取 ~/.qoderwork/projects 的 assistant/message.usage；WorkBuddy 读取 ~/.workbuddy/projects 的 providerData.rawUsage（兼容 message 与 function_call，用 providerData.messageId 去重）；千问办公独立标识 qwenwork，读取 ~/.qwenworkcn/logs/sessions 下 segments 的 model.response.completed，忽略 turn.finished 及上下文快照。所有来源转换成现有 UsageRecord，经 UsageService 的 SQLite 事务、宿主 query/sessions/export 与现有 UI 流转。

CodeBurn 构建适配层在源码替换前统一 CRLF/LF，确保 Windows 检出时网关失败仍上报解析问题并保留上次成功快照，不因换行差异退化成空结果。

共享注册表保留 `usageSoftwareIds` 的原有 CodeBurn 43 个来源边界；`allUsageSoftwareIds` 包含这 43 个来源和 4 个 Lumi 自有来源，供完整采集校验与业务界面使用。原上游测试文件保持不变，新增来源在独立 native 测试中验证。

本地来源缓存仅复用最后修改/变更时间距当前超过 2 秒的文件，避免文件系统时间戳精度导致快速同长度覆写被误判为未变化；最近写入的文件仍受原读取上限约束并重新解析。CI 测试按文件串行，保留全部断言与超时标准，避免小规格 runner 的并行进程争抢。

本地日志采用有界发现、完整行读取及仅含归一化记录的内存元数据缓存；持久层按软件/会话/请求哈希 upsert，日志轮转或删除不抹掉已采集历史。失败不清空历史，暂停/关闭取消扫描。SQLite 只读且感知 WAL；不读取凭据或持久化正文。输入已含缓存的来源先扣除已报告缓存读取，缓存拆分缺失时保留 inputIncludesCache=true；未知不填零，总计独立按来源已知口径计算。全零且可能受记录开关影响的 QoderWork/千问办公事件标记 missing_usage，不作为真实零用量。QODER_EXPOSE_TOKEN_USAGE / QODERCN_EXPOSE_TOKEN_USAGE 由用户在目标软件环境开启并重启后才可能产生新数据，Lumi 不自动改 shell、登录环境或目标应用配置。当前四款的路径及字段以 macOS 为实机验证基线，其他平台采用标准用户数据目录并以样例验证，不宣称完成各版本实机覆盖。

状态：标准 Tauri 2 实施基线

## 1. 技术决策

2026-10-16 主页升级兼容：Core 的加载、发布、恢复、导出仅校验 HTML format／template／entry 与 bridge，清单 lumiVersion／sdkVersion 为发布溯源字段，不参与兼容性比较。浏览器 SDK 握手只校验 bridge；宿主继续提供当前受控 SDK。发布版本升级不修改已有主页记录、源码或 projectId／KV，不要求重新发布。安全路径、包大小、源码清单一致性、iframe 来源及实例验证、RPC 白名单和 expectedVersion 并发检查保持有效。

2026-10-07 Terminal 系统环境：Unix Runner 自动选择账户默认 Shell，缺失时使用 SHELL、最后 `/bin/sh`；每次任务先在用户主目录以 `-ilc` 读取登录交互 Shell 的 NUL 分隔导出环境，再以所选 Shell 的非交互 `-c` 执行命令。zsh 执行时增加 `-f`，避免再次读取用户 `.zshenv` 覆盖已加载环境和工具变量。环境探测单独限制 10 秒、1 MiB，输出使用随机边界解析，不把启动提示或环境写入任务日志/数据库；失败返回 `tool_terminal_environment_failed`，不静默降级。探测及命令进程组均支持取消并清理后代。工具显式环境和固定命令参数最后覆盖，连接凭据在探测前及执行前清除。Windows 保留 ComSpec 命令执行与系统继承环境。任务工作目录、日志、超时及停止行为沿用现有机制；环境基准为新登录终端的导出变量，不复制现有终端会话的别名、函数或交互设备状态。

Lumi 使用标准 Tauri 2，不集成 Chromium/CEF。界面使用系统 WebView：macOS 为 WKWebView、Windows 为 WebView2、Linux 为 WebKitGTK。

运行与记录查看由 Rust 宿主创建独立 WebviewWindow，共用同一 CoreSupervisor 与任务 API，不额外启动 Core。标签由验证后的 capability/task UUID 构建，同工具／同任务复用已有窗口；URL 仅携带 ID，不携带参数或凭据。初始化脚本沿用可信主 frame 的 nonce 检查，不向 iframe 发放凭据。运行窗口允许工具、目录选择及复制接口，MCP 配置仍限主窗口。主窗口关闭隐藏到托盘；运行窗口的原生关闭事件先阻止并转交前端，运行中要求用户选择停止并等待退出或保留后台任务，完成选择后通过宿主销毁界面。各窗口独立轮询任务，以提交后得到的 ID 跟踪；重新打开有活动任务的工具时恢复任务视图。主题通过同源 storage 事件同步。

最终技术栈：

- 桌面壳：Tauri 2、Rust。
- 界面：React、TypeScript、Vite。
- 业务 Core：Node.js、TypeScript Sidecar。
- MCP：官方 TypeScript MCP SDK。
- 数据：SQLite、Markdown、Artifact 文件目录。
- Capability：JSON Schema + 数据库 canonical definition。

Rust 层保持轻薄，只负责窗口、托盘、应用生命周期、Sidecar 监督和必要系统集成。Node Core 是业务真相源，负责数据库、统一 MCP、Capability Registry、Runner、Task、Artifact、Memory、Skill 和 Workbench。

## 2. 根目录结构

当前仓库就是最终工程根目录，不创建 `v1/` 或新旧双栈目录。

```text
LumiPlug/
├── docs/
├── src/                       # React Renderer
├── src-tauri/                 # 标准 Tauri 2 Rust 壳
├── packages/
│   ├── core/                  # Node/TypeScript Core Sidecar
│   ├── shared/                # JSON 可序列化共享协议与 Schema
│   └── mcp-stdio-proxy/       # 外部 AI 的 stdio 代理入口
├── tests/
├── package.json
├── pnpm-workspace.yaml
└── vite.config.ts
```

禁止出现 `v1/`、`legacy/` 双运行结构。当前目录没有需要兼容的旧产品实现。

## 3. 进程架构

2026-10-15 资源生命周期优化：保留 Rust 宿主与单个 Node Core。所有界面轮询统一按原生隐藏／最小化与 document 可见性暂停，恢复后立即补读；失焦不等于隐藏，已完成任务停止高频轮询。主窗口关闭先隐藏，连续隐藏 5 分钟后仅在工作台引导页且无任何待保留页面状态、表单或未完成操作时释放窗口；自定义主页、编辑器、详情、搜索条件及弹层保守保留。托盘重新创建可信主窗口，共享原 Core；不持久化输入、密钥或运行参数。原生端再次验证隐藏时长与窗口身份，重新显示后旧回收请求无效。释放最后一个窗口不退出托盘，显式退出仍停止 Core。

上游 MCP 连接在最后一个请求结束后空闲 5 分钟回收，下次调用重连；活动请求不参与回收。保留 16 个会话上限，回收计时器不阻止退出。stdio 代理仍由外部客户端管理。

知识库结构校验和全文索引分词放到按需 Worker 线程，限制同时计算与排队数量，结束后释放线程；SQLite 写入仍由 Core 事务统一完成。跨线程计算结束后重新核对构建序号、校验标识、归档和库版本，避免取消／修改／重复发布覆盖新状态。启动时只恢复 validating 构建，不解析已完成历史正文。


```text
AI Clients ── Streamable HTTP ─┐
AI Clients ── stdio proxy ─────┼── Node Core Sidecar
                               │   ├── Unified MCP Gateway
Tauri Rust Host                │   ├── Capability Registry
├── window/tray/lifecycle      │   ├── Runners
├── sidecar supervisor ────────┤   ├── Task/Artifact
└── secure IPC allowlist       │   ├── Memory/Skills
                               │   └── SQLite
React WebView ── Tauri IPC ────┘
```

### Tauri Rust Host

- 创建窗口和托盘，关闭窗口后允许后台 Core 继续运行。
- 启动、检测、停止和受限重启 Node Core Sidecar。
- 为 Core 分配用户数据目录，加载本机持久端口（默认38491）及持久MCP令牌。
- 只暴露白名单命令，不承载 Capability 业务规则。

### React Renderer

- 只依赖 `packages/shared` 的公开类型。
- 不直接访问 Shell、Node、SQLite 或任意本地路径。
- 所有输入都经过 Schema 校验，所有日志列表使用虚拟化展示。

### Node Core Sidecar

- 唯一 SQLite 写入者。
- 唯一 Capability canonical definition 所有者。
- 同时作为 MCP Server 和上游 MCP Client。
- Runner 只能由 Capability Registry 调用。
- 对 UI 与 AI 暴露不同视图，AI 视图统一执行 `aiVisible` 允许列表投影。

## 4. Core 通信

Core 监听随机端口的 loopback HTTP，并提供：

- `/healthz`：最小健康信息。
- `/app/*`：供 Tauri UI 使用的受保护 API。
- `/mcp`：本机 Streamable HTTP MCP。

工具页通过受保护的 `/app/tools` 与白名单 `tools_request` IPC 操作完整配置、授权和任务；完整定义不会返回给 AI。运行记录与有限日志保存在 SQLite `tool_tasks`，UI 按秒轮询摘要，并只读取当前查看任务的完整结果。后续事件流与日志 cursor 不提供占位端点。

运行弹窗使用 API 返回的任务 ID 跟踪本次执行，不按最新历史记录或操作名替换。公开输入通过 Core prepare 接口按 JSON Schema 2020-12／Ajv 校验和补默认值；未修改字段省略，由 Registry 注入默认值，参数预览展示校验后的有效公开参数。`ToolTask.events` 可选存储至多 64 条带时间的本地阶段事件，兼容旧任务；摘要不携带事件正文，详细读取才返回。事件仅使用固定阶段文案和 HTTP 数字状态码，不插入地址、输入、Header 或异常原文。`canRestart` 动态反映同会话输入缓存与结束状态，前端另校验当前工具版本／启用状态，Registry 继续做最终授权校验。

网格工具页的原生 dialog 使用共享 Toast 视口及离开保护；公开命名空间自动生成。显示名称允许 1–64 个可打印字符，namespace 与操作名继续按安全标识校验。Terminal 的空目录或 `.` 在执行时统一解析为用户主目录，空 Shell 使用平台默认；显式目录继续验证绝对路径与存在性。HTTP 可选 `responseMode: text` 将响应包装为 `{status, body}`，仍执行输出允许列表、大小限制及固定值脱敏；未设置该字段时按 JSON 裁剪规则处理。

工具配置由 `SimpleToolConfig` 呈现三类当前引导表单，`ToolConfigFields` 仅抽出 JSON 编辑、Header 键值输入及原始输入变更上下文。`ToolConfigEditor` 与高级设置整体删除；Terminal 配置始终显示工作目录、外部参数和必填多行命令，不保留旧配置编辑分支。`.tools-detail-scroll` 使用 `padding: 16px 12px 8px`，为浮动滚动条及控件焦点描边留出空间；Shell 容器通过 `:focus-within` 绘制共享琥珀描边，内部 textarea 取消重复 outline，避免被容器裁剪。

Tauri 首次启动时生成 MCP 令牌并保存到原生应用数据目录，后续启动复用，仅用户手动刷新时替换；通过受限 IPC 提供给 Renderer。Core 必须校验 Host、Origin 和令牌；不得绑定 `0.0.0.0`。

stdio proxy 只转发标准 MCP，不加载第二套数据库和 Runner，stdout 仅输出 MCP 协议数据，诊断写入 stderr。

HTTP MCP、stdio proxy 与应用内部 API 共用同一个会话令牌。第一版无状态 HTTP 网关使用官方 TypeScript SDK；每次工具列表查询和调用均经过同一个 Registry，客户端通过重新调用 `tools/list` 刷新目录。连接配置和实际握手自检放在设置中。详细工具及协议设计见 [MCP_DESIGN.md](MCP_DESIGN.md)。

## 5. Capability canonical model

```text
CapabilityDefinition
├── id/name/namespace/description/version/source/status/enabled
├── runner
│   ├── type: terminal | http | mcp
│   └── settings
└── tools[]
    ├── name/description
    ├── fields[]
    │   ├── key/schema/required
    │   ├── aiVisible
    │   ├── value
    │   └── binding
    └── outputSchema
```

约束：

- `enabled=true` 仅允许 `status=ready`，并且只能由 Lumi Live UI 的用户操作产生。
- `aiVisible=true` 字段不能携带内部固定值。
- `aiVisible=false` 字段不能进入公开 input schema。
- 公开参数默认 `additionalProperties: false`。
- `runner.type`、settings、value、binding、版本历史永不返回 AI。
- 所有面向 AI 的接口必须复用同一个 `deriveAiToolView()` 允许列表函数，不能先序列化完整定义再删除字段。

## 6. Capability Registry

Registry 是数据库与执行层之间的唯一门面：

- `listAiTools()`：返回已启用工具的 AI 公开视图。
- `getAiTool(name)`：返回单个公开 Tool。
- `resolveForExecution(name)`：仅 Core 内部使用，返回完整定义。
- `invoke(name, args, context)`：验证公开参数、路由 Runner、标准化结果并登记 Artifact。
- `saveDraft()`：允许 AI 或 UI 保存草稿但不启用；保存和启用时校验能力定义。
- `enable()` / `disable()`：只允许 UI 用户操作。

MCP Gateway 与 Workbench 都调用 Registry，不直接调用具体 Runner。

## 7. SQLite 逻辑模型

首批表：

- `schema_migrations`
- `capabilities`
- `capability_tools`
- `runner_configs`
- `capability_versions`
- `tasks`
- `task_logs`
- `artifacts`
- `memory_projects`
- `memory_entries`
- `memory_proposals`
- `skills`
- `skill_targets`
- `workbenches`
- `workbench_versions`
- `ai_connections`

Core 使用 WAL、外键和事务。完整 Capability 只有一份 canonical definition，公开 MCP Schema 在读取时派生，不保存可独立编辑的第二份配置。

## 8. Runner 边界

### Terminal

当前统一状态为 `running -> stopping -> completed|failed|cancelled|timed_out`；重启遗留任务标记 `interrupted`。Terminal `run/start` 均无自动运行超时，持续至命令退出、手动停止或 Core 退出；HTTP/MCP 沿用原有超时。相同 capability 的 Terminal 新任务捕获此前的活动任务，停止并等待它们的完成 Promise 后才启动 Shell；不同工具互不影响，停止新任务时不会启动后续命令。macOS/Linux 使用独立进程组停止后代，300ms 后强制终止，等待进程关闭后才记录已取消；Windows 使用 taskkill /T /F。结果与有限日志保存 SQLite，每条流保留至多 64K 字符、结果 JSON 至多 64KiB，近期已结束任务最多 200 条；进程输出暂存后脱敏，跨 chunk 私密值以尾部保留处理。文件日志与 cursor 属后续实现。

### HTTP

根据 field binding 将公开参数和不可见固定值组装进 path/query/header/body。执行请求上限、超时、取消和响应投影。错误不得回传完整请求配置。

### MCP Bridge

为每个已启用上游维护长期 client session。支持 stdio 和 Streamable HTTP；工具以 Capability namespace 暴露，冲突时禁止启用。上游调用不自动重放有副作用的请求。连接池最多 16 个；执行前真实读取目录并比较上游 Schema 签名，上游变化将整条记录转回禁用草稿。发现支持固定鉴权 Header，不转发 Lumi 会话令牌。要求可列举根 properties 的对象参数，保留原始输入 Schema 的根级约束并在合并私密值后校验；开放附加参数仍不支持。图片／文件返回留待 Artifact。

## 9. Artifact 与 Memory

Artifact 使用 `<userData>/artifacts/<artifactId>/`，数据库只保存该根目录下的相对路径。写入采用临时文件、校验、原子 rename、登记元数据。WorkBench 和 MCP 返回 artifact descriptor，不暴露任意本地路径。

Personal Memory 位于用户数据目录；Project Memory 位于项目 `.memory/`。Markdown 是内容源，SQLite 索引可重建。AI 写入先形成 proposal，用户确认后原子写文件并更新索引。

## 10. Skill 同步

- 安装时校验标准 Skill 目录和 `SKILL.md`。
- 导入时拒绝绝对路径、`..`、symlink escape 和超限文件。
- Adapter 支持 copy/link，默认 copy 以获得三平台一致性。
- 使用内容 Hash 检测 drift；冲突不得静默覆盖客户端修改。
- Skill 中的脚本不由 Lumi 自动执行。

## 11. Workbench

采用与 Lumi 同版本的免构建 HTML/CSS/JavaScript 官方工程、统一浏览器 SDK 和开发知识库。三个必要文件为根目录 `index.html`、`app.js`、`style.css`；其他框架可输出相同静态结构。标准 JSON 工程包包含 manifest、运行 files、可恢复 sourceFiles；SQLite 保存版本快照与按项目隔离的 KV。MCP 与桌面导入复用同一验证器。资源服务监听独立随机 loopback 端口，iframe 仅 allow-scripts；MessageChannel 桥经受限 IPC 转发公开 Registry 工具，主题和反馈沿用宿主。主 frame nonce 保护自定义 IPC，不向 iframe 发放凭据。完整实现约束与验证见 [官方主页开发方案](HOMEPAGE_DEVELOPMENT_PLAN.md)。

### 知识库来源存储（2026-10-07）

知识库仅存储和提供外部读取，唯一键为 projectKey＋branch，无 Git 默认为 main。各分组独立版本、commit SHA 和构建锁。外部 AI 提交当前 Git 元信息，Lumi 对比知识 SHA 与调用方提交的最新 SHA，不访问目录/Git、不提供授权或扫描。引用仅存相对路径、文件哈希、行号和片段哈希，校验限于结构。迁移 8 清空旧知识数据且不兼容旧导入，保留其他应用数据；执行 secure_delete、VACUUM 和 WAL 截断。完整契约见 [项目分支知识库](KNOWLEDGE_BRANCHES.md)。

## 12. 三平台交付

使用原生 CI 矩阵构建：

- macOS ARM64/x64：`.app`、`.dmg`，签名和公证。
- Windows x64：NSIS 或 MSI，处理 WebView2 和进程树终止。
- Linux x64：AppImage、deb，固定 WebKitGTK 最低兼容基线。

Node Core 必须按 target triple 生成 Sidecar，并由 Tauri bundle 配置一起打包。Playwright MCP 和浏览器进程按需启动，不作为长期常驻进程。

当前 macOS ARM64/Intel 和 Windows x64 通过原生 GitHub runner 构建。Core 与 stdio 代理使用 esbuild 和 Node 26 SEA 生成包含运行时的独立二进制；macOS 最低版本为 13.5，测试包使用 ad-hoc 签名。验证在空 PATH 下执行实际 sidecar 的 HTTP/stdio 协议。发布者签名、公证及 Linux 安装包仍需后续配置，详见 [桌面打包](DESKTOP_BUILDS.md)。

## 13. 性能原则

- 关闭主窗口先隐藏；符合无待保留状态的闲置条件后释放 WebView，保留托盘和 Core。
- 非活跃上游 MCP 和 Browser 按需启动并在空闲策略下回收。
- 日志使用磁盘滚动、cursor、内存窗口和虚拟列表。
- SQLite 只有一个写入者。
- CI 记录冷启动、后台内存、空闲 CPU、MCP 响应、日志吞吐和产物体积，不用框架宣传值代替实测。

## Skills 目录发现（2026-09-30）

Core 的 Skills Repository 通过异步、有深度/目录数/单文件大小限制的只读扫描发现 SKILL.md，解析 YAML frontmatter，不执行脚本、不导入正文指令。按真实文件路径生成 ID，同一符号链接目标聚合软件与目录来源；不同路径不按名称合并。发现一个技能后，仅继续扫描其标准 `skills/` 子目录，以支持技能包中的独立子技能。Codex 支持 CODEX_HOME（默认 ~/.codex）的 skills 和 plugins/cache、共享 ~/.agents/skills；Claude 支持 CLAUDE_CONFIG_DIR（默认 ~/.claude）的 skills 和 plugins/cache；Gemini CLI 同时扫描 ~/.gemini/skills、共享 ~/.agents/skills 和 ~/.gemini/extensions；其余适配器读取各自个人目录。用户添加的项目只扫描各适配器的标准子目录，历史 Codex 项目的 .codex/skills 也保留支持。

SQLite 保存元数据、来源、发现状态、归档状态和项目扫描根目录。技能元数据 JSON 保存 `firstSeenAt` 和 `fileCreatedAt`（UTC ISO 时间或 null）。`firstSeenAt` 首次插入时记录本轮收录时间，在写事务内读取现有记录以保留最早收录值；历史缺失值保持 null。`fileCreatedAt` 来自读取真实 SKILL.md 的文件句柄 stat.birthtimeMs，通过 shared 的 normalizeSkillTimestamp 标准化为 UTC ISO；无效、非正及 Unix 纪元首秒（0–1000ms）的占位值均返回 null，首次发现时间沿用同一校验。扫描、缓存读取与前端日期显示共用该规则，不以当前扫描时间补造历史日期，每次成功扫描更新，可为历史记录补充或反映重建文件；文件缺失或读取失败时保留缓存值。文件系统创建时间不承诺实际安装日期，mtime 不参与排序。无需表结构迁移；读取旧 JSON 时将缺失或无效日期标准化为 null。Repository 按每项的 fileCreatedAt（未知时回退 firstSeenAt）倒序，两者都未知的记录置后，同时间按名称／真实路径／ID 排序，前端筛选保留返回顺序。缺失目录属于正常空目录；权限、格式、超限错误进入扫描诊断。读取失败的目录保留上一轮数据；只有完成的扫描更新对应发现状态。受保护 /app/skills API 和宿主 nonce 校验的 Tauri 白名单命令共用 Repository；主页 SDK 暂不开放 Skills；MCP 仅开放已托管技能的搜索和读取。浏览器模式不伪造本机数据。市场精选使用经核验的官方仓库目录链接，不代表实时市场。

当前归档／恢复仅更新 SQLite 的归档状态，不移动、删除或重命名源技能目录；托管技能归档后停止 MCP 发现和读取，外部扫描技能的归档仅影响 Lumi 列表。

项目目录验证要求可解析的绝对目录路径，最多保存 32 个项目；路径或数量校验抛出 `SkillProjectValidationError`，API 返回 `invalid_skill_project`。其他项目处理失败返回 `skill_project_failed`。Skills 页面已移除扫描位置展开区及项目添加表单，Core 的项目配置与扫描接口保留兼容既有配置。

前端将 Skills 内容区约束为窗口内布局，并取消该页面的通用最大宽度，随窗口铺满宽度、调整高度。Tab 与搜索工具栏保持固定；来源筛选按钮组最大占内容宽度 50%、内部水平滚动，搜索框使用共享宽度变量，刷新图标保持固定点击区域。来源筛选保留各页面状态与无技能选项，提供选中状态、方向键及焦点滚入可见范围。技能列表拥有独立垂直滚动区域；网格依据内容区宽度切换三、二、一列。`skillSourceKey` 将软件／发布方映射到来源标签的 `data-source`，背景和文字复用 `palette.css` 的深浅主题来源变量，未知来源使用中性色；共享技能的来源排序优先当前筛选平台。详情使用 `SkillDetailDialog`，通过原生 `dialog.showModal()` 进入顶层，初始焦点置于标题，提供模态焦点约束、Escape 关闭和触发点焦点恢复。左侧目录与右侧文件内容独立滚动，异步文件请求使用序号防止过期响应覆盖当前选择。`react-markdown` + `remark-gfm` 渲染 Markdown，跳过原始 HTML、不执行脚本；GFM 表格、任务列表、代码块与标题按共享主题排版，非 Markdown UTF-8 文件显示源码。相对文档链接限制在技能目录内，支持光栅图片文件及按可见范围读取的本地 Markdown 图片，外部图片不自动请求；宿主 `open_skill_link` 校验 http/https 链接，用户点击后才交给系统浏览器。`useToastViewport` 在弹窗期间将同一个 `ToastProvider` 的气泡区域 portal 到 dialog，保持窗口顶部位置及原有状态与计时，避免反馈被模态顶层遮挡。

只读文件 API `/app/skills/directory` 与 `/app/skills/file` 沿用 Host/Origin/session 检查及宿主 nonce。由已发现的技能 ID 查库得到规范主文件路径，以该文件所在目录为边界；拒绝绝对路径、路径穿越、内部符号链接及目录重定向。目录枚举最多 800 项、12 层，依赖和构建目录省略；文本预览最多 256 KiB、光栅图片最多 1 MiB，不预览其他二进制或特殊文件。文件读取前后检查真实路径及打开句柄，超限文件返回状态而非正文。只读操作不移动、修改或执行技能文件，主页 SDK 暂不开放该接口；MCP 的托管技能接口复用该文件边界。Markdown 实现依据 [react-markdown](https://github.com/remarkjs/react-markdown) 与 [remark-gfm](https://github.com/remarkjs/remark-gfm) 官方说明。

适配器目录依据：[Codex Skills](https://learn.chatgpt.com/docs/build-skills)、[Claude Code Skills](https://code.claude.com/docs/en/skills)、[Qoder Skills](https://docs.qoder.com/cli/Skills)、[QoderWork Skills](https://docs.qoder.com/qoderwork/skills)、[Cursor Skills](https://prod.cursor.com/docs/skills)、[Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)。这些文档说明客户端的目录约定；Lumi 的扫描范围以 `skillRoots` 为准，来源标签不复现客户端的加载优先级、启用状态或所有兼容目录。

工具引导配置保存在现有 definition JSON：当前 Terminal 表单要求填写 command，执行时运行固定多行脚本，外部字段使用公开 Schema 的 default，由共享 Registry 校验补入，再通过环境传给脚本。目录选择使用受 host nonce 与 main 窗口约束的 rfd 原生异步选择器。HTTP bodyMode 支持 Form/JSON，body 支持嵌套 JSON，字段绑定覆盖顶层参数；responseFilter 按 JSON 拓扑与正则叶值定义白名单，在 500ms 限时 Worker 中处理，防止阻塞 Core，结果沿用大小限制与凭据脱敏。MCP toolName 精确筛选上游操作，签名校验基于筛选后的集合。公开输出 Schema 从返回规则结构派生。

首页启动状态每 250ms 查询至服务就绪，再恢复两秒读取；同版本保留 iframe。初始读取和桥接等待在内容中央显示 Lumi 呼吸文字，减少动态效果时静态显示，失败保留恢复入口。

MCP 的 Lumi.create_capability_draft 支持 Terminal 固定 command 和可选 cwd。共享草稿构造将 command 写入 Runner 设置，固定命令没有运行时 command 字段；未指定命令的既有通道不变。其他类型传入 Terminal 参数会被拒绝。命令配置只通过草稿写入内部存储，MCP 返回摘要，不能启用或执行草稿。

## 工具列表与子页面改版（2026-10-02）

工具列表第一行左侧为「全部 / TERMINAL / HTTP / MCP」类型 Tab，右侧为新增工具。下一行保留搜索、授权状态筛选和刷新。三列卡片首行依次为类型 Tag、占据剩余空间且超长截断的名称、运行或审阅按钮；第二、三行为两行简介，不再显示底部状态与操作数量。卡片名称提供完整辅助技术名称，点击卡片或键盘 Enter/Space 进入工具子页面；首行独立按钮不会重复触发卡片导航。返回列表保留筛选和滚动位置。

已有工具使用整页子页面，顶部左侧返回与工具名称，未归档工具进入详情后默认可编辑；右上角集中运行、保存、启用（仅未启用时）、归档/恢复操作，移除编辑与禁用按钮。保存后继续可编辑，归档工具保持只读。未修改时保存按钮禁用；未保存修改期间运行、启用与归档禁用，保存仍按现有规则转为草稿。导航包含「基本配置」「工具配置」「运行记录」，固定在内容上方；基本配置显示名称和用途，工具配置显示连接、参数及授权审阅，运行记录显示任务与结果。两个配置 Tab 共用编辑草稿，切换保留输入；离开配置进入运行记录沿用未保存保护，校验失败自动切换到首个错误字段所在 Tab 并聚焦。仅下方内容滚动。运行按钮打开参数与结果弹窗，沿用同一 Core 执行链路。新增工具仍采用两步弹窗。修改未保存时继续使用离开保护；所有操作反馈复用顶部 Toast。

归档为可恢复的持久状态，与停用区分：保留配置及执行记录，归档时停用并从默认列表收起；通过状态筛选「已归档」进入查看和恢复。恢复为未授权草稿，须重新审阅启用；归档不强制终止已有任务。数据库增加 archived 标记，UI API archive/restore 使用版本及更新时间校验，已归档工具不能启用或暴露给 AI，新旧草稿保存均保留现有归档状态。

保存、放弃未保存修改与授权启用的二次确认使用独立原生模态弹窗。保存先校验再确认，取消保留输入；操作气泡在最上层弹窗显示，关闭后恢复下层视口。

运行参数准备通过受宿主授权的 ToolsApi `prepare` 读取，复用 Core 的 JSON Schema 2020-12 校验与默认值语义，返回公开有效参数、必需输入键及安全错误定位；不创建任务或调用 Runner。前端只解析显式输入，不动态生成校验代码，兼容桌面 CSP。提交前再次准备并由执行边界重新校验。

2026-10-06 MCP 稳定连接：桌面壳从原生 `mcp-settings.json` 读取端口（默认 38491），从权限受限的 `mcp-token` 读取首次生成的持久令牌。设置修改端口仅保存，下一次应用启动生效；监听占用明确失败，不随机换端口。手动刷新令牌通过仅宿主授权的 POST /app/mcp/token 同步原子保存及热更新认证，不重启 Core；宿主更新内存连接信息，前端凭据更新版本防止过期轮询覆盖刷新响应。HTTP/stdio 配置仍从原生连接信息生成，前端不写凭据到 localStorage。

2026-10-06 手动运行支持 `ToolRunOverrides`：宿主 Tools API 的 prepare/run 传入当前版本、runner settings 与选中操作的固定参数值；Registry 先验证当前启用版本，再构造并校验内存定义。公开参数沿用原 Schema，固定值仍保持不可见及日志/结果脱敏，不允许覆盖身份、参数 Schema、绑定或授权状态。原定义不写库，AI/工作台无法传入覆盖。重跑缓存仅在本会话保留配置覆盖并要求原版本仍授权；AI 无法重放带手动覆盖的任务。MCP 连接按设置指纹分离；临时连接不将配置或上游变更写回原定义。界面仅显示真实日志与终态结果，各自独立滚动、复制，事件时间保留在存储但不显示。

## 开发专用一次性 UI 动作

默认关闭。仅在普通 `pnpm tauri dev` 开发启动时传入 `--lumi-dev-ui-action=terminal.start --lumi-dev-ui-target=<工具UUID>` 启用主窗口的指定工具动作，例如 `pnpm tauri dev --no-watch --config <隔离验收配置.json> -- -- --lumi-dev-ui-action=terminal.start --lumi-dev-ui-target=<工具UUID>`。需在该主窗口直接打开对应运行页；其他窗口不注入预设。前端 `import.meta.env.DEV` 门控动态模块，Rust模块及审计命令只在 `debug_assertions` 编译。debug桌面包若使用生产前端也不能触发；release不注册该能力。

唯一登记动作持有实际开始运行按钮引用并调用 DOM `click()`，沿用原校验、disabled、防重复和Runner，不直接调用运行接口。启动预设不可写，绑定UUID；前端防并发、Rust进程内只允许领取一次，防止HMR或重复Effect重放。审计沿用宿主nonce，仅主窗口、已启用且匹配UUID的固定事件可写；拒绝未知字段和动作，最多64条，无用户参数、命令或密钥。来源记录为development-ui；实际任务仍经现有手动UI路径，任务source仍为manual。无控制HTTP、公网监听、任意selector、eval、shell能力或新持久凭据。生产前端构建后运行 `node scripts/check-dev-ui-production.mjs [release可执行文件]` 检查入口排除。

### 运行快照恢复与日志浮置复制（2026-10-12）

运行窗口及历史任务沿用完整任务快照读取，不新增任务订阅协议；串行调度禁止重叠请求，窗口focus／visibilitychange触发即时读取，清理时移除监听并丢弃迟到响应。任务选择改变后取消旧读取，完整任务可补入尚未包含它的摘要列表，避免摘要清空完整日志。Pro只读检查仍锁屏，旧原生截图不是完成态证据；不尝试解锁。

终端日志不显示“运行内容”标题行，共用LogViewer提供独立浮置操作槽，复制按钮图形缩小为20px，点击区仍36px。正文与滚动条留出独立侧边操作空间，复制基于完整日志字符串，键盘、aria-label及Toast反馈保留。配置快照仍可通过“配置”节点展开。

运行刷新与浮置复制最终验收（2026-10-12）：完整pnpm check通过（27文件、208测试），前端／Core及实际release构建通过；生产前端与release二进制排除开发入口通过，Prettier、git diff --check和UI布局检测通过。5项新增刷新回归覆盖增量／末尾快照、请求串行、恢复可见刷新、任务切换迟到响应、卸载监听清理与失败恢复。

真实浏览器运行窗口连接独立Core ToolsApi／TaskManager／terminal Runner，使用限定development-ui DOM按钮入口执行复核安全示例，未启动额外HTTP控制服务。任务234983b5-3520-41b7-9a08-041ab3c746a0 completed、exitCode 0、stderr空，stdout 389字符；完整渲染及复制文本与任务精确一致（渲染空行占位按空行比较），按钮图形20px／命中区36px，滚动位置固定，窄窗口无整页横向溢出。浏览器Library：运行中libfile_a4dcd337a3888191a50f8a4707b7f196，完成libfile_9cfde00a9a108191b75b289b3436d1f1，窄完成libfile_9d6f5ffb75c48191ade1add2668a2005；这些是真实Runner执行截图，但不是原生截图。

Pro新版独立原生开发实例PID1262／窗口33642，安全任务053952a0-38d7-41da-9d44-e57551c08ce7真实完成、exitCode 0、stderr空、stdout 389字符。原生运行中Library libfile_8e035d17df388191a5044a1f659cf493，截图请求时数据库确为running，可见无标题和小号浮置复制。系统只读确认仍锁屏CGSSessionScreenIsLocked=1，完成后原生画面仍停在部分日志；原生完成态、实际鼠标／键盘复制及解锁后即时恢复未验证，不能用浏览器完成图替代。此前把锁屏陈旧截图直接归因产品刷新故障的判断证据不足，本轮纠正。源码另有可证明的请求重叠、摘要遗漏完整快照缺口，已修复并回归。未尝试解锁。只为本轮闲置验收实例调整端口，原Lumi PID24515、用户数据和历史源码修改保持，未commit/push。

### Terminal／HTTP／MCP 运行界面统一规范（2026-10-12）

- 配置参数每行三个区域：名称、现有可见性／必填标签、输入控件。单行右侧居中与多行右上角问号复用InputHint／Tooltip；说明不常驻，错误持续可见并关联控件。无说明不显示问号。私密值遮蔽，长文本／JSON采用稳定控件；窄窗口名称与标签在上、输入占下一整行。
- 必填及预检依赖优先显示，可选参数按原组内顺序折叠，错误自动展开；折叠不清除值。底栏固定，现有预检／校验、防重复、运行／成功／失败／取消及关闭选择保持。
- HTTP方法与地址、MCP连接与已配置工具名称固定展示；HTTP已有公开参数仍可编辑，MCP手动运行继续使用已保存预设，展示schema与只读值，不新增参数编辑或上游调用能力。请求头固定名称与遮蔽规则、HTTP body/query/header绑定和MCP协议不变。
- 运行记录和最终结果分别显示，均无冗余标题行，复用LogViewer右上浮置复制，小号20px图形／36px命中区；每个复制操作使用对应区域完整字符串，按钮不随正文滚动，不遮挡正文和滚动条，反馈复用Toast。HTTP保留现有状态证据与响应正文／JSON数据，MCP保留现有文本／结构化／错误结果；Core没有保存HTTP响应头，不虚构响应头面板。
- 完整任务快照读取沿用上一轮串行调度、可见恢复立即刷新、迟到响应丢弃及清理；不改变认证、请求构造、序列化、MCP调用或技能内容。

本轮验证限定本机隔离HTTP测试服务与可信MCP fixture，前端浏览器测试桥仅在测试进程中使用，无新增产品控制端口或持久访问。Pro锁屏时不尝试解锁，不把陈旧原生截图视为产品故障或完成证据。

HTTP／MCP运行UI适配最终验收（2026-10-12）：提炼RunParameters和RunParameterRow，保留RunTerminalParameters兼容导出，三工具共用三段参数、InputHint、错误和高级折叠。HTTP固定目标可见、现有值可编辑；MCP已保存预设只读且私密遮蔽。共享JsonEditor及MCP编辑页已有提示移到输入内，UI组件预览同步；未改后端认证、构造、序列化、返回白名单或MCP协议。提交入口增加同步锁避免同一事件时段双击；复制图形／点击区沿用20／36px。HTTP正文JSON仅格式化显示，复制原始完整正文。MCP文本与结构化数据分别具名复制，原始结果仍可查看。运行祖先使用非滚动裁切，避免复制聚焦把阶段状态滚出视口，日志与结果各自内部滚动。

完整pnpm check通过（28文件、215测试），前端／Core构建通过，Prettier、git diff --check及布局检测通过。正式前端和已有实际release二进制的开发入口排除复核通过；本轮Rust源码及开发入口未改，未重建原生发行包。既有Vite大chunk提示仍在。

浏览器真实ToolRunWindow接独立Core ToolsApi／Runner，HTTP仅调用带临时认证的127.0.0.1 echo fixture，MCP仅调用本轮编写的可信stdio echo_local fixture。Core未启动额外控制HTTP服务器，没有访问用户服务或凭据。验证必填失败不执行／错误焦点、问号hover与Escape、私密遮蔽、双击仅一次、HTTP method/query/header/body原样、成功／503／空返回／取消，MCP发现与tools/call的结构化／文本／错误／空返回／取消，关闭选择继续查看／结束运行、各区域完整复制及反馈／键盘／尺寸／不遮正文、窄窗口和已保存定义不变。任务切换迟到响应及监听清理沿用已有刷新回归。

最终HTTP成功任务32583340-d6cb-4209-93f9-dfc8afb4d823（HTTP200）；MCP结构化成功任务a4d9ab3d-7909-4581-9ca5-85429e4cbce3。9个真实隔离任务及协议证据见本次任务protocol-ui-review/protocol-result.json。所有截图均为本地浏览器真实前端＋本地测试协议执行，不是原生鼠标或真实用户服务：HTTP配置libfile_c8a71d569cec81919c954eff29f0b535，HTTP完成libfile_ec15c18f02348191999c9d5765bb188d，MCP配置libfile_b03ef68af2ec81919f46c0d9dd12b66d，MCP完成libfile_2b75f2a445048191a7dd19a828c76fdc。

Pro只读确认仍锁屏CGSSessionScreenIsLocked=1；原生UI、原生鼠标／键盘及Windows/Linux未验证，没有尝试解锁或重启原应用。保留现有用户源码与技能排序／终端／dev入口改动，无commit/push；没有新增会话管理。

### 合并运行连接行（2026-10-12，用户明确调整）

HTTP运行配置只保留一行“请求：”，包含固定请求方式和固定请求地址；MCP只保留一行“MCP：”，包含固定连接摘要与工具下拉。地址展示复用既有脱敏（移除URL凭据、遮蔽查询值及敏感路径），完整查看仅展示脱敏文本。stdio展示真实传输标识和命令basename，不编造URL；窄窗口在同一语义行组内换行。

MCP下拉仅列出已保存且有upstreamName/upstreamSignature的真实discovery目录，不新增发现或配置编辑入口。单工具或已配置工具可预选，多工具无已配置选择时留空。用户可清空选择；项目没有合法空工具调用模式，因此空态禁用实际运行并提示选择工具，不发送空工具名。切换使用对应保存schema和预设，清理临时输入／错误／预检，丢弃前工具迟到预检；不覆盖保存的toolName、预设或连接设置。参数只读规则、同步、浮置复制、技能与开发入口保持。

合并连接行最终验收（2026-10-12）：HTTP“请求：”共用行已包含只读方式与地址；MCP“MCP：”包含安全连接摘要和缓存工具下拉，空态不显示空参数标题。切换清理临时值并同步预检版本，前工具迟到响应不能覆盖当前effective参数。固定连接、已保存toolName／schema／预设不变，没有新增发现、编辑、认证或调用协议。UI组件预览同步。

完整pnpm check通过（29文件、220测试），前端／Core构建、Prettier、git diff --check和UI检测通过；新生产前端和原有实际release二进制的开发入口排除复核通过（Rust及dev入口源码未改）。真实浏览器＋独立Core/Runner验证只读合并、脱敏完整地址与实际原URL请求、stdio摘要、缓存alpha/beta列表、空态含form.requestSubmit不调用、string→integer schema切换、迟到alpha预检丢弃、保存配置不变、双击仅一次、窄窗口。HTTP真实任务5937985a-45c7-41d7-99d4-f15a7ce2e169成功；MCP真实任务d36123f1-a0cb-408b-8d1f-94c6f1cb5c38成功，调用combined_mcp.beta，实际参数shared=7／betaOnly=true，无alphaOnly。测试仅本机临时认证HTTP echo和可信stdio fixture，未启动Core控制HTTP服务。

新版Library截图均为本地浏览器真实UI＋上述本地协议执行：HTTP配置libfile_ef9fbf9deaa0819185eca712ecf69e55，MCP已选beta配置libfile_61487dfab6608191ab8a3685d457df48，MCP空态libfile_77ab635b96308191a29897989e17f745。窄窗图及证据见本次任务connection-ui-review。Pro只读确认仍锁屏CGSSessionScreenIsLocked=1，未尝试解锁，原生鼠标、下拉系统菜单及Windows/Linux未验证。短暂断连未阻塞本轮；原应用和已有源码修改保留，没有commit/push。

2026-10-12 MCP 执行修复：取消连接等待、目录分页、前台请求和 Runner 的信号已贯通；无状态 legacy 取消按唯一在途请求 ID 路由，歧义 ID 不误停调用，不增加 session 管理。Session 缓存分离共享握手与调用者取消，维护引用计数和条目身份，业务错误不关闭其他并发调用。目录预算为整次10秒/最多128页，不受 toolName 过滤后数量影响。

上游完整输入 schema 及输出 schema 缺失来源分别保存到 CapabilityTool.upstreamInputSchema/upstreamOutputSchemaMissing；migration9给capability_tools添加两个nullable列，原有配置保持。预检和执行校验合并后的上游参数；公开目录只投影可见字段，隐藏完整 schema 不直接公开。无声明输出保持实际结构，再经过64KiB限制及私密过滤；显式白名单继续生效。歧义旧text规则在执行前要求重新发现并确认，不做来源猜测或自动改配置。HTTP/MCP同步返回及Terminal.start的异步taskId契约保持。

stdio proxy转发默认310000ms，支持--request-timeout-ms及LUMIPLUG_REQUEST_TIMEOUT_MS（100–3600000ms，CLI优先）；这是转发等待预算，区别于Runner执行期限。取消对应在途请求且不关闭其他请求；短预算返回request_timeout而非Core unavailable，保留结果不确定性。详细协议、旧缓存和取消限制见MCP_DESIGN.md。新增回归只使用临时数据库和可信loopback/stdio fixture，未访问用户服务或真实凭据。本轮不新增权限层、不修改元数据脱敏、不统一HTTP/MCP执行ID，也不创建官网。

## Skills 托管及 MCP 读取（2026-10-14）

SkillsRepository 接收 userDataDir/skills 托管根目录。通过暂存目录、受限文件复制、有效 SKILL.md 校验和原子目录重命名安装；源规范路径的 SHA-256 用作安装槽，同源重试不覆盖已有安装，同名不同来源可共存。单次复制最多 2000 项、12 层、32 MiB，总量及单文件均有界；忽略 .git/node_modules/target/__pycache__，拒绝符号链接和特殊文件。托管扫描与外部扫描共用现有库存，不修改原软件目录。

新增宿主专用 POST /app/skills/import（已扫描 id 或本地绝对 directory 二选一），经过 session 与独立 host token 检查，Tauri skills_request 白名单转发。MCP 会话不能调用安装接口。Registry 注入同一 SkillsRepository，开放 search_skills/get_skill/read_skill_file 三个只读工具；只返回托管、存在、有效、未归档条目。读取每次重新检查可见性和规范目录边界，沿用现有路径穿越/内部链接/文件大小防护，错误通过 MCP isError 和稳定代码返回。搜索分页只返回摘要，不泄露外部扫描位置；正文和附件按需加载。初始化说明及 get_context 提供发现与使用指引。首页 SDK 仍不开放 Skills。


### 2026-10-16 功能验收修复边界

MCP 会话令牌对所有已启用工具一视同仁，不新增分级权限。桌面管理接口 `/app/tools`、`/app/capabilities` 及其子路由必须同时校验现有宿主凭据：它们包含私有配置、手动覆盖值与用户启用动作，不属于 AI 的公开工具接口。AI 仍通过 `/mcp` 创建草稿并调用已启用工具，内部私有值仍由 Core 合并。

stdio 代理为每个请求生成独立线缆 ID，映射响应与取消通知的请求 ID，防止不同客户端的相同原始 ID 相互影响。

任务输入与执行配置快照单独存入宿主专用表，通过受宿主保护的 `snapshot` 操作读取，不加入 MCP 的任务响应；保留原始定义与本次外部输入，不因后续编辑失真。保留期随任务记录清理，旧任务无快照时明确说明。

知识库导出经原生保存面板选择路径，并等待实际写入成功后反馈；取消不显示成功。保留原有导出/导入格式，不扩展 MCP 安装 Skills 或 Memory。

## AI Token 用量 MVP（2026-10-16）

在现有单个 Node Core 中实现 discovery → adapter → UsageRecord → SQLite 增量去重 → 宿主专用查询 → React 展示；不增加软件专属进程。仅发现标准 Codex sessions/archived_sessions、Claude projects、Cursor globalStorage/state.vscdb；不读取凭据、环境配置或聊天正文持久化，不遍历全盘、不跟随符号链接。权限失败是来源状态，不提权重试。Core 启动后及每分钟运行有界扫描，暂停持久化并阻止后续采集。日志按完整行字节偏移增量读取；文件轮转/替换以元数据检测并通过用量记录身份去重。Cursor SQLite 只读查询明确字段，零占位与上下文快照不纳入已报告总量。

Codex 输入包含缓存读取，不再加缓存；累计总量按差值计量，回退拆周期；仅缓存子计数回退时将该差值保留未知，不重算整个周期；跨文件历史先读取有界会话元数据，保存哈希父子关系与分支时间；按原始事件时间解析嵌套祖先，再以来源会话、时间和累计用量指纹去重，response_id 优先；独立会话即使计数和时间相同也不合并。Claude 输入排除缓存，四个互斥字段齐全才计算总量，message.id 用于流式覆盖及跨文件去重。未知保持 null；报告值仅代表局部来源报告，不代表账单。所有持久化记录只含数字、时间、软件、模型及必要哈希标识；不提供 MCP 用量工具。公共参考审计锁定 getagentseal/codeburn@9a40cc603fcd194caca9daa8c5134a61ea7e0e2b，独立实现，不复制第三方代码。

### AI 用量桌面读取修复（2026-10-16）

`/app/usage` 加入桌面 Core 路径白名单，并采用 30 秒读取超时供增量扫描使用；保留主窗口、宿主 nonce 和双 Token 校验。用量已采集但页面无法读取时，不应归因为适配器无数据。手动 scan 先解除历史暂停状态再扫描；UI 只保留刷新入口。展示层仅为空记录补 0，不改写采集层的未知值或合计语义。


2026-10-16 会话名称接入：Codex 名称在扫描结束时由独立只读解析器加载，索引按 updated_at 与追加顺序择新，数据库按 state 版本降序补充；按现有会话哈希规则关联。仅对标准 Codex 根的同级元数据做有界读取，拒绝符号链接，SQLite 仅投影 id/title、使用 readOnly/query_only。名称保存在内存映射，query 为分页明细附加可选 sessionName，不写入 usage_records、usage_files 或 lineage，不修改去重、计数与会话编号。来源缺失或损坏时保留统计并降级为可用名称或脱敏编号。


2026-10-16 会话汇总明细：新增宿主专用 sessions 查询，复用用量筛选与合计口径，在 Core 中先对整个筛选集按 software/session 聚合，再对会话分页。会话总量不取自前 200 条明细；同名会话与跨软件相同编号不合并。会话展开时调用既有 query 并带入 software/session，记录分页与会话分页互相独立，日期和模型约束保持。


参考看板的数据支持：会话汇总附带真实模型集合，支持按名称/编号/模型搜索以及按时间/总量排序；搜索在全量汇总后、分页前执行。CSV 按同一筛选集导出，保留未知为空、0 为数值 0；转义分隔符并防止表格公式注入。宿主专用保存命令延用 nonce/主窗口/双 Token 校验，使用原生保存面板，取消不报告成功。缓存命中按各来源输入语义计算，界面不把缓存写入当成成功复用，不声称已测量延迟节省。

2026-10-17 今日粒度与分页：query 可接收 granularity=hour，在完整过滤记录上聚合 hourly，UTC桶键锚定所选本地午夜、每3600000ms一个桶，不受200条记录页限制，兼容非整点时区。前端按所选日实际长度补齐23/24/25小时，重复本地时刻保留不同UTC键与时区描述，点击桶只筛选对应小时会话。sessions 接收正整数limit（最大200、默认200），前端每页10会话，服务端先完整汇总搜索排序再切页，导出忽略分页。筛选身份/页号/刷新共同约束异步结果，刷新后总数缩小时收敛至最后有效页。

### CodeBurn 全量用量读取（2026-10-17）

稳定性验收补充：Codex 中断检查点的 `pendingUserMessage` 只以等长空白写入派生缓存，保留字符数供来源估算使用；`pendingTools`、`pendingToolSequence`、`pendingSkills` 与普通行为字段一样过滤。过滤同时应用于打包读取器的磁盘写入及 Core 的缓存快照，不改动上游源码或原始会话日志。隔离回归必须以全新 Node 进程读取已过滤的检查点，验证重启续读的计数及估算标记保持一致。既有正式缓存不在验收中原地读取或清理；旧内容随后续派生缓存写回才被过滤，不能宣称历史缓存已清除。详见本轮 [稳定性与 Token 验收](qa/2026-10-17-stability-token/README.md)。

固定 `getagentseal/codeburn` 的 `9a40cc603fcd194caca9daa8c5134a61ea7e0e2b` 提交（0.9.27），MIT 原始读取器在 `packages/core/vendor/codeburn`，通过可重现构建接入43个来源（42工具+1网关）。默认用量采集使用上游发现、解析、跨来源去重及 Copilot 对账；Claude 日志使用上游完整日志解析，Desktop ledger 使用 provider 管线。业务只持久化脱敏会话键、显示名称和计数，不保存原始用户消息或工具参数；上游辅助缓存归 Lumi 私有目录，显示/行为字段在缓存写入边界剔除。旧的原生读取器仅保留显式传入受限根目录的兼容路径。首次成功采集切换各软件的派生记录，使用来源内完整事务，避免与旧ID同时累计。输入统一为未缓存输入；总量=输入+输出（按上游规则包含/另计推理）+缓存读取+缓存写入；`cachedInputTokens` 是缓存读取别名，不再次相加。估算保留标记。网关按日汇总缺少会话身份，与本地请求可能重复，因此全软件统计默认排除，仅单选网关时查看。
