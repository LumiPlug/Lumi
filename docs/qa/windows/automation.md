<!-- SPDX-License-Identifier: MPL-2.0 -->

# Windows 自动化运行与排错

## 设计与隔离

使用 [Tauri 官方 Windows WebDriver CI 方案](https://v2.tauri.app/develop/tests/webdriver/ci/)：`tauri-driver` → Microsoft Edge Driver → WebView2。直接用少量 W3C WebDriver 请求，无额外 JS 测试框架、产品测试插件或 mock IPC。使用正式 release 模式编译，唯一配置覆盖是独立应用标识 `com.lumiplug.windowsqa`；该二进制是 CI 测试构建，不能视作已发布安装包。

`tests/windows/acceptance.mjs` 创建 `RUNNER_TEMP` 下中文、带空格用户目录，白名单继承系统环境，USERPROFILE/HOME/APPDATA/LOCALAPPDATA、解析缓存、WebView2 缓存独立，无真实聊天或密钥。Rust 应用数据另有独立标识，避免依赖 Windows Known Folder 是否采用环境变量。所有数据均合成；仅调用 loopback 服务，无外部 AI 调用。依赖下载发生在构建步骤。测试不改变防火墙、仓库安全设置或安装持久凭证。

安装的 Edge Driver 从实际 WebView2 Runtime 版本生成微软下载地址，并验证微软 Authenticode 签名。版本不匹配、下载失败、运行时缺失均直接失败，不跳过断言。原生重启通过结束隔离进程树后重新建立会话，证明进程重建后的持久化；正常菜单退出留给 M02/M04。清理只针对本次 driver 的 PID 树及本次构建二进制的确切路径，不按名称/端口结束其他应用。

## CI

- 工作流：`.github/workflows/windows-acceptance.yml`，PR 或手动运行，`windows-2022` x64，`contents: read`；无发布、合并或 secrets 权限。
- 依赖：仓库锁定 pnpm 11.19.0、Node 26.10.0、Rust stable、`tauri-driver` 2.1.0、微软 Evergreen WebView2 及其匹配 Edge Driver。runner 由 GitHub 提供桌面会话；不适用于 Windows service/session 0。
- 顺序：先构建 Rust 检查所需 standalone sidecars，再 `pnpm check`、Rust 单元测试、release 应用构建、WebDriver 验证。
- 证据：Actions artifact `windows-acceptance-<attempt>`，保留 14 天；`results.json` 逐项记录通过/失败，成功工作台截图或失败截图。未执行到的 A 项不算通过。下载必要证据保存到人工记录旁，避免过期。
- 不上传 SQLite、令牌、用户配置、driver 原始日志或完整页面源码。

## Windows 开发者本地复现（人工验收用户无需执行）

先安装 Tauri 2 官方 Windows 构建依赖、上述 Node/pnpm/Rust。用干净专用测试账户，关闭此前同一测试构建，保留其数据用于复核后再使用新账户进行全新运行。

```powershell
pnpm install --frozen-lockfile
pnpm build:sidecars
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build --no-bundle --ci --config tests/windows/tauri.qa.json
cargo install tauri-driver --version 2.1.0 --locked
$env:RUNNER_TEMP = $env:TEMP
$env:GITHUB_ENV = Join-Path $env:TEMP 'lumi-qa-driver-env.txt'
./tests/windows/install-driver.ps1
$env:LUMI_EDGE_DRIVER = Join-Path $env:RUNNER_TEMP 'lumi-edge-driver/msedgedriver.exe'
node tests/windows/acceptance.mjs
```

第一次执行要使用干净的 `com.lumiplug.windowsqa` 测试配置；不得通过删除 `com.lumiplug.desktop` 的真实资料解决重复运行问题。测试资料不提交。

## 排错顺序

1. 在 Actions 看第一个失败步骤；`pnpm check` 失败先修代码/依赖，不能删测试让后续通过。
2. 驱动安装失败：核对 runner 的 `EdgeWebView/Application` 路径、输出的 Runtime 版本、微软下载可达性/签名。不要以禁用签名或权限设置绕过。
3. 会话创建失败：核对 `Lumi.exe` 和 standalone sidecars 已构建，driver/Runtime 版本匹配；保留 Actions 错误，不把它写成产品 UI 缺陷。
4. Core 未就绪：核对测试标识下 38491 端口是否被该次异常残留实例占用；结束自己启动的测试实例，勿查杀日常 Lumi。runner 干净重跑可区分环境问题。
5. A03 失败：查看 iframe/SDK 连接和结果；`localStorage` 抛 SecurityError 是当前沙箱预期，不改 sandbox。SDK KV 写入失败后必须保留旧值。
6. Qoder 失败：核对两个合成根、当次时间范围、`matched` 与 125/条的预期；扫描中状态不能充当完成证据。读文件数与缓存数之和须与发现文件对应，不要求每轮强制重读已稳定文件。
7. 失败截图/JSON 中记录到具体产品缺陷时先报告，另行授权修产品；本任务只修测试/CI/文档。

## 执行记录

2026-10-20 已实际运行通过，代码提交 `009161d957f1e6a13d89c1f019fce75978c17cdc`，基于 `main` 的 `640137e`；后续交付提交只完善人工说明和保存证据。

- [Windows 原生 CI（success）](https://github.com/LumiPlug/Lumi/actions/runs/39373595132)，[具体 job](https://github.com/LumiPlug/Lumi/actions/runs/39373595132/job/118466869605)。release 应用、standalone sidecars、Rust 单元测试 10 项及 A01–A06 全通过。
- Windows 原有 Vitest 集合实际为 **406 通过、12 平台跳过、0 失败（418 总数）**。12 项是原来 `tools.test.ts` 的 8 项 POSIX shell/进程信号用例，以及 `terminal-environment.test.ts` 的 4 项 POSIX/zsh 登录环境用例；本任务没有增加或扩大 skip，也没有把跳过算通过。Windows Terminal 正常/失败输出、取消及运行窗等仍须按 M03/M06 人工验证。
- [三平台质量 CI（success）](https://github.com/LumiPlug/Lumi/actions/runs/39373595140)：Windows/macOS/Linux 均通过；本地 macOS `pnpm check` 为 53 文件、418 项通过，Rust fmt/check/clippy 通过。
- Runtime 与匹配 Edge Driver 均为 `131.0.2903.86`，驱动微软签名验证成功；runner 为 Windows Server 2022 x64。此记录不外推到其他 WebView2/Windows 版本。
- [逐项原始 JSON](evidence/2026-10-20/results.json)、[脱敏日志摘要](evidence/2026-10-20/ci-summary.txt)、[重启后的工作台截图](evidence/2026-10-20/workbench.png) 已保存在仓库；截图可见真实连接与重新读取的中文待办。内置工作台正文并不跟随宿主自动翻译，截图中文不是语言保存失败。
- [原始 artifact](https://github.com/LumiPlug/Lumi/actions/runs/39373595132/artifacts/12242776636) 包含同一 JSON/截图，2026-11-03 到期；ZIP SHA256：`11267b9929b94302962940f4a45e939d9c021f40c34232407f05f9de28098410`。

| 用例 | 实际断言                                                                                                     | 结果 |
| ---- | ------------------------------------------------------------------------------------------------------------ | ---- |
| A01  | release 启动，真实 Rust IPC/standalone Core 0.1.6 就绪                                                       | 通过 |
| A02  | 工具/Skills/知识库/用量/设置可导航，设置中真实 Core 状态，选择并保存英文                                     | 通过 |
| A03  | 真实 WebView2 工作台添加待办，SDK KV 读写，刷新保留；非法键/超限拒绝且旧值不变；原生 localStorage 被沙箱拒绝 | 通过 |
| A04  | 中文空格路径读取国际/CN，4 条源记录核对为 3 条/375 Token，重复扫描不增，损坏行导致部分覆盖及 UI 提示         | 通过 |
| A05  | 暂停后新增记录不入账，点击真实刷新恢复为 4 条/500 Token，再扫不重复                                          | 通过 |
| A06  | 结束隔离进程后重新启动，英文与 SDK 数据/待办/账本保留；SDK 删除生效                                          | 通过 |

人工 M01–M10 均仍未执行；正式安装包、托盘、正常退出、多窗口、真实客户端、升级卸载不能由上表推定通过。本任务没有产品修复、合并或发布。
