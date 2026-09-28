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
