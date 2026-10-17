<!-- SPDX-License-Identifier: MPL-2.0 -->

# 2026-10-17 稳定性与 Token 统计验收

本轮修复一个经脱敏夹具复现的缓存隐私问题，最终 `pnpm check` 通过（46 文件、376 测试）。固定上游 CodeBurn 测试 69 文件、1256 测试通过；Rust 8 项通过。真实 Codex 小样本的数值对账通过。**原生知识库保存闭环、弹窗 AX 和真实五分钟回收仍未验收，不能据此宣布发布验收完成。**

## 基线与隔离

- 仓库：LumiPlug；分支 `feat/ai-token-usage`；HEAD `50d4dbf2457b856d8eed577b0b0e2b9f9288a281`。本轮未切换分支或改变 HEAD。
- 开始时 `git status --short` 有 69 条记录，包含现有 CodeBurn 接入、用量 UI、历史稳定性修复和文档。先保存全文件 SHA256、原始 diff 与工作树状态；没有 reset、clean、stash 或全量提交。
- 直接只读 `git ls-remote` 核实 `origin/main = a4e8171da91fb5696f988a15c2ecf701458dfa8b`；远端未返回 `feat/ai-token-usage`。当前 HEAD 相对该 main 为 2 ahead / 0 behind。未 fetch、push、合并或发布。
- 已核对“拉取最新代码并运行”“缩小设置页 Tab 与内容间距”“调整主页侧栏选中效果”“开发 Lumi AI 用量看板”“核查 Lumi 验证与提交”相关会话；未发现另一个正在写本仓库的开发任务。旧报告仅用于定位，不作为本轮通过证据。
- 独立原生包：`src-tauri/target/debug/bundle/macos/Lumi Acceptance QA.app`；标识 `com.lumiplug.acceptanceqa.20261017`；HOME、SQLite、缓存均在 `/tmp/lumi-acceptance-20261017/qa-home`；独立端口 49671。没有安装或替换正式 APP。
- 正式 APP/Core 的原 PID 为 43996 / 44006。测试服务只绑定独立端口或端口 0。仅停止了本轮 PID 50920 / 50924；交付前再次核对正式实例与端口。

## 本轮增量修复

Codex 的中断恢复检查点包含 `pendingUserMessage`、`pendingTools`、`pendingToolSequence`、`pendingSkills`。原有过滤只覆盖普通记录的消息和工具字段；在消息/工具事件后出现新任务边界的夹具中，恢复检查点仍保存了消息片段和命令。

修复同时覆盖 Core 快照与打包读取器的磁盘序列化：待处理消息替换成**等长空白**，保留估算使用的字符长度；待处理工具及行为字段置空。不修改上游读取器源码、不改变输入/输出/缓存计数，不把估算改标为报告值。

改动范围：

| 文件 | 本轮变化 |
| --- | --- |
| `packages/core/src/usage/codeburn.ts` | 快照过滤补齐中断检查点字段 |
| `scripts/build-codeburn-reader.mjs` | 生成读取器时对磁盘检查点实施相同过滤 |
| `packages/core/src/usage/acceptance.test.ts` | 三项合成回归：Codex 完整生命周期、检查点隐私及新进程续读口径、Qwen 注册读取器解析/去重/缓存/隐私 |
| `docs/TECHNICAL_ARCHITECTURE.md` | 补充检查点过滤规则、历史缓存局限及报告链接 |
| 本目录 | 验收报告、43 来源矩阵、脱敏证据、仅本轮补丁 |

`reports/codeburn-upstream-tests.json` 由现有上游测试命令重新生成。除此以外，基线中的原有文件未被其他操作改动或删除。未新增 UI 或重设计权限。

**历史缓存局限：**仅用夹具复现，没有读取或清理正式缓存，因此不能断言用户已经发生相同泄漏，也不能声明此前派生缓存已清除。新版本的后续缓存写回会过滤这些字段；若要求立即清除所有历史副本，需要在正式 APP/Core 停止后受控清理 Lumi 派生读取缓存，保留原始 Codex 日志。这项操作本轮没有执行。

## 验收结果

| 项目 | 本轮结果 | 证据类型与限制 |
| --- | --- | --- |
| 完整检查 | 通过：主页契约、TS、ESLint、376 测试、Rust fmt/check/clippy | 隔离自动检查；首次沙箱监听 EPERM 导致 65 项测试失败，获准宿主重跑后通过，属于执行环境失败 |
| 固定上游解析器 | 通过：1256 测试、69 文件 | 合成/脱敏上游夹具，不等于 42 款客户端实机验收 |
| Rust 宿主 | 通过：8 单元测试 | 包括窗口回收条件等逻辑，不能代替真实连续隐藏五分钟 |
| macOS ARM64 独立 APP | 最终修复后构建、深度签名检查通过 | debug 包，未公证，未运行 release 构建；Vite 现有大 chunk 提示仍存在 |
| 包内 Core / stdio | 通过：空 PATH、独立工作目录、HTTP 与 stdio 的 30 工具一致 | 最终修复包的真实进程及协议检查 |
| MCP 管理边界与全权限 | 通过协议回归 | MCP token 无法执行宿主管理；仍可调用全部已启用工具，未增加权限分级 |
| 隐藏工具字段 | 通过已有 gateway canary 回归 | AI 目录、输入 schema、调用结果不泄漏隐藏字段 |
| 跨客户端取消 | 通过两条真实 stdio 代理同 ID 并发及迟到取消回归 | 隔离 Core/代理进程，无真实第三方账号 |
| 历史输入 | 通过持久化、Core 重启、宿主读取及 MCP 不外泄回归 | 原生历史视图与键盘操作本轮未运行 |
| 双击运行 | 源码保护仍在，相关渲染回归通过 | 本轮未实际双击；此前浏览器通过不冒充本轮原生通过 |
| 知识库原生保存、重启重导入 | **未运行** | 已准备两文档层级、Unicode、节点和引用的独立知识库；CUA 断连前未执行保存动作 |
| 弹窗原生 AX / 键盘 / 焦点 | **未运行** | 正式 Lumi 主界面 AX 曾正常读取；弹窗根因和修复状态不能由此推断 |
| 空白引导页隐藏五分钟回收 | **未运行** | 逻辑测试通过；真实窗口关闭/托盘重建未操作 |
| 自定义主页五分钟保留 | **未运行** | 沿用既定保守保留规则；不能用普通自定义主页未销毁来判定空白回收失败 |

原生工具实际故障：绑定独立 APP 的 `cua.getApp` 返回 `Transport closed`，重试与 `js_reset` 同样失败。没有收到新的系统授权拒绝，没有推断锁屏。APP/Core 在故障时经进程与 49671 监听核实为正常运行；原生请求的交互结果未确认。正式 APP 的主界面 AX 早先读取成功，不代表随后工具持续可用。

## Token 证据：真实与样例分开

真实样本取自正常获准读取的本机 Codex 单一日志，只提取前 4 个 `token_count` 的数字字段、时间及必要会话/模型元数据。没有复制系统指令、用户/助手正文或工具参数，未提权重读被拒绝文件。原始日志未改写。数值投影和 SQLite 留在私有临时目录；仓库只保留通过标记，不保存真实计数、原始路径或会话身份。

独立参照按 `last_token_usage` 计算：未缓存输入 = `input_tokens - cached_input_tokens - cache_write_input_tokens`；Codex 输出已经包括推理，不能再加一次；总量 = 未缓存输入 + 输出 + 缓存读取 + 缓存写入。与 Lumi 实际默认 CodeBurn 收集路径和查询服务逐项比较。

| 覆盖 | 真实 Codex 4 事件 | 合成回归补足 |
| --- | --- | --- |
| 输入/输出/缓存、重复扫描 | 通过 | 独立累计差值场景、缓存别名、推理不重复 |
| 增量追加/重复追加 | 通过，只改私有投影 | 冷/暖缓存与跨 UTC 午夜 |
| 数据库重启去重 | 通过，重载缓存快照 | 全新 Node 进程从过滤后的磁盘检查点续读，估算值保持 |
| 日期/汇总/明细/CSV | 通过所选日期的日/小时总和、会话/明细/CSV 一致 | UTC 排他边界、Asia/Shanghai 跨日；已有 DST/非整点时区和分页回归 |
| 暂停、重启保留暂停、恢复、关闭 | 通过 | 有界发现中途取消、定时器关闭等已有回归 |
| 未知值/估算 | 此样本无此类事件，不宣称真实覆盖 | 无效计数保持未知，估算标记保留；真实消耗不由正文长度冒充 |
| 隐私最小化 | 真实投影没有正文 | 检查点泄漏先失败后通过，磁盘与新进程验证 |

Claude、Cursor 及其余来源本轮没有选择现成获准真实样本；**真实验证均未运行**。以前报告的 Gemini 等对账没有转记为本轮实测。没有安装 42 款客户端、登录新账号、调用收费 API 或使用真实网关凭据。

43 来源逐项见 [支持矩阵 JSON](support-matrix.json) / [CSV](support-matrix.csv)。全部通过注册与归一化；42 来源有上游独立 provider 夹具套件。`qwen` 固定上游没有同名专属测试文件，本轮在 Lumi 的验收测试补上合成日志解析、重复 UUID、无用量消息忽略、缓存重载与正文过滤；全部 43 来源已有夹具证据，Qwen 的缓存计数非零分支仍未专门覆盖。网关只通过模拟 HTTP 夹具，未作真实请求；默认全软件合计排除网关避免重复计量。

## 平台声明边界

| 平台 | 本轮可验证途径 | 结果 |
| --- | --- | --- |
| macOS ARM64 | 本机原生构建/签名/sidecar、隔离单测、真实 Codex | 上述已执行项目通过；原生交互仍缺 |
| macOS Intel | 仓库现有 `macos-15-intel` 构建工作流 | 本轮未执行，不能把 ARM64 结果当 Intel 结果 |
| Windows x64 | 仓库现有 `windows-2022` MSI/NSIS 与 sidecar 工作流 | 没有实机；Windows Rust 标准库未装，本轮未运行 |
| Linux | 代码含 Linux 路径与 sidecar 目标 | 没有实机、Linux Rust 标准库；Docker CLI 存在但 daemon 不可用；现有桌面打包矩阵没有 Linux，本轮未运行 |

路径/平台分支的夹具测试在 macOS 运行，属于模拟分支验证。没有创建付费环境或触发远端工作流。

## 发布风险与最小后续清单

**阻塞本轮发布验收完成：**恢复本机原生交互工具后，在同一隔离数据目录完成下列闭环；无需降低安全设置，也不能笼统要求解锁电脑。

1. 知识库点击导出 → 原生保存 → 文件存在且 JSON 全内容一致 → 退出/重开隔离 APP → 通过界面重导入 → 文档层级、Unicode、节点/边/引用、版本和提交信息核对。取消保存不得反馈成功。
2. 原生确认弹窗的标题、说明、取消/确认按钮可被 AX 读取；Tab/Shift+Tab、Escape、确认和关闭后焦点返回；再执行双击仅一任务、键盘停止、历史公开输入与私密值遮蔽。
3. 空白工作台连续隐藏超过五分钟后释放主窗口、保留同一 Core，托盘重新创建；正常自定义主页同样隐藏超过五分钟仍保留；恢复可见/弹窗/未完成编辑不得误回收。

**只限制支持声明：**Windows、Linux、Intel 的本轮实机缺口；42 个非 Codex 来源的真实样本缺口；Qwen 非零缓存分支的专门夹具缺口。无需用户为测试安装全部客户端。

**需要用户决定的历史隐私项：**是否安排停止正式 APP 后清理旧 Lumi 派生读取缓存；当前正式 APP 未替换，旧缓存未检查，不能声称修复已应用到正在运行的正式实例。

## 复现、证据与提交状态

- `pnpm check`
- `pnpm test:codeburn`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm exec vitest run packages/core/src/usage/acceptance.test.ts`
- `pnpm tauri:build --debug --bundles app --ci --config /tmp/lumi-acceptance-20261017/tauri-qa.json`
- `codesign --verify --deep --strict '<独立APP路径>'`
- `HOME=<隔离HOME> node scripts/verify-sidecars.mjs --directory '<独立APP>/Contents/MacOS'`

本机 pnpm 入口未在默认 PATH，使用既有本地 pnpm 11.19.0 和 standalone Node 26.10.0；没有为此安装或更改系统工具。

[机器可读结果](summary.json) · [证据哈希](evidence/sha256.json) · [完整检查日志](evidence/check.log) · [修复前失败](evidence/privacy-before.log) · [修复后新进程回归](evidence/privacy-after.log) · [真实 Codex 通过标记](evidence/real-codex.json) · [仅本轮增量补丁](repair-only.patch)

**没有创建本地提交。**修复改动已按开工时的文件哈希安全分离，但依赖仍未提交的 CodeBurn 接入文件；单独提交不能形成可独立构建的 HEAD，全量提交又会混入其他任务。因此保留工作树与仅本轮补丁供审阅。没有推送、PR、合并、发布或部署。中途向来源会话回传状态的工具返回 `thread not found`；本报告由平台在回合结束时通知父会话。
