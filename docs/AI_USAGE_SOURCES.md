<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 自有 AI 用量来源

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

Qoder 的 Windows/Linux 用户数据根分别使用 `~/AppData/Roaming/Qoder`、`~/.config/Qoder`；其他来源使用用户主目录下对应隐藏目录。当前只有 macOS WorkBuddy 真实数据验证，其他平台和客户端版本不能视为实机验收。当前 Qoder 指 IDE，不额外包含 Qoder CLI；旧 QoderWork main.log 的非结构化历史不自动猜测补算。

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

完整 `pnpm check` 通过（48文件、394测试），前端与 macOS debug 应用包构建通过；前端保留现有大 chunk 提示。新增11项测试覆盖47来源注册表、四源统一汇总/模型/会话/详情/CSV、缓存子集、零占位、跨文件和流式去重、轮转/删除/重启保留、未完成尾行、坏行隔离、WAL更新、无效数据库、符号链接、暂停/取消、原始正文不持久化及原生/上游混合缓存语义。

真实 WorkBuddy 只读数据通过同一个 UsageService 在隔离内存数据库验证：1文件、20请求、1会话，总计1,430,239 Token（净输入100,397、输出38,706、缓存读取1,291,136、缓存写入0）；重复扫描不翻倍，会话与详情合计一致，来源无错误。Qoder、QoderWork、千问办公本机没有数据目录，分别显示 absent，仅完成合成协议及集成验证。没有修改这些软件的环境配置，没有重启当前运行的 Lumi 实例或直接写入正式用量数据库。
