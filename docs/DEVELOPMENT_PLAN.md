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
- 实现工具列表变化通知或客户端主动刷新机制。
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
- Terminal 自动 Shell 与系统账户一致；每次任务加载登录交互 Shell 的导出环境，验证桌面精简 PATH、配置变更、显式覆盖、初始化失败/取消和凭据隔离。
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

### 首次落地范围（历史记录）

- 官方主页工程按 [完整方案](HOMEPAGE_DEVELOPMENT_PLAN.md) 实施：同版本免构建 HTML 模板、浏览器 SDK、知识库、工程包加载、源码恢复和回滚；Runner 执行仍按 M4-M6 接入。

- 根目录标准 Tauri 2、React、TypeScript、Vite 与 pnpm workspace；类型检查、ESLint、Vitest 和三平台前端/Core CI。
- Tauri 窗口、托盘、白名单 IPC、Core sidecar 监督及退出清理；Core 崩溃后最多三次指数退避重启。
- loopback 健康检查、受保护的应用 API、统一 MCP 网关；单个会话令牌供 HTTP、stdio 和应用内部 API 共用。
- SQLite 初始化、WAL、外键、事务、能力定义 Repository、版本快照和 Registry；能力草稿始终禁用，启用/禁用只接受 UI actor。
- JSON 可序列化的实际通信类型与能力模型；公开工具 Schema 通过允许列表投影，不暴露执行配置或隐藏字段。
- MCP 上下文、公开能力目录、AI 草稿创建，当前官方 SDK 的 HTTP/stdio 协议测试及隐藏字段 canary 检查。
- 单一正式界面：56px 图标侧栏、完整右侧内容区域、初始化工作台及三种系统提示词、能力草稿列表、设置中的主题和 MCP 配置/自检。
- 删除历史效果页、截图、旧图标、未使用的通信 Schema、占位事件/状态端点，以及旧 SDK 和旧 WebView 兼容分支。

### 首次落地后的里程碑（历史记录）

- M4-M6：Terminal/HTTP/MCP Runner、Task Manager、日志事件与 MCP Bridge；当前调用能力 Runner 返回明确的执行不可用错误。
- M7-M9：工作台执行绑定及其余组件、Artifact、Memory、Skills、AI Connections 和场景 E2E；Skills 已实现本机目录列表与归档；Memory 页面目前仅说明功能范围。
- M10：自包含、签名的 sidecar 和三平台安装包。当前开发 launcher 固定使用本机 Node 和本项目构建入口的绝对路径；移动项目后重新运行 `pnpm build:sidecars`。
- Windows 自包含 sidecar 尚未提供；CI 当前验证前端/Core，不将开发 launcher 视为正式交付物。

### Skills 本机列表落地（2026-09-30）

本次实现 M8 的只读技能发现子集：多客户端个人目录、插件技能缓存与用户添加项目目录扫描；frontmatter 校验与真实路径去重；Core 元数据及归档持久化；已安装/市场/已归档卡片列表与来源筛选。市场是官方精选来源目录。Skill canonical store、导入/下载、copy/link 同步、hash drift 与 MCP 接入继续按 M8 后续实现；目录发现不能替代客户端实际加载验证。

首轮验证：`pnpm check` 通过，包含 63 项测试、类型检查、ESLint 与 Rust fmt/check/clippy；macOS debug 桌面应用打包成功。真实桌面扫描发现 71 项技能，并验证搜索、详情、归档、重启后归档保留、恢复及键盘切换 Tab，测试归档已恢复。深色桌面与紧凑布局截图保存在 `.impeccable/review/skills/`。

网格布局续改：移除顶部发现提示，将 Tab、搜索、来源筛选与刷新图标固定，仅下方列表滚动；卡片改为三列网格，窄窗口两列或一列，详情改用原生弹窗。再次通过 `pnpm check` 的 63 项测试及完整检查，macOS debug 应用打包成功。真实刷新发现 75 项技能，验证桌面三列、紧凑窗口两列、列表独立滚动时顶部控件固定、归档图标不打开弹窗、弹窗中复制反馈可见，以及 Escape 后焦点返回卡片；测试归档已恢复。截图保存在 `.impeccable/review/skills-grid/`。浅色主题仅静态核对共享主题变量，尚无截图验证；单列布局由样式规则确认，未记录实机截图。

紧凑卡片续改：内边距缩为 8px、首行 36px，保留归档／恢复的 44px 点击区域；来源标签采用平台背景与文字色，Skills 铺满可用宽度并随窗口缩放调整布局。`pnpm sync:home` 已同步共享主题及主页包，`pnpm check` 的 63 项测试及完整检查通过，macOS debug 应用打包成功。平台标签的静态 CSS 对比度最低值为深色 6.87:1、浅色 5.47:1。深色实机截图覆盖桌面 2240×1640、宽窗口 2632×1688，以及最小窗口 1440×1120（逻辑尺寸 720×560）的已安装、Gemini 来源筛选和市场，保存在 `.impeccable/review/skills-dense/`。同目录的能力、设置与现有外部用户工作台截图仅用于窗口缩放冒烟验证。浅色主题仍无实机截图，一列断点未截图，未安装平台没有伪造列表数据。归档仍仅在 Lumi 中隐藏并可恢复，物理目录迁移尚未实现。

### Skills 文件详情（2026-10-01）

卡片悬停边框改为主色；详情改为文件目录与预览左右分栏，默认打开主文件，支持 Markdown/GFM、文本源码与常见光栅图片。关闭按钮取消自动聚焦，标题承接初始焦点，键盘控件焦点与关闭后恢复保留。新增受保护的目录/文件只读接口，按已发现技能 ID 限定目录边界，拒绝越界与符号链接，限制枚举、深度及预览字节数；异步请求序号防止过期内容覆盖选择。

验证：`pnpm check` 通过，69 项测试覆盖原有行为及目录/文件读取、鉴权、越界、符号链接、文件大小、Markdown/GFM 与原始 HTML/危险链接/外部图片渲染边界；macOS debug 应用打包成功。真实桌面验证多层目录展开、Markdown 与 YAML 切换，以及 720×560 最小窗口分栏；打开时初始焦点位于标题、关闭按钮无焦点边框。截图保存在 `.impeccable/review/skills-files/`。市场只展示精选介绍与官方来源，不提供未安装技能的本地目录；归档仍只保存列表状态。

### 工具导航与功能设计（2026-10-01）

隐藏 Memory 菜单，将“能力”入口及页面操作文案改为“工具”，内部 Capability 模型与接口保持兼容。GPT-6-Astra 完成 [工具页功能设计](TOOLS_DESIGN.md)，按用户确认的 AI 调用与手动运行同等重要组织列表、详情、配置、授权、运行和记录；新功能仍为设计方案，三类 Runner 按 M4-M6 后续实现。

验证：`pnpm check` 的 69 项测试及完整检查通过，macOS debug 应用打包成功。重新打开打包应用后，真实桌面确认导航仅显示工作台、工具、Skills、设置，工具页标题、草稿表单及空状态文案已更新。

### 工具配置与执行落地（2026-10-01）

按用户确认的 GPT-6-Astra 方案实现工具列表、配置、审阅启用、手动运行与记录；AI 和用户使用同一个 Registry、输入校验及执行通道。Terminal 支持普通运行与后台启动，HTTP 支持参数绑定和输出裁剪，MCP 支持真实上游发现、stdio/Streamable HTTP 连接和操作签名变化时撤销授权。任务保存状态、来源、版本、结果和有界日志，支持停止及当前 Core 会话内的同版本重跑；AI 与主页 SDK 可查询、停止和重跑任务。配置修改后必须重新保存草稿并审阅启用，未保存输入和未完成 JSON 输入均保护离开操作。

M4-M6 的上述执行链已接入。完整 Task 事件推送、Artifact、Memory、Skill canonical store、三平台发布及凭据加密仍为后续工作；目前界面通过定时读取任务元数据和正在查看的单个任务详情更新状态。MCP 根级组合 Schema 和开放额外参数尚不支持，明确拒绝而不伪造操作。

验证：`pnpm check` 的 78 项测试、类型检查、ESLint、主页契约以及 Rust fmt/check/clippy 通过；macOS debug 应用打包成功。测试覆盖真实 Shell/HTTP/MCP fixture、AI 与手动调用、进程组停止、日志脱敏、任务恢复、授权版本检查和受保护的 App API。桌面验证覆盖常规窗口与 720×560 最小窗口、草稿保存、错误聚焦、未完成 JSON 的检查阻止及离开保护、审阅区自动滚入并承接焦点；截图保存至 `.impeccable/review/tools/`。验收草稿始终未启用，已清理。浅色主题按共享令牌静态核对，未做实机截图；Windows/Linux 执行与打包尚未实机验证。

### 工具网格与精简弹窗（2026-10-02）

按用户要求将内容页改为工具卡片网格，顶部筛选固定，卡片区单独滚动；新增、配置、运行和记录放入原生 dialog。基础表单仅展示中文名称、可选用途和必要连接参数，公开标识自动生成。Terminal 空目录／默认 `.` 使用用户主目录，空 Shell 使用平台默认；自定义目录仍校验。HTTP 基础配置默认返回状态与响应文本，沿用输出规则、大小限制与固定凭据脱敏；历史工具维持原 JSON 裁剪方式。MCP 启动参数按行输入、发现后生成真实操作，复杂连接配置、操作 Schema 与预览折叠保留。弹窗使用共享尺寸与动效令牌，保留 Escape、焦点返回、未保存提示与顶部 Toast。

验证：完整 `pnpm check` 通过，80 项测试含默认目录/Shell 的真实 Terminal 执行、中文名称和 HTTP 文本响应脱敏；macOS debug 打包成功。实机确认常规窗口三列／720×560 两列、三种基础配置、仅填写中文名称保存 Terminal 草稿、错误聚焦、Escape 的未保存保护。截图保存至 `.impeccable/review/tools-grid/`；临时草稿始终未授权，已清理；最终审阅通过，保存与授权按钮加载时保留原宽度。浅色主题及 Windows/Linux 仍仅静态或自动化覆盖，未记录实机验证。

### 首页加载与两步工具引导（2026-10-02）

首页启动状态查询由常规两秒调整为启动期间250ms、就绪后恢复两秒；初始工程读取和 iframe 桥接等待显示内容中央 Lumi 呼吸文字，减少动态效果时静态显示。工具页保留网格，新增变为名称/类型/说明与类型配置两步：Terminal 可选原生目录选择、带默认值和说明的外部环境变量、多行 Shell 脚本；HTTP 请求头、Query/Form/JSON Body、保持 JSON 拓扑的正则返回规则；MCP Header 与可选上游工具名筛选。历史定义继续兼容，保存草稿与授权分离。

验证：完整 pnpm check、83项测试、macOS debug 打包通过。新增覆盖固定 Shell 与变量默认值/注入防护、Form 编码和嵌套 JSON Body、结构化正则输出及超时隔离、MCP 精确工具筛选。实机验证1120×820和720×560窗口、名称校验和错误焦点、类型切换与返回保留输入、原生文件夹选择回填、草稿保存、HTTP长配置滚动、居中Loading与桥接后消失。截图在 .impeccable/review/tools-wizard/；所有验收草稿未授权，临时主页版本与草稿已清理，原主页及项目存储保留。独立界面审阅结论为 ship；修复 WebKit 最小窗口步骤切换的操作条残影，将按钮移到滚动层外，并在两种窗口尺寸和三类配置中复核固定按钮、滚动到底与关联表单保存。规范同步完成。浅色及Windows/Linux未做实机验证。

### 新增工具焦点与配置精简（2026-10-02）

删除高级设置、旧配置编辑器及 Terminal 旧配置表单分支，仅保留当前三类配置；JSON/Header 字段抽为 ToolConfigFields。滚动区横向留白调整为 12px，Shell 整个编辑区显示焦点描边，避免内部裁剪和浮动滚动条遮挡。

验证：最终 pnpm check、83项测试、macOS debug 打包、Prettier 与 diff 检查通过。第一批原生验证名称、目录、Shell 键盘焦点及最小窗口，确认普通输入描边完整；根据浮动滚动条遮挡将横向留白从8px增为12px。第一轮最终12px实机确认被Mac锁屏阻断；后续已解锁并补齐四张原生截图，独立审阅确认焦点与高级设置删除范围为 ship。不保存或执行验收工具。

### MCP 构建 Lumi 重启工具（2026-10-02）

补齐 Terminal 草稿的 MCP command/cwd 参数，默认目录为用户主目录；构造固定命令工具时无运行时命令参数，返回摘要不暴露内部命令。通过真实 Lumi MCP 创建 restartLumi（lumiDesktop.run），仅写草稿；随后观察到用户手动启用并运行，MCP 记录 source=manual、completed，重启日志记录重新打开成功，窗口恢复。独立重启进程脱离 Runner 进程组，延迟退出应用并等原进程退出后重新打开；PID变化或退出超时不打开第二个实例；绑定当前macOS调试应用路径，不负责重新编译。

验证：完整 pnpm check、84项测试、macOS debug 打包通过；新增MCP测试验证固定脚本持久保存、无运行时参数、草稿不执行不启用及异类参数拒绝。重启脚本的Shell语法、隔离模拟中的独立启动/凭据隔离/退出后重开/进程变化/退出超时分支通过。工具已保留在Lumi供用户使用。前一轮焦点4张最终原生截图已补齐，12px留白下桌面与720×560描边完整，独立最终判定为 ship（仅焦点与高级设置删除范围）。


## 工具列表与子页面改版（2026-10-02）

工具列表第一行左侧为「全部 / TERMINAL / HTTP / MCP」类型 Tab，右侧为新增工具。下一行保留搜索、授权状态筛选和刷新。三列卡片首行依次为类型 Tag、占据剩余空间且超长截断的名称、运行或审阅按钮；第二、三行为两行简介，不再显示底部状态与操作数量。卡片名称提供完整辅助技术名称，点击卡片或键盘 Enter/Space 进入工具子页面；首行独立按钮不会重复触发卡片导航。返回列表保留筛选和滚动位置。

已有工具使用整页子页面，顶部左侧返回与工具名称，右上角集中运行、编辑/保存、启用/禁用、归档/恢复操作。导航仅包含「配置」「记录」，固定在内容上方；仅下方内容滚动。运行按钮打开参数与结果弹窗，沿用同一 Core 执行链路。新增工具仍采用两步弹窗。修改未保存时继续使用离开保护；所有操作反馈复用顶部 Toast。

归档为可恢复的持久状态，与停用区分：保留配置及执行记录，归档时停用并从默认列表收起；通过状态筛选「已归档」进入查看和恢复。恢复为未授权草稿，须重新审阅启用；归档不强制终止已有任务。数据库增加 archived 标记，UI API archive/restore 使用版本及更新时间校验，已归档工具不能启用或暴露给 AI，新旧草稿保存均保留现有归档状态。

验证完成：完整 `pnpm check` 通过，85 项测试通过；macOS debug 应用打包与更新启动通过。原生 1120×820、720×560 检查类型 Tab 筛选、三列/两列紧凑卡片、配置/记录子页面、右上角动作换行、运行参数弹窗及真实 HTTP 成功记录、未保存返回保护、归档/恢复和已归档筛选；新增工具仍为两步弹窗。保留归档审查示例及运行中审查任务，窗口回到全部工具列表。


### 类型数量与卡片图标（2026-10-02）

类型 Tab 名称后显示当前工具集合的分类总数；默认统计未归档工具，选择已归档筛选后统计归档集合，搜索及普通授权状态筛选不改变分类总数。TERMINAL 使用紫色标签，HTTP 使用蓝色标签，MCP 使用青绿色标签，深浅主题分别映射到共享 palette 变量。卡片操作使用 44×44px 图标按钮：绿色播放表示运行，琥珀色铅笔表示审阅，已归档工具以中性色查看图标进入详情。按钮保留完整辅助技术名称、原生悬停说明及键盘焦点，动作沿用当前子页面与参数弹窗流程。

运行与审阅图标默认使用 outline；悬停、键盘可见焦点和按下时以同色 fill 点亮，移开后恢复 outline。审阅图标使用铅笔，填充时保留反色内部细节；不把动作按钮设置为持久选中的切换控件。过渡沿用共享 120ms 悬停变量，减少动态效果时直接切换。按用户确认，图标交互状态去除按钮边框、背景和矩形焦点描边，以 fill 图标及自身颜色的静态光晕表达悬停、按下和键盘焦点；光晕使用共享 `--lumi-icon-glow-blur`，不循环闪烁。指针或焦点落在独立图标按钮时，不同时点亮整张卡片边框；卡片主体仍保留原来的边框反馈。

验证（2026-10-03）：完整 `pnpm check` 通过，85 项测试、TypeScript、ESLint、主页契约和 Rust 检查通过；macOS debug 应用重新打包并更新启动。原生 1120×820 验证绿色运行图标键盘聚焦后为填充加同色光晕，720×560 验证琥珀铅笔同样点亮，均无按钮或卡片选中描边，默认图标保持 outline。分类数量及标签配色保留；界面恢复全部工具列表。浅色主题沿用已检查的配色变量，本轮未做浅色实机截图。

### 技能与工具归档分类（2026-10-05）

Skills 删除已安装／市场导航行，将已归档作为软件分类的最后一个 Tab；工具类型分类在 MCP 后增加已归档数量入口，删除授权状态下拉框的重复归档选项。普通分类统计与展示未归档内容，已归档集中展示归档内容；保留搜索、键盘导航、详情和恢复操作，复用共用 Tabs 及既有视觉。

验证：完整 `pnpm check` 通过，94 项测试通过，macOS debug 应用打包并更新启动。1120×820 确认 Skills 仅有来源分类／搜索／刷新一行；720×560 确认 Skills 最后一项已归档及空态、Home/End 导航，工具最后一项已归档显示两条真实记录并保留查看及恢复操作。普通集合 15 项与归档 2 项分别计数，归档不受草稿筛选影响，返回普通分类恢复原授权筛选。未修改归档数据；验证后恢复常规窗口及全部工具。


### Skills 首次收录时间排序（2026-10-10）

本机列表改为按 Lumi 首次收录时间倒序，新增记录在前；来源分类、搜索及已归档继续保留该顺序。复用技能元数据 JSON 的 `firstSeenAt`，无需表结构迁移；首次插入记录本轮 UTC 时间，写事务内读取已有值以保护并发扫描。历史记录没有可追溯的添加日期，保持 null／未知并置于已知记录后，相同时间按名称、真实路径及 ID 稳定排序。不采用文件修改时间或文件创建时间；重扫、内容修改、归档／恢复、删除后重现及重启均不重置日期。

验证：最终 `pnpm check` 全部通过，175 项测试及类型、ESLint、主页契约、Rust fmt/check/clippy 通过；`pnpm build` 前端与 Core 构建成功，Vite 保留大于 500 KiB 的 bundle 提示。新增回归覆盖日期排序与持久化、mtime 不参与排序、共享来源合并、同名不同路径、时间相同的稳定排序、历史未知日期、慢／快仓库扫描重叠，以及搜索、来源与归档筛选保序。运行位置为 `/Users/zj/Desktop/LumiP/LumiPlug`，本机 Node 26 与缓存的 pnpm 11.19.0（通过 Corepack）。Computer Use 的 Lumi 应用访问审批及 macOS 锁屏阻断原生界面验证；未重启或重新打包现有应用，因此运行中的旧应用尚未验证新排序。没有提交、推送或部署；源技能文件及其他项目不变。


### Skills 文件创建时间排序（2026-10-10）

按用户确认，将列表排序依据改为真实 `SKILL.md` 的文件创建时间倒序；未知时回退 Lumi 首次收录时间，两者都未知时置后。新增 JSON 元数据 `fileCreatedAt`，成功扫描补充历史记录并更新重建文件的创建时间，文件缺失或读取失败保留缓存；同时间按名称／真实路径／ID 稳定排序，来源、搜索、归档保序。`firstSeenAt` 继续持久化原首次收录时间，mtime 不参与排序。文件系统创建时间仅近似添加到电脑的时间。

验证：完整 `pnpm check` 通过，177 项测试及主页契约、类型、ESLint、Rust fmt/check/clippy 全部通过。回归覆盖同批扫描的文件创建时间倒序、mtime 不参与排序、历史记录补充创建时间、未知／无效创建时间回退及稳定排序、共享符号链接、文件重建更新日期、归档恢复、缓存与重启。已重启 `pnpm dev`，前端 HTTP 200、桌面进程和 Core 正常；通过运行中的 Core 扫描真实本机目录，120 条缓存技能中 72 条具有文件创建时间，验证整份返回列表按有效排序时间倒序，并逐项核对现存文件的系统 birthtime。未进行本轮原生界面截图验证。


### 列表顶部分类与搜索左对齐（2026-10-10）

工具与技能移除各页重复 Tab 内边距，由共享列表顶栏布局统一保留阴影空间并补偿起始缩进。知识库接入相同两行布局：第一行分类／新建，第二行左侧搜索／导入。UI组件页面增加真实列表顶栏示例，组件规范与桌面规范同步。

验证：完整 `pnpm check` 通过，177 项测试及主页契约、类型、ESLint、Rust fmt/check/clippy 全部通过；Impeccable 布局扫描无发现。通过运行中的 Vite 页面在 Chrome 检查 1120×820 与 720×560：工具、Skills、知识库各自首个 Tab 与搜索框左边缘完全一致（常规窗口 x=96，最小窗口 x=80），控件未越出视口、页面无横向溢出；知识库 Home/End 导航及选中状态正常。UI组件列表顶栏预览同样对齐。开发环境通过 HMR 更新；浏览器验证使用真实页面的 Core 未连接状态，未注入业务样例或更改用户数据，本轮未做原生桌面截图与浅色实机验证。


### 技能卡片添加时间（2026-10-10）

描述下方靠右显示文件创建时间，精确到分钟，复用已有共用元信息外观。创建时间缺失时标注首次发现，全部未知时显示添加时间未知；保留卡片打开、归档、来源筛选及排序，并同步产品与 UI 规范。

验证：完整 `pnpm check` 通过，180 项测试及主页契约、类型、ESLint、Rust fmt/check/clippy 全部通过。新增回归覆盖创建时间优先、本机时区跨日显示、无效创建日期回退并明确标注首次发现、未知日期不输出无效 time。Impeccable 布局扫描无发现。通过临时只读 QA IPC 数据在 Chrome 渲染真实 App／SkillsPage，1120×820 三列与 720×560 两列的正常／首次发现／未知日期卡片和归档卡片正常；时间位于卡片边界内，页面无横向溢出，aria-describedby 关联正确。未修改用户技能或归档数据，临时验证入口已删除；本轮未做原生截图与浅色实机验证。开发界面通过 HMR 更新。

### 技能日期可信度、工具状态与卡片视觉方案（2026-10-10）

将已核验的 Unix 纪元首秒占位创建时间视为未知；shared 的 normalizeSkillTimestamp 同时用于 scanner、缓存读取、排序输入和前端显示。有有效首次发现时间则明确回退，无历史时间时维持未知，不用当前扫描时间或 mtime 补造日期。工具卡片复用 Badge 显示状态并在独立动作名称中补充状态。

使用 impeccable 设计三类卡片的可运行组合预览，入口为设置 → UI组件 → 卡片方案。名称／独立动作、身份／状态、两行用途、规模／时间形成固定层级；知识库保持整卡单一查看入口。仅使用现有共用组件及字阶、阴影、主题，完整方案尚未替换业务列表布局。详见 CARD_VISUAL_DESIGN.md。

验证：完整 pnpm check 通过，181 项测试及主页契约、类型、ESLint、Rust fmt/check/clippy 通过。回归覆盖真实占位 birthtime、旧缓存无需重扫的日期修正、首次发现回退和稳定排序、未知日期及历史有效日期不误排除。运行中 Core 重启后只读接口返回120条记录，38条有效创建时间、无1970首秒占位日期；通过真实数据只读预览核验工具状态与技能未知时间。组件预览在1120×820、720×560及深浅主题核验，无横向溢出，三类卡片的普通／短介绍保持176px高度，独立示例按钮触发顶部 Toast，键盘卡片焦点为2px主题描边。Impeccable detector 无发现；未执行用户工具、归档或改写技能文件，临时真实数据预览已删除。截图为共用组件浏览器预览，未进行原生桌面截图验证。

### 卡片视觉方案结构修订（2026-10-10）

按用户澄清，技能方案不展示启用等状态Tag，保留来源和归档入口。工具预览改为首行名称／状态／独立动作、第二行来源类型Tag／添加时间、第三四行为固定两行介绍，删除操作数量底栏。知识库预览纵向及卡片之间间距收紧为8px，无独立按钮的标题行使用正文行高，不预留36px按钮高度。仅修改设计预览，未应用完整业务布局。

验证：完整pnpm check通过，181项测试全部通过；detector无发现。浏览器1120×820、720×560及深浅主题均无横向溢出，工具元信息24px且介绍44px，卡片146px高；知识库150px高（原176px），间距8px。技能实际预览Tag仅Codex／Gemini CLI，归档按钮保留。已恢复深色和viewport，保留设计预览；截图更新于design-preview/resource-cards。

### 卡片视觉方案接入实际列表（2026-10-11）

修正此前仅修改UI组件预览而业务列表仍使用旧布局的问题。工具首行标题、状态和操作，第二行类型与真实createdAt添加时间，描述固定两行；工具日期显示与预览共享toolAddedTime函数，异常日期显式未知。技能首行名称／归档、第二行来源，描述采用共用两行正文，底部日期保留，不显示启用状态Tag。知识库网格和内部间距收紧为8px，内边距8px。保留原查看、运行／审阅、归档／恢复及筛选处理器。

验证：完整pnpm check通过，183项测试全部通过（新增工具日期本机时区跨日与未知日期回归），类型、ESLint、Rust fmt/check/clippy及主页契约通过，detector无发现。用当前Core真实数据（21工具、120技能、2知识库）的临时只读IPC预览渲染实际业务页面，1120×820、720×560及深浅主题无横向溢出；工具146px且说明44px、技能176px且说明44px、知识库按钮147px且间距／内边距8px。工具和技能独立按钮命中正确，技能归档键盘焦点为2px主题描边。未运行或归档用户资源，临时数据与入口已删除；截图为浏览器真实业务组件预览，未做原生截图验证。

### 工具与技能统一紧凑底栏（2026-10-11）

实际列表与UI组件卡片方案统一为标题／操作、两行介绍、左侧类型或来源Tag与最右侧添加时间。合并来源和日期行，纵向间隔从12px改为4px，保留8px内边距、36px操作目标及现有日期语义和处理器。技能由176px、工具由146px统一到普通卡片130px。

验证：完整pnpm check通过，183项测试及主页契约、类型、ESLint、Rust fmt/check/clippy通过；detector无发现。真实Core数据只读业务预览覆盖1120×820、720×560及深浅主题，无横向溢出；底栏日期右边与卡片内边界对齐、独立归档按钮命中和2px键盘焦点正确。共用组件预览同步测得130px，并覆盖正常添加／首次发现／未知时间。未运行或归档用户资源，恢复浏览器深色及viewport，临时数据入口已删除。截图为浏览器真实业务组件，原生桌面未截图验证，开发界面通过热更新生效。


### 终端运行表单逐行配置（2026-10-12）

参数固定每行一个，标签采用共享144px宽度，宽窗口左右对齐、内容容器不超过559px上下排列；工作目录及目录选择独立一行。说明／错误在控件下方并关联aria-describedby。必填与预检要求输入的字段优先，可选字段折叠到高级参数，错误时自动展开；组内维持原顺序，折叠不清除默认或已填值。长文本与数组／对象使用稳定的多行控件选择，输入时不切换控件导致焦点丢失；私有值继续密码遮蔽。内容区域滚动、底部取消和开始运行固定。仅改展示与编辑，不改参数解析、绑定、Shell和Runner。

最终pnpm check通过（25文件、197测试）、前端／Core构建及macOS debug原生包构建通过；布局检测、Prettier与git diff --check通过。新增回归覆盖控件选择、文本换行原样传递、默认值保留、必填优先、可选错误展开及辅助说明／错误关联，现有类型与Runner测试保留。原生宽760×760与窄560×680截图确认对齐、多行文本、上下排列及固定底栏。截图保存到Library：宽libfile_27a0271bfb10819189d5fba8ccee88c7，窄libfile_679c42a6e89c8191936221e702432aee。

因本轮没有可用的UI交互工具，不能完整核实原运行窗口滚动区域内的未保存输入；原Lumi进程24515保持运行，没有强杀或重启。使用单独标识／数据目录的真实新版原生验收包直接打开运行配置页，只复制已检查的终端示例并设置NAME及长文本TEXT验收默认值，不修改用户工具。最终宽窗口进程75111、窄窗口74525已启动。本轮只截配置页面，没有执行命令或生成实际输出；高级参数点击、实际滚动、错误焦点和取消动作尚未原生交互验证，浅色及Windows/Linux未验证。验收包启动入口用于展示，不能代替标准主窗口打开运行窗口的全流程验证；原应用还需在确认无未保存内容后安全更新。源码改动保留供review，无commit/push。


### 终端参数三段与输入问号提示（2026-10-12，用户纠正）

按用户精确要求替换常驻说明布局：每行依次为参数名、已有可见性／必填标签、输入框三个独立区域。单行输入右侧居中、多行输入右上角浮置现有图标库的问号；内部留白避免盖住内容，无说明不显示问号。共享 InputHint 包装控件并保留标签／错误关联，Tooltip 复用原悬停、点击、键盘焦点、Escape 与 portal 行为，仅增加 help 图标选项。长提示自身滚动保持展开，外层页面滚动仍关闭。辅助技术仍可读取说明，错误在控件下方持续可见；窄窗口名与标签相邻，输入在下一整行。共享组件、UI组件预览、产品／UI规范已同步。参数解析、默认值、私有遮蔽及 Runner 没有改变。

最终 pnpm check 全通过（25文件、199测试），含类型、lint、主页契约与Rust fmt/check/clippy；前端／Core和macOS debug原生包构建通过。Prettier、git diff --check及布局检测通过。独立无终端执行的无头浏览器组件夹具验证三段顺序、两种问号定位、hover、click不提交表单、键盘focus、Escape、portal不被滚动容器裁掉、长提示内部滚动和窄窗口布局，结果保存于本次任务 terminal-hint-review/component-check-result.json。此组件测试不代表原生鼠标验证。

Pro 上最终独立原生验收包 Lumi Hint Review Final.app 已实际启动，PID83260，窗口逻辑尺寸960×760。只复制安全示例及演示默认文本到独立数据目录，原Lumi进程24515保持运行，没有强杀、重启或覆盖用户配置。Library原生默认布局图 libfile_e59492a49ba881918236ed23bedd83ff；气泡展开图 libfile_27bd1a1381ec8191ba09727ba797b889 明确标注“组件测试展示态（非原生交互截图）”。本轮无可用原生鼠标交互工具，原生hover/click、取消动作及标准主窗口打开运行页流程尚未验证；没有执行实际终端命令。保留源码供review，无commit/push。


### 仅开发环境 UI 操作入口（2026-10-12）

默认关闭，需显式开发启动参数开启。仅允许主窗口指定工具的 terminal.start；调用真实 DOM 按钮 click，保留常规预检、校验、disabled、重复保护和 Runner 路径。前端 DEV 动态加载与 Rust debug_assertions 双门控，审计仅记录动作、任务状态和输出长度；没有通用 selector、脚本执行、额外控制 HTTP 或持久凭据。具体启动方式与生产排除脚本见 README。

完整 pnpm check 通过（26文件、203测试），Rust开发7测试与release3测试通过；生产前端及实际release二进制无开发入口标记。独立浏览器验证默认关闭、未知动作、非DEV、必填错误与焦点，纯单测覆盖禁用／脱离DOM、重复调用与宿主拒绝。

Pro独立开发实例使用隔离数据目录与已复核只打印的安全示例，实际通过 development-ui 来源的 DOM click 执行一次。任务 568be556-fef6-4c6c-8d25-49fe1e3dc869 已持久化 completed，约8.4秒，exitCode 0、stderr为空。运行中审计有连续输出增长，原生截图已保存（Library libfile_2e4237f3035c81918a101c48d7bb6d88）；截图仍显示运行中与部分输出，完成态UI未得到验证，存在界面状态滞后问题，按范围先报告而未修改。不是原生鼠标点击；没有第二次触发，没有commit/push，原应用与用户配置保持。


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


2026-10-12 用户微调：运行配置中不显示“固定／固定值”视觉Badge，包括HTTP合并请求行、MCP合并连接行及共享请求头／正文值行。只读method／地址、值与实际内容保持；类型、可见性、必填等有意义标签保持。MCP下拉／空态／切换及认证、请求构造不变；“显示固定值／恢复固定值”等动作名称仍保留其原语义。

固定标签移除验收：类型检查和34项相关测试通过；完整pnpm check通过（29文件、221测试），含lint、Rust fmt/check/clippy。真实本地浏览器只读配置展示核实HTTP方式／地址仍readOnly、MCP地址仍readOnly且下拉／空态保持；必填与可见性标签保持。仅复制上一轮隔离fixture定义，测试桥只允许get/tasks/prepare，没有执行端点，任务数0，没有协议调用或外部请求。本轮不尝试原生锁屏验证。Library新版HTTP图libfile_35722b9119248191b4d05eacd1e1af50，MCP图libfile_4024d9314b908191b370c5c2e1df605f。源码保留供review，无commit/push。
