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

初稿状态：已编写，Windows 尚待实际运行。本段将在真实 CI 终态后更新链接与结果；它不能作为通过证据。
