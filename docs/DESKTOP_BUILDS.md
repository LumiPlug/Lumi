<!-- SPDX-License-Identifier: MPL-2.0 -->

# GitHub 桌面打包

## 构建矩阵

工作流为 `.github/workflows/desktop-build.yml`，使用 GitHub 托管的原生 runner：

| 系统                | Runner           | Rust target              | 下载产物                |
| ------------------- | ---------------- | ------------------------ | ----------------------- |
| macOS Apple Silicon | `macos-15`       | `aarch64-apple-darwin`   | DMG、保留权限的 APP ZIP |
| macOS Intel         | `macos-15-intel` | `x86_64-apple-darwin`    | DMG、保留权限的 APP ZIP |
| Windows x64         | `windows-2022`   | `x86_64-pc-windows-msvc` | NSIS EXE、MSI           |

macOS 最低版本为 13.5，与所包含的 Node 26 运行时一致。Windows 使用 Tauri 的 WebView2 安装检查。当前产物用于测试分发：macOS 使用 ad-hoc 签名，尚未配置 Apple Developer 签名和公证；Windows 安装器尚未配置发布者证书。

## 触发和下载

- 推送 `main` 时自动构建。
- GitHub 仓库的 **Actions → Desktop Build → Run workflow** 可手动构建。
- 工作流成功后，在该次运行的 **Artifacts** 下载对应平台的包，保留 14 天。
- 每份产物包含 `LICENSE`、第三方许可通知、源码获取信息和 `SHA256SUMS.txt`。

工作流只上传 Actions artifacts，不自动创建公开 Release。打包不需要额外 GitHub PAT 或签名密钥；使用工作流自带的 token 和读取仓库权限。

## Sidecar

`pnpm build:sidecars` 将 Core 和 stdio 代理及其 JavaScript 依赖打包，再用 Node 26 的 `--build-sea` 生成独立可执行文件。两个入口仍共用相同的业务实现和协议，不依赖用户的 Node 安装、全局包或开发目录。

CI 固定使用 Node 26.10.0，其中包含 Intel macOS 可执行文件生成所需的 Mach-O 修复（[Node #65389](https://github.com/nodejs/node/pull/65389)，相关问题为 [#65479](https://github.com/nodejs/node/issues/65479)）。本地构建也要求 Node 26.10 或更新版本。

Sidecar 按 Tauri 要求命名为 `<name>-<target-triple>`，Windows 增加 `.exe`。原生构建时校验 Rust target 与 Node 的系统、架构一致，不使用跨架构的 Node 二进制冒充目标产物。

开发时 Unix 使用本机 launcher，Windows 使用原生 SEA；发布包统一使用独立 SEA。

`pnpm verify:sidecars` 在空工作目录和空 PATH 下启动实际二进制，验证 SQLite 初始化、Core 就绪、HTTP MCP、stdio MCP 和工具调用，并比较两种入口的工具目录。构建步骤和打包后提取出的 sidecar 都需要通过该检查。

## 本地打包

准备 Node 26.10 或更新版本、pnpm、Rust 以及对应平台的 Tauri 系统依赖，然后运行：

```sh
pnpm install --frozen-lockfile
pnpm tauri:build
pnpm verify:sidecars
```

发布用 Node 必须来自官方独立发行包。GitHub 工作流通过 `actions/setup-node` 安装它。Homebrew 等依赖本机额外动态库的 Node 不适合用于可分发 sidecar；本地可通过 `LUMI_NODE_BINARY` 指定官方 Node 的绝对路径。构建程序同时收集该运行时和被打包依赖的许可证。

## 参考

- [Tauri GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)
- [Node Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
- [GitHub 托管 runner 清单](https://github.com/actions/runner-images)
