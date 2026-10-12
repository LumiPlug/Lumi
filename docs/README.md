<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 文档索引

本目录是 Lumi 产品与研发的唯一文档入口。当前仓库根目录就是正式产品工程，不存在 `v1/`、旧版共存目录或迁移兼容层。

- [产品规格](./PRODUCT_SPEC.md)：产品定位、核心对象、交付模式、范围和验收场景。
- [技术架构](./TECHNICAL_ARCHITECTURE.md)：标准 Tauri 2、Node Core Sidecar、数据模型、MCP 与 Runner 边界。
- [官方主页开发方案](./HOMEPAGE_DEVELOPMENT_PLAN.md)：免构建 HTML 工程、SDK、开发知识库、交付、隔离加载与验收。
- [主页验收记录](./HOMEPAGE_VERIFICATION.md)：独立工程构建、SDK 调用、macOS WebView 和检查范围。
- [开发计划](./DEVELOPMENT_PLAN.md)：实施阶段、任务依赖、验收标准和跨平台交付计划。
- [品牌设计与配色基础](./DESIGN.md)：用户提供的 Obsidian & Solar Amber 设计说明，作为项目品牌色、表面层级与组件配色的基础。
- [桌面界面设计规范](./UI_DESIGN.md)：已确认的圆角、字号、控件状态、交互动效、顶部气泡、表单校验与配色实施映射。
- [工具页功能设计](./TOOLS_DESIGN.md)：GPT-6-Astra 设计方案，AI 调用与手动运行同等重要；包含已实施的配置、整体授权、运行和记录，以及后续 Artifact 范围。
- [MCP 设计与连接说明](./MCP_DESIGN.md)：统一 HTTP／stdio 入口、当前工具、认证与自检。
- [许可与品牌说明](./LICENSING.md)：MPL-2.0 许可范围、源码分发要求和品牌使用边界。
- [GitHub 桌面打包](./DESKTOP_BUILDS.md)：macOS ARM64/Intel、Windows x64 的构建、验证和产物下载。

约束：产品、架构和研发决策必须先更新对应文档，再进入实现；实现与文档冲突时以已确认的产品规格为准。

- [共用 UI 组件](UI_COMPONENTS.md)：基础组件 API、现有效果和开发预览入口。
