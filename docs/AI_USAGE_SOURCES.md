<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 自有 AI 用量来源

## Qoder 桌面 JSONL 修复（2026-10-19，尚未发布）

新增 `~/.qoder/projects/**/*.jsonl`，与下表旧 IDE SQLite 一起归入 `qoder`；不影响独立的 `qoderwork` 路径。依据用户确认的国际独立桌面版 0.4.8 f8c98a 字段结构实现，不代表其他地区或版本已验收；公司机新桌面对话是否实时写入该位置仍待人工确认。不扫描公司电脑或其他用户目录，不读取凭据。

- 只计 `type=assistant`（message.role 若存在也须为 assistant）。必须有显式 sessionId/session_id，及 message.id（兼容顶层 uuid/id）；缺少稳定身份直接跳过，不用文件位置或正文猜测。模型优先 message.model，兼容顶层 model；不猜测 Auto 背后的模型。
- message.usage 的 input_tokens、output_tokens、cache_read_input_tokens、cache_creation_input_tokens 分别映射独立分项，输入不扣除缓存；总量为四项之和，缺项则未知（存在有效 total_tokens 时可回退）。非负安全整数才有效；缺失/非法值保持 null，全零或全缺失标记 missing_usage。Credits 不保存，不换算 Token 或费用，也不自动设置记录开关。
- timestamp 支持 ISO 字符串、秒/毫秒整数及其数字字符串；坏时间与无稳定身份的事件不入账。坏行隔离，完整换行后才读取；沿用现有安全发现、只读、缓存、资源上限和 upsert。重复扫描、跨文件复制和流式快照按会话/消息哈希合并，完整/较大快照优先，轮转/清理/重启不清除已入账记录。
- 时间单位的确切规则：正的安全整数（或纯十进制数字字符串）小于 10^12 时按秒乘1000，大于等于 10^12 时按毫秒；非整数、非正数、超安全范围及无效 Date 拒绝。字符串日期须以 YYYY-MM-DDT 开始，交给 Date 解析；缺少时区的 ISO 字符串使用进程本地时区。该数量级规则面向现代记录，不能无歧义解释2001-09-09之前的毫秒值，不声称支持所有历史年代或本地化日期格式。
- 当前自有用量链路没有模型单价、费用字段或价格表查询；模型仅保留来源标识，不把 Auto 路由标签当实际供应商模型，也不根据 Credits 推算费用。本适配不会新增模型价格误算，但未知模型与未知实际路由仍是计数元数据的局限。
- 两种格式保留独立账本，仅显式会话/稳定请求身份的哈希完全匹配时选择更完整记录；完整度相同优先 JSONL。SQLite rowid/数字 ID/无来源证据的旧记录不用于跨格式核对；未匹配记录全部保留，早期 SQLite 和后期 JSONL 可在同会话累加，不整会话排除。不同 ID 不按时间或 Token 猜测相同。核对依据完整持久账本，日期/模型筛选、删除源文件及重启不改变选择；查询、会话与 CSV 一致。同会话仍有未匹配的两种格式时，来源 problems=identity_unverified，并通过既有顶部气泡提醒可能重复；这不是完全去重保证。
- 两个根合并来源状态，旧 SQLite 不存在不会隐藏成功的 JSONL。UI 布局和诊断入口保持不变。本次使用人工样例测试，不读取真实会话；不改 vendor 或 codeburn 测试文件。

协议参考：[vibe-usage Qoder parser](https://github.com/vibe-cafe/vibe-usage/blob/main/src/parsers/qoder.js) 的 JSONL 字段与缓存分项思路；实现独立编写，不安装或运行其采集器。Lumi 保留独立缓存创建分项，不照搬其输入合并或无身份位置回退。

2026-10-18：Qoder、QoderWork、WorkBuddy、千问办公补充固定版本 CodeBurn 的来源注册表。实现位于 `packages/core/src/usage/collector.ts`、`native.ts`、`native-adapters.ts`；不存在软件独立进程、数据库或第二套查询接口。千问办公使用 `qwenwork`，与原有 Qwen 编程工具 `qwen` 分开。

## 数据流

标准本地目录 → 有界只读采集 → UsageRecord → 现有 UsageService/SQLite 请求账本 → 宿主 `/app/usage` → 指标、图表、排行、会话汇总、二级明细与 CSV。

四个来源优先于上游来源扫描，防止慢来源阻塞首次发现。每分钟或手动刷新采集，复用现有暂停、取消及宿主鉴权；前端不访问本地文件，不扩大 MCP 权限。软件标识、显示名与现有组件由共享注册表驱动，不改变 UI 布局或视觉体系。

## 来源与口径

| 来源 | macOS 标准位置 | 计量与去重 |
| --- | --- | --- |
| Qoder IDE | `~/Library/Application Support/Qoder/SharedClientCache/cache/db/local.db` | `chat_message` 的 assistant 行，读取 `token_info`；以会话和 message_id/id/uuid（旧 schema 退回 rowid）生成哈希请求 ID；输入扣除 cached_tokens，总计为 prompt_tokens + completion_tokens。可选 chat_session.session_title 只作为名称。 |
| QoderWork | `~/.qoderwork/projects/**/*.jsonl`，包含子代理目录 | assistant 的 message.usage；以会话和 message.id 去重，uuid/id 兼容；输入不含缓存，总计为输入、输出、缓存读取和缓存写入之和。 |
| WorkBuddy | `~/.workbuddy/projects/**/*.jsonl` | providerData.rawUsage，兼容旧 message/assistant 与当前 function_call；优先 providerData.messageId 去重，同一 conversationRequestId 内仍可有多个独立模型请求。缓存读取优先 prompt_cache_hit_tokens，总计为 prompt_tokens + completion_tokens；thinking 是输出子集，不额外加。 |
| 千问办公 | `~/.qwenworkcn/logs/sessions/**/segments/*.jsonl` | 只统计 model.response.completed，按会话和 request_id 去重；忽略 turn.finished 汇总、其他诊断目录和 agents.db 上下文占用。input_tokens 已含缓存读取，归一化后扣除该子集；cache_creation_input_tokens 按实际值读取并另计。 |

Qoder 旧 SQLite 的 Windows/Linux 用户数据根分别使用 `~/AppData/Roaming/Qoder`、`~/.config/Qoder`；桌面 JSONL 及其他来源使用用户主目录下对应隐藏目录。当前只有 macOS WorkBuddy 真实数据验证，其他平台和客户端版本不能视为实机验收。Qoder 覆盖上述 IDE SQLite 与桌面 JSONL，不将共享 JSONL 路径视为独立 CLI 版本的实机验收；旧 QoderWork main.log 的非结构化历史不自动猜测补算。

数值必须是非负安全整数。缺失分项保持 null；已知总计不因缺失缓存拆分而被抹掉。输入含缓存但无法拆分时保留 inputIncludesCache=true；混合汇总语义为未知。Credits、余额、上下文快照和正文长度不转换为 Token。模型使用来源标识，不猜测 Auto 背后的实际模型。

## 目标软件的记录开关

社区实现观测到部分 QoderWork 和千问办公版本默认将 Token 字段写为全零或省略：

- QoderWork：目标软件启动环境中的 `QODER_EXPOSE_TOKEN_USAGE=1`。
- 千问办公：目标软件启动环境中的 `QODERCN_EXPOSE_TOKEN_USAGE=1`。

这些是版本相关的社区观测，不是厂商稳定公开 API。用户需要在自己启动目标软件的环境中设置，并完全退出后重新打开目标软件；macOS GUI 启动不保证继承当前终端环境，不能只在 Lumi 进程设置。若使用终端启动，可在目标可执行程序前加相应的环境变量，并核查后续日志确实产生非零字段。Lumi 不自动修改 shell 启动文件、launchctl 环境或目标应用配置。开关只可能影响后续请求，缺失的历史不能恢复。

有真实请求身份但缺失/全零的事件保留为 quality=missing、计数为 null，并在来源状态标记 missing_usage。该状态表示数据不可计量，不代表用户确实消耗零 Token；已有的正常请求记录不会被后续零占位覆盖。

## 存储、异常与边界

- 仅持久化归一化计数、时间、模型、显式会话名称和哈希标识；忽略聊天正文、工具参数、凭据、Credits 等原始对象。内存文件缓存同样只包含归一化记录和显式名称。
- SQLite 使用 readOnly/query_only 和短 busy timeout；缓存感知主库/WAL 的 inode、大小和时间，拒绝主路径及 WAL/SHM 符号链接。不用 immutable 绕过 WAL，不 checkpoint、不改源库。
- JSONL 只解析完整换行记录，尾行待下次重试；格式损坏隔离到单行，其他已解析请求仍能入账。文件按元数据缓存，变化后有界重读。每文件最多64 MiB、单轮未缓存文件最多128 MiB、每来源最多10万请求；发现复用现有限制（2万文件/目录、深度5），内存缓存按10万条记录/名称预算淘汰，超限明确标记 limit。
- 与上游完整快照替换不同，自有来源按请求 upsert，重复扫描、跨文件重放和流式快照不叠加。原日志轮转或清理不删除已采集请求；缺失或权限异常不清空历史。整个来源消失后，沿用现有 detectedOnly 过滤行为，数据库仍保留历史，非 detectedOnly 查询可访问。
- 不修改固定 vendor。现有 CodeBurn 的事务对账、缓存和来源行为保持原样；自有记录通过显式 persistence=upsert 进入同一个事务提交点。

## 协议研究来源

实现独立编写，仅参考字段和数据协议，没有复制第三方实现代码。

- [Qoder 官方 SDK：Credits 与 context usage](https://docs.qoder.com/cli/sdk/cost-usage)，两者不等于逐请求 Token 账本。
- [usageBar Qoder IDE 数据库实现](https://github.com/ChanningYuan/usageBar/blob/66a5bbe8cde059dd80d9ef9bf1c38f503ae2b89f/app/Sources/usageBarProviders/QoderIdeProvider.swift)。
- [usageBar 历史 QoderWork transcript 实现](https://github.com/ChanningYuan/usageBar/blob/v0.3.32/app/Sources/usageBarProviders/QoderWorkProvider.swift)。
- [usageBar WorkBuddy 字段实现](https://github.com/ChanningYuan/usageBar/blob/66a5bbe8cde059dd80d9ef9bf1c38f503ae2b89f/app/Sources/usageBarProviders/WorkBuddyDetailScanner.swift)；当前 function_call 格式额外通过本机只读样本验证。
- [usageBar 千问办公 segment 实现](https://github.com/ChanningYuan/usageBar/blob/66a5bbe8cde059dd80d9ef9bf1c38f503ae2b89f/app/Sources/usageBarProviders/QwenWorkProvider.swift)。

## 验证结果（2026-10-18）

2026-10-19 最终按请求策略验证（未发布）：分支 fix/qoder-desktop-jsonl；系统临时目录19项无隐私样例测试通过，覆盖同会话早期仅 SQLite/后期 JSONL、精确重复、相同时间和计数的不同请求、无 ID、rowid 与同值消息 ID 不误合并、无来源证据的旧账本、按完整度选择、源删除/重启、筛选/会话/CSV 一致性以及原14项字段与读取边界。完整 pnpm check 重新通过（49文件/400测试、类型、lint、Rust fmt/check/clippy），Core 和前端构建通过；前端有既有大 chunk 提示。实际变更为原8文件加 UsagePage.tsx、UI_BASELINE.md、UI_DESIGN.md 共11文件，新增部分仅复用现有气泡，无布局变化。仓库测试与 vendor 未改，未提交/推送/发布；未读取真实聊天、凭据或正式账本。公司机实时写入、实际采集和原生气泡仍待人工验收，未生成本次原生安装包。


完整 `pnpm check` 通过（48文件、394测试），前端与 macOS debug 应用包构建通过；前端保留现有大 chunk 提示。新增11项测试覆盖47来源注册表、四源统一汇总/模型/会话/详情/CSV、缓存子集、零占位、跨文件和流式去重、轮转/删除/重启保留、未完成尾行、坏行隔离、WAL更新、无效数据库、符号链接、暂停/取消、原始正文不持久化及原生/上游混合缓存语义。

真实 WorkBuddy 只读数据通过同一个 UsageService 在隔离内存数据库验证：1文件、20请求、1会话，总计1,430,239 Token（净输入100,397、输出38,706、缓存读取1,291,136、缓存写入0）；重复扫描不翻倍，会话与详情合计一致，来源无错误。Qoder、QoderWork、千问办公本机没有数据目录，分别显示 absent，仅完成合成协议及集成验证。没有修改这些软件的环境配置，没有重启当前运行的 Lumi 实例或直接写入正式用量数据库。
