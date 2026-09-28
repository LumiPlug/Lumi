<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 产品规格

状态：首个可交付版本基线

## 1. 产品定义

Lumi 是运行在个人电脑上的 AI 经验与能力中心，让不同 AI 软件共享同一套 Memory、标准 Skills 和可执行 Capabilities，并提供一个可由 AI 调整的个人工作台。

Lumi 不提供模型推理，不做聊天软件、IDE、任意 UI 插件平台或自定义插件运行时。

> 标准 Skills 负责指导，Memory 负责沉淀经验，声明式 Capabilities 负责定义连接，Terminal、HTTP、MCP 三种 Runner 负责执行，统一 MCP 对外服务，Artifact 保存结果，Workbench 负责用户展示与操作。

## 2. 产品目标

1. 不同 AI 软件共享个人经验和项目经验。
2. 标准 Agent Skills 可以交付到不同 AI 软件直接使用。
3. 用户或 AI 可以创建 Terminal、HTTP、MCP 三类声明式 Capability。
4. 所有 Capability 统一通过 Lumi MCP 暴露和执行。
5. 用户可以在 Workbench 中直接使用能力，AI 可以修改工作台结构和有限样式。
6. 通过前后端运行、内网 API 报表、Android 编译安装三个真实场景验证产品。

## 3. 核心对象

### 3.1 Memory

Memory 是 Lumi 内置服务，不是扩展。

- Personal Memory：跨项目、跨 AI 软件使用。
- Project Memory：只对指定项目生效，默认保存到项目 `.memory/`。
- Pending Memory：AI 提出的新增或修改建议，用户确认后写入正式 Memory。

Markdown 是内容源，SQLite 保存索引、标签、来源、关联项目和使用记录。

### 3.2 Skills

Skill 采用标准 Agent Skills 目录，至少包含 `SKILL.md`，并可包含 `references/`、`assets/`、`scripts/`。

Skill 是文件交付：Lumi 保存标准目录，通过 AI Client Adapter 复制或链接到各 AI 软件的原生 Skill 目录。Skill 中的脚本不形成 Lumi 的第二套执行系统，需要执行时调用 Capability。

### 3.3 Capabilities

Capability 是保存在 Lumi SQLite 数据库中的声明式记录，其消费者是 Lumi Core，而不是 AI 软件。

AI 只获得 MCP Tool 的名称、说明、输入 Schema 和允许返回的数据；AI 不感知 Runner 类型、固定值和内部执行配置。

Capability 字段使用统一可见性：

- `aiVisible: true`：生成到公开 MCP Tool Schema，通常在调用时由 AI 提供。
- `aiVisible: false`：只由 Lumi 和 Runner 使用，不通过 AI 管理接口或执行结果返回。

不设计独立 Secret 模块。URL、Token、Header、租户字段、工作目录、MCP 启动参数等都可以作为不可见字段保存在 Capability 完整定义中。当前版本的“不可见”是接口可见性规则，不承诺磁盘加密。

AI 可以创建和修改 Capability 草稿，但不能直接启用。用户在 Lumi 中查看完整配置并对整个 Capability 一次性授权；启用后不再对内部工具逐项授权。

### 3.4 Workbench

Workbench 是 Lumi 的展示和操作层，不属于 Runner。

- Capability 返回文本、JSON、日志流、图片、文件或结构化数据。
- Artifact Store 保存需要持久化的结果。
- Workbench 使用内置组件展示结果并调用同一 Capability Registry。
- AI 修改结构化 Workbench 文档，不修改 React、HTML 或 JavaScript。

首批组件：操作按钮、参数表单、运行状态、实时日志、Markdown、图片、文件、表格、基础图表和数字指标。

### 3.5 AI Connections

不同 AI 软件只连接一个 Lumi MCP。Lumi 提供本机 Streamable HTTP Endpoint、兼容 stdio 的代理入口，以及 Codex、Claude Code、Cursor、Gemini 等客户端的连接和 Skill 同步适配器。

## 4. 三种 Runner

### 4.1 Terminal Runner

用户只配置名称、默认工作目录和 Shell（默认自动识别）。AI 可以提交动态生成的 Shell 命令或脚本。

必须支持 `run`、`start`、`status`、`logs`、`stop`、`restart`。长期任务由 Task Manager 管理，日志使用 cursor 增量读取，停止任务必须终止所属进程组。

### 4.2 HTTP Runner

用户只配置名称、URL、Method、AI 可填写参数、固定字段和允许返回字段。HTTP Runner 使用完整 Capability 组装请求，执行参数校验、不可见字段补充、响应裁剪、超时和错误标准化。

### 4.3 MCP Bridge

支持 stdio 和 Streamable HTTP 上游 MCP，负责连接、握手、工具发现、命名空间、调用转发、长期会话、异常重连和工具列表变化。

外部 AI 永远只连接 Lumi MCP。

## 5. Browser MCP

Browser 不是 Runner，而是使用 MCP Bridge 的预置 Capability。

首个版本内置 Playwright MCP 模板，用户只选择名称、可见/无头和独立/持久会话。Lumi 维护长期上游会话，将工具放入 `browser.*` 命名空间；截图可以直接返回 AI，也可以保存到 Artifact Store。

同时支持粘贴标准 MCP 配置和 AI 创建 MCP Capability 草稿。Chrome DevTools MCP 可先通过自定义 MCP 配置接入。

## 6. 交付模式

### Skill

下载或导入包只是运输格式，安装后必须物化为标准 Skill 目录并交付给 AI 软件。

### Capability

用户表单、AI 草稿、导入文件和未来市场下载包最终都转换成数据库记录。原始导入文件只用于来源、版本和回滚，运行时以数据库、Capability Registry 和 Runner 为准。

### Workbench

保存为数据库中的版本化 JSON 文档。

## 7. 产品页面

侧边栏默认只显示图标，悬浮或键盘聚焦时显示名称。当前导航：

1. Workbench
2. Capabilities
3. Skills
4. Memory
5. 设置（底部）

AI Connections 未来放在设置中；Activity 和错误日志在有真实数据后提供入口。工作台初始页面只保留标题“你的工作台，由你来设计”和系统提示词卡片。卡片提供“仅连接”“工作助手”“功能入口”三种内置模板：仅连接用于在 AI 软件中配置 Lumi MCP，另外两种在配置 MCP 后分别引导 AI 设计工作助手主页或功能入口。模板包含当前桌面会话的 MCP 地址与认证请求头，设置中也提供配置查看与复制。应用重启后需更新配置；网关尚未实现时明确说明暂不能连接。服务状态在设置中查看，能力管理在能力页完成，主页不展示连接状态或模拟统计。AI 直接修改工作台的版本化文档接口仍属于 Workbench 里程碑。

## 8. 验收场景

### 前后端开发

- AI 启动、停止、重启前后端项目。
- AI 和 Workbench 持续读取运行日志。
- Playwright MCP 打开本地页面并截图。
- 截图作为 Artifact 在 Workbench 展示。

### 内网 API 固化报表

- AI 根据 API 文档生成 HTTP Capability 草稿。
- 用户填写不可见字段并启用。
- AI 调用 API 获取结构化数据。
- 数据保存为带时间和查询条件的快照。
- Workbench 展示指标、表格、图表，并导出 CSV/XLSX。

### Android

- Terminal Runner 执行 Gradle 编译并登记 APK Artifact。
- 使用 ADB 查询设备、安装 APK。
- `adb logcat` 作为长期任务运行。
- Workbench 实时展示、搜索和过滤 Logcat。

## 9. 当前不做

- 市场、账号、支付、评分、在线审核。
- Skills/Capabilities 加密和 DRM。
- UI、Browser、Android、Docker、Report Runner。
- 自定义插件代码和任意 UI 注入。
- Capability 内部工具级授权。
- 云同步、团队协作、Scheduler、Webhook Trigger。
- 自带 Chromium 或 CEF。
