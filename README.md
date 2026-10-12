<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi

Lumi 是运行在个人电脑上的 AI 经验与能力中心，让不同 AI 软件共享 Memory、标准 Skills 和可执行 Capabilities，并提供个人工作台。

项目使用 Tauri 2、React、TypeScript 和 Node Core Sidecar，通过统一 MCP 连接外部 AI 客户端。当前处于开发阶段；功能范围与实现进度见 [产品规格](docs/PRODUCT_SPEC.md) 和 [开发计划](docs/DEVELOPMENT_PLAN.md)。

## 开发

安装 Node.js、pnpm 和 Rust，并按 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/) 准备对应平台的系统依赖。开发工具版本可参考 [CI 配置](.github/workflows/ci.yml)。

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

各平台的交付限制和进度见 [开发计划](docs/DEVELOPMENT_PLAN.md)。

## 文档与贡献

- [项目文档索引](docs/README.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [贡献指南](CONTRIBUTING.md)
- [GitHub 桌面打包与下载](docs/DESKTOP_BUILDS.md)

## 许可证

本项目采用 **Mozilla Public License 2.0（MPL-2.0）**，完整条款见 [LICENSE](LICENSE)，许可范围及品牌说明见 [许可与品牌说明](docs/LICENSING.md)。

MPL-2.0 允许商用、修改和分发。分发受其覆盖的文件及其修改时，应按许可证要求提供相应源码；独立且不包含 MPL 代码的新文件可以采用其他许可。第三方依赖继续遵循各自许可证。

Lumi 名称及 Logo 的使用还涉及品牌和商标权利，MPL-2.0 不授予相关商标权利。

## AI 开发 Lumi 主页

Lumi 提供同版本的 HTML/CSS/JavaScript 官方主页模板、浏览器 SDK 与知识库。外部 AI 只需编辑根目录 `index.html`、`app.js`、`style.css`，可添加其他静态资源或使用其他框架生成静态输出；用户无需安装 Node 或构建。AI 通过 MCP 发布标准包、导出源码和恢复版本。页面通过 SDK 调用公开 Core 工具、使用项目 KV、同步主题与顶部气泡。当前能创建真实能力草稿，Runner 执行仍未接入。

- 完整方案：[官方主页开发方案](docs/HOMEPAGE_DEVELOPMENT_PLAN.md)。
- 模板入口：[LUMI_DEVELOPMENT.md](templates/html-home/LUMI_DEVELOPMENT.md)。
- 维护：`pnpm sync:home` 更新版本、SDK和嵌入模板；`pnpm check:home-contract` 检查一致性。


## 开发专用一次性 UI 动作

默认关闭。仅在普通 `pnpm tauri dev` 开发启动时传入 `--lumi-dev-ui-action=terminal.start --lumi-dev-ui-target=<工具UUID>` 启用主窗口的指定工具动作，例如 `pnpm tauri dev --no-watch --config <隔离验收配置.json> -- -- --lumi-dev-ui-action=terminal.start --lumi-dev-ui-target=<工具UUID>`。需在该主窗口直接打开对应运行页；其他窗口不注入预设。前端 `import.meta.env.DEV` 门控动态模块，Rust模块及审计命令只在 `debug_assertions` 编译。debug桌面包若使用生产前端也不能触发；release不注册该能力。

唯一登记动作持有实际开始运行按钮引用并调用 DOM `click()`，沿用原校验、disabled、防重复和Runner，不直接调用运行接口。启动预设不可写，绑定UUID；前端防并发、Rust进程内只允许领取一次，防止HMR或重复Effect重放。审计沿用宿主nonce，仅主窗口、已启用且匹配UUID的固定事件可写；拒绝未知字段和动作，最多64条，无用户参数、命令或密钥。来源记录为development-ui；实际任务仍经现有手动UI路径，任务source仍为manual。无控制HTTP、公网监听、任意selector、eval、shell能力或新持久凭据。生产前端构建后运行 `node scripts/check-dev-ui-production.mjs [release可执行文件]` 检查入口排除。
