<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 技术架构

状态：标准 Tauri 2 实施基线

## 1. 技术决策

Lumi 使用标准 Tauri 2，不集成 Chromium/CEF。界面使用系统 WebView：macOS 为 WKWebView、Windows 为 WebView2、Linux 为 WebKitGTK。

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
│   └── mcp-stdio-proxy/       # 外部 AI 的 stdio 兼容入口
├── tests/
├── package.json
├── pnpm-workspace.yaml
└── vite.config.ts
```

禁止出现 `v1/`、`legacy/` 双运行结构。当前目录没有需要兼容的旧产品实现。

## 3. 进程架构

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
- 为 Core 分配用户数据目录、随机本机端口和会话令牌。
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
- `/events`：任务日志、状态和工具变化事件流。
- `/mcp`：本机 Streamable HTTP MCP。

Tauri 启动时生成会话令牌并通过受限 IPC 提供给 Renderer。Core 必须校验 Host、Origin 和令牌；不得绑定 `0.0.0.0`。

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
- `saveDraft()` / `validateDraft()`：允许 AI 或 UI 保存草稿但不启用。
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

统一任务状态机：`created -> starting -> running -> exited|failed|cancelled|timed_out`。日志顺序写入文件，数据库只保存 cursor 索引和任务元数据。停止任务必须结束整个进程树。

### HTTP

根据 field binding 将公开参数和不可见固定值组装进 path/query/header/body。执行请求上限、超时、取消和响应投影。错误不得回传完整请求配置。

### MCP Bridge

为每个已启用上游维护长期 client session。支持 stdio 和 Streamable HTTP；工具以 Capability namespace 暴露，冲突时禁止启用。上游调用不自动重放有副作用的请求。

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

Workbench 是版本化 JSON 文档，由受限组件、Grid 布局、Capability Binding 和 Theme Tokens 构成。禁止任意 HTML、JS、React 和 CSS。

AI 只能创建 draft/patch；Renderer 先预览，用户确认后应用。执行调用仍通过 Capability Registry。

## 12. 三平台交付

使用原生 CI 矩阵构建：

- macOS ARM64/x64：`.app`、`.dmg`，签名和公证。
- Windows x64：NSIS 或 MSI，处理 WebView2 和进程树终止。
- Linux x64：AppImage、deb，固定 WebKitGTK 最低兼容基线。

Node Core 必须按 target triple 生成 Sidecar，并由 Tauri bundle 配置一起打包。Playwright MCP 和浏览器进程按需启动，不作为长期常驻进程。

当前 macOS ARM64/Intel 和 Windows x64 使用原生 GitHub runner，Core 与 stdio 代理通过 esbuild 和 Node 26 SEA 生成包含运行时的独立二进制。macOS 最低版本为 13.5，测试包使用 ad-hoc 签名；发布者签名、公证和 Linux 安装包仍待配置。详见 [桌面打包](DESKTOP_BUILDS.md)。

## 13. 性能原则

- 关闭主窗口后销毁 WebView，保留托盘和 Core。
- 非活跃上游 MCP 和 Browser 按需启动并在空闲策略下回收。
- 日志使用磁盘滚动、cursor、内存窗口和虚拟列表。
- SQLite 只有一个写入者。
- CI 记录冷启动、后台内存、空闲 CPU、MCP 响应、日志吞吐和产物体积，不用框架宣传值代替实测。
