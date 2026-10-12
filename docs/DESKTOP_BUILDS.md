<!-- SPDX-License-Identifier: MPL-2.0 -->

# GitHub 桌面打包

## 构建矩阵

工作流为 `.github/workflows/desktop-build.yml`，使用 GitHub 托管的原生 runner：

| 系统 | Runner | Rust target | 下载产物 |
| --- | --- | --- | --- |
| macOS Apple Silicon | `macos-15` | `aarch64-apple-darwin` | DMG、保留权限的 APP ZIP |
| macOS Intel | `macos-15-intel` | `x86_64-apple-darwin` | DMG、保留权限的 APP ZIP |
| Windows x64 | `windows-2022` | `x86_64-pc-windows-msvc` | NSIS EXE、MSI |

macOS 最低版本为 13.5，与所包含的 Node 26 运行时一致。Windows 使用 Tauri 的 WebView2 安装检查。当前产物用于测试分发：macOS 使用 ad-hoc 签名，尚未配置 Apple Developer 签名和公证；Windows 安装器尚未配置发布者证书。

## 触发和下载

- 本仓库 `develop` 分支的 PR 成功合并到 `main` 后，自动构建合并后的代码。
- 直接推送 `main`、其他来源分支的 PR 合并，以及关闭但未合并的 PR，均不执行自动打包；对应 PR 关闭事件可能在 Actions 中显示为跳过。
- GitHub 仓库的 **Actions → Desktop Build → Run workflow** 可手动构建，分支必须选择 `main`；选择其他分支时跳过打包。
- 工作流成功后，在该次运行的 **Artifacts** 下载对应平台的包，保留 14 天。
- 每份产物包含 `LICENSE`、第三方许可通知、源码获取信息和 `SHA256SUMS.txt`。

三个平台全部构建并通过校验后，工作流自动发布 GitHub 预览 Release，标签为 `v<应用版本>-preview.<工作流运行序号>`。Release 提供直接下载的安装器、APP ZIP，以及包含许可证、源码信息和校验和的各平台完整 ZIP；另外提供所有下载附件的 `SHA256SUMS.txt`。每个标签固定指向本次打包的 main 提交，已公开的版本不会被覆盖。

发布阶段先验证三份产物完整性、SHA256 和源码提交，再上传到草稿 Release，全部上传完成后才公开。失败时不会公开残缺版本；同次运行可以从发布任务重试未公开的草稿。任一平台构建或验证失败时不执行发布。

打包不需要额外 GitHub PAT 或正式签名密钥；只有发布任务使用工作流自带 token 的 `contents: write` 权限。当前均作为未正式签名的测试预览版发布，不配置自动更新。完整安装、覆盖升级和卸载体验仍需在实际用户电脑验收。

触发规则变更需提交到 GitHub 仓库才会生效。所有打包任务只接受 `main` 分支，并检出触发事件对应的提交 SHA，保证产物与源码获取信息一致。自动打包依赖 GitHub 的 PR 合并事件；在本地合并后直接推送 `main` 不会触发。相同分支、相同平台的新打包任务会取消仍在运行的旧任务；跳过的 PR 事件不会取消正在进行的打包。

## Sidecar

官方首页模板生成会按文件名使用固定顺序，并统一换行符，避免 Windows 与 macOS 的目录排序或换行差异导致 CI 误判模板过期。

Windows Terminal 使用 CMD 的完整命令引用及原样参数传递，支持带空格的可执行路径和带引用的脚本；变量值仍只通过环境传入。跨平台测试按实际路径分隔符、原生路径解析和系统换行符验证。

`pnpm build:sidecars` 将 Core 和 stdio 代理及其 JavaScript 依赖打包，再用 Node 26 的 `--build-sea` 生成独立可执行文件。两个入口仍共用相同的业务实现和协议，不依赖用户的 Node 安装、全局包或开发目录。

Sidecar 按 Tauri 要求命名为 `<name>-<target-triple>`，Windows 增加 `.exe`。原生构建时校验 Rust target 与 Node 的系统、架构一致，不使用跨架构的 Node 二进制冒充目标产物。

`pnpm verify:sidecars` 在空工作目录和空 PATH 下启动实际二进制，验证 SQLite 初始化、Core 就绪、HTTP MCP、stdio MCP 和工具调用，并比较两种入口的工具目录。构建步骤和打包后提取出的 sidecar 都需要通过该检查。

## 本地打包

准备 Node 26、pnpm、Rust 以及对应平台的 Tauri 系统依赖，然后运行：

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
