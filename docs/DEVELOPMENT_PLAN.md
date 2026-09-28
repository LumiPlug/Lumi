<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 开发计划

状态：可执行基线

## 1. 实施原则

1. 当前仓库就是最终产品根目录，所有代码直接落在根结构，不创建 `v1/`。
2. 使用标准 Tauri 2 系统 WebView，不集成 Chromium/CEF。
3. 先建立共享 Schema 和安全边界，再开发 UI。
4. Capability canonical definition 只有一份，AI 公开视图必须通过允许列表派生。
5. Workbench、MCP Gateway 都经过同一 Registry 和 Runner，禁止双执行链。
6. 每个阶段必须有可运行产物、自动化测试和文档更新。
7. 当前没有旧项目兼容要求，不设计迁移层和旧新双栈。

## 2. 工程里程碑总览

| 阶段 | 目标                          | 前置  | 主要产物                                     |
| ---- | ----------------------------- | ----- | -------------------------------------------- |
| M0   | 根工程与质量基线              | 无    | Tauri/React/TS、workspace、CI、测试命令      |
| M1   | Core Sidecar 与通信           | M0    | Sidecar 生命周期、health、IPC/API、共享协议  |
| M2   | 数据和 Capability 核心        | M1    | SQLite、canonical model、aiVisible、Registry |
| M3   | Unified MCP Gateway           | M2    | HTTP MCP、stdio proxy、动态工具列表          |
| M4   | Terminal + Task               | M2    | run/start/status/logs/stop/restart           |
| M5   | HTTP Runner                   | M2    | 请求组装、不可见字段、响应裁剪               |
| M6   | MCP Bridge + Browser          | M3    | 上游 stdio/HTTP、Playwright 模板、截图       |
| M7   | Artifact + Workbench          | M4-M6 | 结果持久化、日志/图片/表格工作台             |
| M8   | Memory + Skills + Connections | M3    | Memory MCP、Skill 同步、客户端适配           |
| M9   | 三场景验收                    | M4-M8 | 前后端、报表、Android E2E                    |
| M10  | 三平台发布                    | M9    | macOS/Windows/Linux 安装包和性能报告         |

## 3. M0：根工程与质量基线

### 任务

- 初始化 pnpm workspace，代码直接位于根目录。
- 创建标准 Tauri 2 + React + TypeScript + Vite 应用。
- 创建 `packages/shared`、`packages/core`、`packages/mcp-stdio-proxy`。
- 配置 TypeScript strict、ESLint、Prettier、Rust fmt/clippy。
- 配置单元测试框架和临时目录测试工具。
- 配置 macOS/Windows/Linux CI 基础矩阵。
- 增加根命令：`dev`、`build`、`typecheck`、`lint`、`test`、`check`。
- Tauri 使用标准系统 WebView；确认没有 Electron、CEF、`v1/` 目录。

### 验收

- `pnpm check` 通过。
- Tauri 开发窗口可启动并显示 Core 未连接状态。
- 三平台 CI 至少完成依赖安装和前端/typecheck；平台打包任务可分阶段启用。

## 4. M1：Core Sidecar 与通信

### 任务

- Core 提供 `/healthz`、受保护 `/app/*` 和事件通道。
- Tauri Rust Host 启动 Sidecar，传入 userData、端口、session token。
- 实现 ready handshake、崩溃检测、有上限退避重启、优雅关闭。
- Renderer 只通过 Tauri 白名单接口获得 Core 状态和 session 信息。
- 建立 `packages/shared` 的 request/response/event Schema。
- 增加最小首页：Core 状态、版本和用户数据路径状态，不展示敏感值。

### 验收

- Sidecar 正常启动、退出、崩溃后受限重启。
- 非法 Origin、Host 或 token 无法访问 App API。
- Renderer 无 Node、Shell、SQLite 直接访问能力。
- Sidecar stderr 可进入本地诊断日志，协议通道不被污染。

## 5. M2：SQLite 与 Capability 核心

### 任务

- 实现 migration runner、WAL、外键和事务封装。
- 创建 capability、tool、runner config、version 等首批表。
- 定义 Terminal/HTTP/MCP canonical Schema。
- 实现 `deriveAiToolView()` 允许列表投影。
- 实现 Capability Repository 和 Registry。
- 实现 draft、validate、enable、disable、version snapshot。
- UI 实现 Capability 列表和三类极简创建表单。

### 验收

- Draft 不能出现在 AI tools 列表，也不能执行。
- 只有 UI 用户动作可以 enable。
- 包含特殊 canary 字段名和值的不可见配置，不出现在公开 Schema、API、日志或错误中。
- Registry 能从同一 canonical definition 同时服务 UI 完整视图和 AI 公开视图。

## 6. M3：Unified MCP Gateway

### 任务

- 使用官方 TypeScript MCP SDK 提供 loopback Streamable HTTP `/mcp`。
- 暴露实际可用的上下文、能力目录、草稿创建工具和已启用 Capability 工具；Memory 工具随 M8 接入。
- 工具调用统一进入 Registry。
- 实现工具列表变化通知或兼容刷新机制。
- 实现独立 stdio proxy，只转发协议到 Core。
- 建立 Generic MCP 连接向导。

### 验收

- 官方 MCP Client 可完成握手、`tools/list`、`tools/call`。
- stdio 与 HTTP 两个入口看到同一工具列表。
- 禁用 Capability 后工具消失。
- MCP wire payload 不包含 runner type、固定 value、binding、内部 URL 或不可见字段。

## 7. M4：Terminal Runner 与 Task Manager

### 任务

- 实现 `run/start/status/logs/stop/restart`。
- 实现跨平台 shell 选择、cwd 校验、超时和取消。
- 实现进程树终止：Unix process group、Windows Job Object 或等价机制。
- stdout/stderr 分流，日志文件滚动，cursor 增量读取。
- Core 重启后识别 orphan task，不盲目重放。
- Workbench 暂以开发页展示状态和日志。

### 验收

- 能启动和停止一个产生子进程的前端开发服务器。
- 慢日志消费者不阻塞子进程。
- stop 后无遗留服务端口和子进程。
- restart 使用原任务快照，不接受隐式参数变化。

## 8. M5：HTTP Runner

### 任务

- 定义 path/query/header/body binding。
- 使用公开参数和不可见固定字段组装请求。
- 实现超时、取消、响应大小限制和标准错误。
- 根据 output schema 裁剪响应。
- 对内部配置和不可见值执行日志/错误脱敏。
- UI 提供请求预览，但不可通过 AI 接口获取完整预览。

### 验收

- Fixture API 验证 GET、POST、JSON、query、header。
- AI 只能提供公开参数，猜测额外参数会被拒绝。
- 请求可以使用不可见 Token，但任何 MCP 结果、错误、活动日志均不包含该值。

## 9. M6：MCP Bridge 与 Browser

### 任务

- 实现上游 stdio MCP 长期子进程和 Streamable HTTP Client。
- 转发 tools/resources/prompts 和列表变化。
- 对工具添加 Capability namespace 并处理冲突。
- 实现连接状态、有限退避重连和干净关闭。
- 增加粘贴标准 MCP 配置导入。
- 增加 Playwright MCP 内置模板和版本锁定。
- Browser 默认使用独立 Profile，支持可见/无头、独立/持久会话。

### 验收

- 一个 fixture MCP 的工具可通过 Lumi 统一 MCP 调用。
- 上游断开后状态正确，不自动重放副作用调用。
- Playwright 可以打开本地页面并返回截图。
- 外部 AI 不需要配置 Playwright，只需要 Lumi MCP。

## 10. M7：Artifact Store 与 Workbench

### 任务

- 实现 image/file/json/dataset/report/log/apk Artifact。
- 临时写入、Hash、原子 rename、相对路径和路径穿越防护。
- 实现 Workbench versioned document 和 schema validator。
- 内置 button/form/status/live-log/markdown/image/file/table/chart/metric。
- 实现 Capability Binding、draft、preview、apply、rollback。
- AI 只可以创建和 patch draft。

### 验收

- 截图、APK、数据集和日志可以登记并重新打开。
- Workbench 只能绑定公开 Capability Tool。
- 任意 HTML、JS、React、CSS 字段均被 Schema 拒绝。
- 十万行日志使用虚拟列表仍可操作，不一次加载全部正文。

## 11. M8：Memory、Skills 与 AI Connections

### Memory

- Personal 与 Project Markdown 内容源。
- 文件 Hash、索引和全文检索。
- `search/read/propose/list_projects` MCP 工具。
- proposal 用户确认、冲突处理和原子写入。

### Skills

- 标准 `SKILL.md` 校验和安全导入。
- Lumi canonical Skill Store。
- 至少两个真实 AI Client Adapter。
- copy/link、hash drift、冲突提示和禁用同步。

### Connections

- Generic MCP 配置说明。
- Codex、Claude Code、Cursor、Gemini 中至少两个完成自动或引导式连接。
- 不直接覆盖无法安全合并的客户端配置。

### 验收

- 两个不同 AI 软件能读取同一 Memory 服务并使用同一 Capability。
- 同一个标准 Skill 成功交付到至少两个 AI 软件。
- Skill 冲突不会静默覆盖用户修改。

## 12. M9：场景验收

### 前后端

Terminal 启动/停止/重启项目，读取日志；Playwright MCP 打开 localhost、截图并登记 Artifact；Workbench 展示状态、日志和截图。

### 内网 API 报表

AI 创建 HTTP Draft，用户填写不可见字段并启用；获取结构化数据、保存快照；Workbench 展示指标/表格/图表并导出 CSV/XLSX。

### Android

Gradle 编译、登记 APK、ADB 查询和安装；Logcat 长期运行；Workbench 实时展示、搜索和过滤日志。设备侧 ADB 确认仍由 Android 系统完成。

## 13. M10：三平台发布

### 任务

- macOS ARM64/x64 签名、公证、DMG。
- Windows x64 安装器、WebView2 检查、进程树测试。
- Linux x64 AppImage/deb 和 WebKitGTK 基线验证。
- 为每个 target triple 构建并打包 Node Sidecar 和 stdio proxy。
- 生成 SBOM、第三方许可证、崩溃与诊断包导出。
- 建立升级前数据备份和数据库 migration 回滚策略。

### 性能报告

每个平台记录：冷启动、窗口首次渲染、关闭窗口后的后台内存、空闲 CPU、MCP tools/list/call 延迟、日志吞吐、Playwright 首次/复用时间和安装包体积。

不得只以 macOS 数据代表三平台，也不得以框架宣传指标替代实测。

## 14. 测试矩阵

- 单元：Schema、aiVisible、namespace、错误标准化、Workbench validator。
- 数据库：migration、约束、事务、版本快照和并发读取。
- Registry：draft/disabled 拒绝、公开/内部视图、统一路由。
- MCP：HTTP/stdio 握手、list/call、动态工具、隐藏字段 wire 检查。
- Runner：fixture process/API/MCP 的超时、取消、日志、重连和裁剪。
- 安全回归：canary 字段名和值不得出现在 MCP、App AI API、错误和活动日志。
- 桌面 Smoke：Tauri 启动、Sidecar 生命周期、窗口关闭后后台运行。
- 场景 E2E：三个产品场景保存可复现脚本、日志和 Artifact 证据。

## 15. Luna worker 首次落地范围

首次实现严格限定为 M0 + M1 + M2 的最小闭环：

1. 在根目录初始化标准 Tauri 2/React/TypeScript 工程和 workspace。
2. 建立 Node Core Sidecar、健康检查和 Tauri 监督骨架。
3. 建立共享 IPC/API Schema。
4. 建立 SQLite migration 和 Capability canonical model。
5. 实现 `deriveAiToolView()`、Repository、Registry 的最小版本。
6. 实现 Capability 列表与三类草稿的基础 UI，不实现 Runner 执行。
7. 添加 canary 泄漏测试、类型检查、单元测试和构建验证。

首次落地不得实现市场、加密、Secret、UI Runner、自带 Chromium、旧版兼容或 `v1/` 子工程。以下是本次首次落地的实际状态，不改变产品目标和后续里程碑。

### 实际完成（2026-09-05）

- [x] 根目录标准 Tauri 2 + React + TypeScript + Vite 工程、pnpm workspace、严格 TypeScript、ESLint、Prettier、Vitest 和三平台基础质量 CI 矩阵。
- [x] `src-tauri/` 只保留窗口、托盘、生命周期、Tauri 白名单 IPC 和 Node sidecar 监督；配置使用系统 WebView，不包含 Electron、CEF、自带 Chromium 或 `v1/` 子工程。
- [x] `packages/core` 提供 loopback `healthz`、受保护 `/app/*`、受保护 `/events` SSE 骨架；Rust 生成随机 loopback 端口和 session token，Core 通过 `sidecar.ready` JSON handshake 回报就绪。
- [x] Rust sidecar 监督具备启动、stdout/stderr 诊断、崩溃后的最多 3 次指数退避重启、显式重启和关闭；普通状态 IPC 返回 Core 状态和能力摘要，MCP 配置通过主窗口专用白名单 IPC 获取当前会话令牌。
- [x] `packages/shared` 提供 JSON 可序列化的 request/response/event、health、handshake 和 Capability Schema，以及 Terminal/HTTP/MCP draft 类型。
- [x] `packages/core` 使用 Node 内置 SQLite，完成 migration runner、WAL、外键、事务、canonical definition Repository、version snapshot 和 Registry；`enable/disable` 只接受 UI actor，draft 不进入 AI tools。
- [x] 统一 `deriveAiToolView()` 通过允许列表生成公开输入/输出 Schema；不可见字段的 value、binding、runner settings 不从 canonical 定义读取到 AI 视图。
- [x] React 最小 Capability 管理页已支持列表、Terminal/HTTP/MCP 三类创建入口和 draft 状态；没有伪造 Runner 执行或完成状态。
- [x] SQLite/Registry/AI projection、canary、Host-Origin-session 防护和 events 通道测试已加入；根命令已提供 `dev`、`build`、`typecheck`、`lint`、`test`、`check`。

- [x] Unified MCP Gateway 提供真实 Streamable HTTP 握手、`tools/list`、`tools/call`、基于 Registry 的实时目录刷新和 stdio 协议代理（M3 基础版）。内置上下文读取、公开能力目录及 AI 草稿创建工具已可调用。

### 未完成（按范围刻意保留）

- [ ] Terminal/HTTP/MCP Runner 的真实执行、Task Manager、日志 cursor、请求组装/裁剪、MCP Bridge 和 Browser（M4-M6）。Registry 可执行内置管理工具，能力 Runner 调用仍明确返回未实现错误。
- [ ] Artifact、Workbench、Memory、Skills、AI Connections、场景 E2E 和三平台发布（M7-M10）。
- [ ] 当前 sidecar staging 为本机开发用 Node launcher；自包含、签名且覆盖各 target triple 的 sidecar 由 M10 完成。

### 阻塞与验证边界

- 当前没有阻塞 M0-M2 代码落地的事项。首次 pnpm 安装在沙箱内因 registry DNS 被阻断，随后在获准的联网环境中完成依赖安装；只批准了 `esbuild` 安装脚本。
- Windows 自包含 sidecar launcher 和三平台安装包不是本次 M0-M2 的验收项，现有 staging 脚本会在 Windows 明确提示延后到 M10；三平台 CI 当前执行依赖安装、前端/Core 类型检查、lint、单测和 production build。
- 已完成 Tauri dev 启动、sidecar/Core handshake、loopback API，以及官方 v1／v2 MCP 客户端和 stdio 代理协议验证；真实 Runner 和完整三平台桌面 E2E 属于后续里程碑。

### 下一步（M4）

1. M3 基础协议和连接配置已接通；继续以官方客户端与隐藏字段 canary 回归保护同一 Registry 公开视图。
2. M4：在不改变 canonical model 和 Registry 门面的前提下，加入 Terminal Runner 与 Task Manager 的 `run/start/status/logs/stop/restart`，实现 cwd 校验、进程组终止、cursor 日志和 orphan task 识别。

### 桌面界面调整（2026-09-27）

- 产品展示名称改为 Lumi；保留内部包名和 Bundle Identifier，以继续使用当前工程与本地数据。
- 侧边栏改为图标导航，鼠标悬浮与键盘聚焦显示名称。
- 工作台只展示真实 Core 状态和能力数量；移除未接入功能的假统计、示例模块和无效操作入口。
- Skills 与 Memory 页面明确标注尚未接入；不把规划功能展示成已可用功能。

### 初始化工作台调整（2026-09-28）

- 工作台只保留“你的工作台，由你来设计”标题与系统提示词卡片，替换原 Core 状态与能力数量概览。
- 可选择“仅连接”“工作助手”“功能入口”的固定内置模板；三份模板均包含当前桌面会话的 MCP 地址与认证请求头，类型选择存储在本机，支持复制。
- 设置页提供 HTTP／stdio MCP 配置查看、复制与真实握手自检，凭证通过主窗口 Tauri IPC 读取，不存储到前端本地存储。HTTP、stdio 和应用内部 API 共用同一个会话令牌。
- 左侧移除连接状态，设置中保留真实服务信息；界面内 Logo 去掉光晕，浅色窗口采用暖灰背景与白色内容面板。
- 实际软件与效果页共用初始化工作台；AI 自动写入工作台的版本化文档接口仍由 M7 完成。
