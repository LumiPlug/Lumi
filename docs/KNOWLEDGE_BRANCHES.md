<!-- SPDX-License-Identifier: MPL-2.0 -->

# 项目分支知识库

## 产品规则（2026-10-07）

Lumi 只存储生成知识及其来源元数据，提供 MCP 写入、版本管理、检索和读取。不访问项目目录或 Git，不提供来源扫描、目录授权、来源正文读取或“检查来源变化”。外部 AI 在自身已有的项目访问范围内读取项目、取得 Git 元信息，并提交知识。

唯一分组键为 `(projectKey, branch)`。`projectKey` 是调用方提供的稳定项目标识，同项目 worktree 必须一致；不同项目不可复用。Git 项目提交实际分支名；无 Git 项目固定为 `main`。每个分组独立维护 `v1, v2, …`、构建锁、历史版本和归档状态。列表按项目＋分支卡片展示，详情可通过共用 Select 切换同项目分支。

每个知识版本绑定 `commitSha`，Git 支持完整 40/64 位小写 SHA。无 Git 为 null；未产生提交的 Git 项目也可为 null，明确无法使用 SHA 判定更新。切换历史版本时显示该版本的 SHA，不混用当前最新知识的 SHA。

`compare(kbId, latestCommitSha)` 对比已发布知识 SHA 与外部 AI 刚取得的该分支 HEAD：相等为 `current`，不同为 `update_required`，无版本为 `unpublished`，SHA 缺失为 `unknown`，无 Git 为 `no_git`。不同 SHA 不证明提交先后或差异范围；AI 自行使用 Git diff 得到变化并组织增量更新。此对比不检测未提交改动，不访问 Git、不自动生成版本，也不声称已核实调用方的 Git 信息。

## MCP v3

1. `get_contract` 读取结构、限额和工作流。
2. `create(projectKey, name, git, branch?, description?)` 幂等创建或定位分组，返回 kbId；Git 必须提供分支，无 Git 默认 main。
3. `list(projectKey?, branch?, query?)` 定位分组；`compare(kbId, latestCommitSha)` 判断提交是否不同。
4. `prepare_build(kbId)` 获取恢复凭证；`begin_build(kbId, commitSha, expectedRevision, mode, requestKey, resumeToken)` 固定目标提交。增量只能继承这个分组的当前版本。
5. `write_batch` 按序提交文档、节点、关系、引用和显式删除；重复批次幂等。
6. `validate_build` 校验 Schema、目录无环、图谱端点及引用完整性。引用记录相对路径、文件哈希、行号和片段哈希；不保存或核对原文、不证明语义正确。
7. `publish_build` 提交外部 AI 再次取得的 `latestCommitSha`，必须与构建目标相等；expectedRevision/expectedSeq/validationId 防止覆盖或发布错批次。同一事务发布知识、SHA 与索引。
8. `read/search/graph` 固定 kbId 和 revision；历史知识可读，不依赖原项目目录。

导入导出只支持 v3。导入同项目同分支形成一个新知识版本，不覆盖历史；导入其他分支写入独立分组。恢复历史内容也形成新版本并保留该内容原来的 SHA。

## 数据与验证

迁移 8 清空旧知识库及构建、来源记录和索引，不迁移旧语义；用户已明确确认清空原有三个知识库。其他工具、Skills 和工作台数据不变。原项目文件不受影响。执行 secure_delete、VACUUM 和 WAL 截断，不保留旧知识的兼容代码或旧导入格式。

测试需覆盖同项目不同分支、同分支不同项目、无 Git main、分支独立版本、增量隔离、历史 SHA、提交对比、发布提交冲突、重试/恢复、严格 v3 导入及不存在来源访问接口。UI 复用既有组件，验证长分支名、窄窗口、键盘、无授权/扫描按钮及真实 Core/MCP 闭环。

验证完成：`pnpm check` 通过 19 个测试文件、149 个测试，以及 TypeScript、ESLint、Rust fmt/check/clippy。真实 Core/SQLite＋官方 MCP 客户端浏览器联调覆盖分组、独立版本、历史 SHA、无来源访问接口、引用元数据、无 Git main、创建校验、检索、长分支名和 1440/900/390px 布局；报告见 `.impeccable/review/knowledge-branches/report.json`。测试数据仅在临时实例生成，不写入用户 Lumi。
