<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi

[English](README.md) · **简体中文**

**你的能力与经验，由你掌握。**

Lumi 是运行在你电脑上的开源桌面应用，集中管理私有工具、Skills 和项目知识。让 AI 在你的授权下调用能力，以可视化方式管理 Skills，让经验与知识跨软件复用，搭建属于自己的私有工作台。

**项目状态：** 正在开发中。功能范围与实现进度见[产品规格](docs/PRODUCT_SPEC.md)和[开发计划](docs/DEVELOPMENT_PLAN.md)。项目文档目前以中文为主。

## Lumi 为你的工作带来什么

### 安全可控的私有能力调用

**开放什么，由你决定。**

将脚本、私有接口和 MCP 服务配置成可重复使用的工具。工具经你审阅完整配置、授权后启用。AI 填写公开的任务参数，Lumi 在执行时补齐内部连接配置。哪些字段通过工具接口对外可见，由你掌握。

Terminal、HTTP 和 MCP 工具支持手动运行与 AI 调用，共用执行链路，并提供可查看的任务状态、日志和结果。

### 可视化 Skills 管理

**Skills，看得见，也管得清。**

集中查看不同 AI 软件在本机保存的 Skills，直观浏览说明、文件目录和资源内容。按来源筛选、搜索和归档，让积累的技能清晰有序。

本机发现覆盖 Codex、Claude Code、Qoder、QoderWork、Cursor 和 Gemini CLI 的标准目录。归档仅在 Lumi 中收起条目，不修改原始 Skill 文件。

### 跨软件的经验知识图谱

**经验连成图谱，跨软件接着用。**

将项目经验与知识整理成可检索的文档和图谱，看清知识之间的关联。让不同 AI 软件通过 Lumi 统一的模型上下文协议（MCP）连接，接入同一份知识，沿着已有积累继续工作。

知识按项目和分支组织，独立维护版本并保留可读的历史。外部 AI 在自身已有的访问范围内读取项目，再将整理好的知识提交给 Lumi。

### 私有工作台

**你的工作台，按你的方式搭建。**

让 AI 按你的工作习惯搭建工作台，将常用入口与项目资料组织在一起。在本地保留、调整自己的工作空间，并支持源码导出和历史版本恢复。

Lumi 提供 HTML/CSS/JavaScript 模板与浏览器 SDK，AI 通过 MCP 发布工作台。定制工作台无需用户安装 Node.js 或执行构建。

## 从一个工具开始

1. **配好一个工具。** 选择 Terminal、HTTP 或 MCP，配置用途、连接信息与参数。
2. **检查后，手动试用。** 核对公开参数与内部字段，授权启用并试运行，检查日志和结果。
3. **连接你的 AI 软件。** 从 Lumi 设置获取当前 MCP 配置，添加到 AI 客户端。通过同一连接调用工具、使用项目知识。
4. **搭建自己的工作台。** 使用 Lumi 提供的工作台提示词，让 AI 帮你搭建并发布自己的工作空间。

桌面测试包的获取方式与平台要求见[桌面打包与下载说明](docs/DESKTOP_BUILDS.md)。

## 当前功能范围

已提供 Terminal/HTTP/MCP 工具配置与执行、本机 Skills 浏览与归档、带版本管理和检索的项目知识图谱，以及 AI 工作台搭建、发布、源码导出和历史恢复。

跨软件 Skills 自动同步、Memory、文件与图片结果持久化及更丰富的结果展示仍在开发或规划中。

工具采用整体授权。内部字段不作为公开工具接口的一部分提供给 AI；字段隐藏不等于磁盘加密或工具执行沙箱。接入时应核对上游返回内容是否包含敏感信息。网络请求与数据去向取决于你配置的工具和外部 AI 客户端。

## 开发

项目使用 Tauri 2、React、TypeScript 和 Node Core Sidecar。

安装 Node.js 26、pnpm 11.19.0、Rust，并按 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)准备对应平台的系统依赖。当前工具链可参考 [CI 配置](.github/workflows/ci.yml)。

```sh
pnpm install
pnpm dev
```

常用命令：

```sh
pnpm check       # 类型、代码规范、测试与 Rust 检查
pnpm build       # 前端与 Core 构建
pnpm tauri:build # 桌面应用打包
```

### AI 开发 Lumi 工作台

官方模板以根目录 `index.html`、`app.js`、`style.css` 为入口，可添加静态资源，也可使用其他框架生成符合契约的静态输出。SDK 提供公开 Core 工具调用、项目存储、主题同步和顶部气泡反馈。已授权工具与外部 AI、手动运行共用同一 Registry。

- [官方主页开发方案](docs/HOMEPAGE_DEVELOPMENT_PLAN.md)
- [模板开发指南](templates/html-home/LUMI_DEVELOPMENT.md)
- `pnpm sync:home` 更新版本、SDK 和嵌入模板。
- `pnpm check:home-contract` 检查一致性。

<details>
<summary>开发专用一次性 UI 动作</summary>

默认关闭。仅在普通 `pnpm tauri dev` 开发启动时传入 `--lumi-dev-ui-action=terminal.start --lumi-dev-ui-target=<工具UUID>` 启用主窗口的指定工具动作，例如：

```sh
pnpm tauri dev --no-watch --config <隔离验收配置.json> -- -- --lumi-dev-ui-action=terminal.start --lumi-dev-ui-target=<工具UUID>
```

需在该主窗口直接打开对应运行页；其他窗口不注入预设。前端 `import.meta.env.DEV` 门控动态模块，Rust 模块及审计命令只在 `debug_assertions` 编译。debug 桌面包若使用生产前端也不能触发；release 不注册该能力。

唯一登记动作持有实际开始运行按钮引用并调用 DOM `click()`，沿用原校验、disabled、防重复和 Runner，不直接调用运行接口。启动预设不可写，绑定 UUID；前端防并发、Rust 进程内只允许领取一次，防止 HMR 或重复 Effect 重放。

审计沿用宿主 nonce，仅主窗口、已启用且匹配 UUID 的固定事件可写；拒绝未知字段和动作，最多 64 条，无用户参数、命令或密钥。来源记录为 `development-ui`；实际任务仍经现有手动 UI 路径，任务 `source` 仍为 `manual`。无控制 HTTP、公网监听、任意 selector、eval、shell 能力或新持久凭据。

生产前端构建后运行 `node scripts/check-dev-ui-production.mjs [release可执行文件]` 检查入口排除。

</details>

## 文档与贡献

- [项目文档索引](docs/README.md)
- [产品规格](docs/PRODUCT_SPEC.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [MCP 连接说明](docs/MCP_DESIGN.md)
- [项目分支知识库](docs/KNOWLEDGE_BRANCHES.md)
- [桌面打包与下载](docs/DESKTOP_BUILDS.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

本项目采用 **Mozilla Public License 2.0（MPL-2.0）**，完整条款见 [LICENSE](LICENSE)，许可范围及品牌说明见[许可与品牌说明](docs/LICENSING.md)。

MPL-2.0 允许商用、修改和分发。分发受其覆盖的文件及其修改时，应按许可证要求提供相应源码；独立且不包含 MPL 代码的新文件可以采用其他许可。第三方依赖继续遵循各自许可证。

Lumi 名称及 Logo 的使用还涉及品牌和商标权利，MPL-2.0 不授予相关商标权利。
