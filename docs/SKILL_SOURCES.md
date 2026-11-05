<!-- SPDX-License-Identifier: MPL-2.0 -->

# Skills 来源核查与扫描范围

2026-10-19：对照 47 个 AI 用量来源核查本地 Agent Skills。扫描只读取目录中的 `SKILL.md` 及元信息，不运行脚本、不安装技能、不修改目标软件配置。来源标签表示该软件支持的候选目录，不表示软件已安装、当前已启用技能或已授予执行权限。共享目录可同时属于多款软件。

实现范围为 44 个默认软件分类，加上有显式数据根时才启用的 Open Design，共45个分类。其中原47个用量来源对应44个可扫描来源（Cursor Agent 与 Cursor 共用分类），另补充用户要求的豆包桌面版和Reasonix；其余3个用量来源的原因见文末。软件分类仅在发现技能时出现在现有筛选栏中。新增Skills来源不自动代表新增用量采集适配。

## 实施边界

- 保留原六款来源及 Codex、Claude 的插件缓存扫描；新增来源仅接入有文档或源码依据的目录。
- 只扫描当前用户和已经添加的项目。项目不自动向父目录扩展，不遍历整个主目录或软件数据目录。
- 同一路径的多个来源共用一次目录扫描；同一真实 `SKILL.md` 合并来源，同名不同文件保留。不模拟各软件按名称覆盖、信任或启停规则。
- 继续保留深度 9、全轮 12000 个目录、单文件 256 KiB、链接边界检查与错误保留历史的机制。
- Quick Desktop 仅枚举 `profiles` 的直接普通子目录，再进入其 `skills`；最多检查 64 个 profile 目录项，超限报告错误。不读取登录配置、会话或凭据。
- 仅适配目录形式的 `SKILL.md`。平铺 Markdown、插件清单指定的任意路径、配置文件里的额外目录、远程目录和软件内置资源包未全面覆盖。无标准元信息的文件仍按已有规则标记无效，不把普通规则文件当成 Skills。
- 环境变量覆盖仅在 Lumi 进程收到相应变量时生效；不读取或修改 shell、登录环境和其他软件设置。

## 已有来源

Codex、Claude Code、Cursor、Gemini CLI、Qoder、QoderWork。Codex 的 `CODEX_HOME` 与 Claude 的 `CLAUDE_CONFIG_DIR` 保留；其余路径以扫描注册表为准。

## 新来源与核查依据

下表列出主要专属或共享目录；完整兼容目录、环境变量及平台分支见 `packages/core/src/skills/roots.ts`。`~` 表示当前用户，`config` 表示有效的绝对 `XDG_CONFIG_HOME`（默认 `~/.config`）。

| 软件／用量来源 | 本次范围 | 依据 |
| --- | --- | --- |
| Cline / Cline CLI | `~/.cline/skills`；项目 `.cline/skills`、`.clinerules/skills`、`.claude/skills` | [Cline 官方 Skills](https://docs.cline.bot/customization/skills) |
| CodeWhale | `~/.codewhale/skills`，以及文档声明的兼容目录；项目 `.codewhale/skills` | [官方源码文档](https://github.com/codewhale-hq/Codewhale/blob/main/docs/SKILLS.md) |
| Codebuff | 用户和项目 `.agents/skills`、`.claude/skills` | [官方 Skills](https://www.codebuff.com/docs/tips/skills) |
| Copilot | `~/.copilot/skills`、`~/.agents/skills`；项目 `.github/skills` 等 | [GitHub 官方说明](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) |
| Devin | `config/devin/skills`、`~/.agents/skills`；项目 `.devin/skills`、`.windsurf/skills`、`.agents/skills` | [官方 CLI 文档](https://docs.devin.ai/cli/extensibility/skills/overview) |
| Droid | 用户与项目 `.factory/skills`、`.agents/skills` | [Factory 官方 Skills](https://docs.factory.com/harness/skills) |
| DeepSeek Harness | `$DSH_HOME/skills`、`$DSH_AGENTS_HOME/skills`；项目 `.dsh/skills`、`.agents/skills` | [官方 filesystem provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md) |
| Hermes Agent | `$HERMES_HOME/skills`，默认 `~/.hermes/skills` | [官方 Skills 工具源码](https://github.com/NousResearch/hermes-agent/blob/main/tools/skills_tool.py) |
| IBM Bob | 用户与项目 `.bob/skills` | [官方 Skills](https://bob.ibm.com/docs/ide/features/skills) |
| KiloCode | 用户与项目 `.kilo/skills`、`.agents/skills` | [官方 Skills](https://kilo.ai/docs/customize/skills) |
| Kiro | 用户与项目 `.kiro/skills` | [官方 Skills](https://kiro.dev/docs/cli/skills/) |
| Kimi | `~/.kimi/skills` 与通用兼容目录；项目 `.kimi/skills` | [kimi-cli 官方源码文档](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/skills.md) |
| Kimi Code | `$KIMI_CODE_HOME/skills`（默认 `~/.kimi-code/skills`）、`~/.agents/skills`；项目 `.kimi-code/skills`、`.agents/skills` | [官方 Kimi Code 文档](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) |
| LingTai TUI | 仅默认的 `~/.lingtai-tui/utilities`；每代理配置及项目库未自动解析 | [官方默认路径迁移源码](https://github.com/Lingtai-AI/lingtai/blob/main/tui/internal/migrate/m037_preset_skills_paths.go) |
| Mistral Vibe | `$VIBE_HOME/skills`（默认 `~/.vibe/skills`）；项目 `.vibe/skills`、`.agents/skills` | [官方 CLI Skills](https://docs.mistral.ai/vibe/code/cli/skills) |
| Mux | 用户与项目 `.xum/skills`、`.mux/skills`、`.agents/skills`；保留兼容目录 | [官方源码文档，当前已使用 Xum 名称](https://github.com/coder/mux/blob/main/docs/agents/agent-skills.mdx) |
| OpenClaw | `~/.openclaw/skills`、默认 workspace 的 `skills`；已添加项目的 `skills` | [官方 Skills](https://docs.openclaw.ai/tools/skills)；[创建技能](https://docs.openclaw.ai/tools/creating-skills) |
| OpenClaude | `~/.openclaude/skills`、`~/.agents/skills`；项目 `.openclaude/skills` | [官方源码文档](https://github.com/Gitlawb/openclaude/blob/main/docs/skills.md) |
| Open Design | 仅显式绝对 `OD_DATA_DIR/user-skills`；不猜不同发行通道的命名空间目录 | [官方 Skills 源码](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/skills.ts)及其数据根契约 |
| Pi | `~/.pi/agent/skills`、`~/.agents/skills`；项目 `.pi/skills`、`.agents/skills` | [官方文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md) |
| OMP | `~/.omp/agent/skills`、`managed-skills`；项目 `.omp/skills`及默认项目兼容目录 | [官方文档](https://github.com/can1357/oh-my-pi/blob/main/docs/skills.md) |
| Qwen | 用户与项目 `.qwen/skills` | [Qwen Code 官方 Skills](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/) |
| Quick Desktop | `$QUICKWORK_HOME/profiles/*/skills`，默认 `~/.quickwork` | [AWS 官方示例的手动安装说明](https://github.com/aws-samples/sample-aidlc-skill-for-amazon-quick) |
| Grok Build | `$GROK_HOME/skills`（默认 `~/.grok/skills`）；项目 `.grok/skills` | [官方 Skills](https://docs.x.ai/build/features/skills-plugins-marketplaces) |
| Amp | `config/agents/skills`、`~/.agents/skills`及 Claude 兼容目录；项目 `.agents/skills`等 | [官方 Skills](https://ampcode.com/docs/customize/skills) |
| Command Code | 用户与项目 `.commandcode/skills` | [官方 Skills](https://commandcode.ai/docs/skills) |
| Antigravity | `~/.gemini/config/skills`及历史 `~/.gemini/antigravity/skills`；项目 `.agents/skills`、`.agent/skills` | [Google 官方 Skills](https://antigravity.google/docs/skills?app=antigravity-ide)；历史目录交叉参考 [Skills 安装器注册表](https://github.com/vercel-labs/skills/blob/main/src/agents.ts) |
| Forge | `~/forge/skills`、`~/.agents/skills`；项目 `.forge/skills` | [官方 Skills](https://forgecode.dev/docs/skills/) |
| Goose | `~/.agents/skills`、平台配置目录的 `goose/skills`等；项目 `.goose/skills`、`.agents/skills`等 | [官方源码文档](https://github.com/block/goose/blob/main/documentation/docs/guides/context-engineering/using-skills.md) |
| OpenCode | `config/opencode/skills`、共享目录；项目 `.opencode/skills`等 | [官方 Skills](https://opencode.ai/docs/skills/) |
| Cursor Agent | 复用 Cursor 的目录归属，统一显示 Cursor，不制造同一产品的重复分类 | Cursor 产品系列的同一套 Skills，参见 [官方 Skills](https://cursor.com/docs/context/skills) |
| Crush | `config/crush/skills`、`config/agents/skills`、`CRUSH_SKILLS_DIR`及共享目录；Windows 补充 LocalAppData | [官方 README](https://github.com/charmbracelet/crush/blob/main/README.md#agent-skills) |
| Warp | 用户与项目 `.agents`、`.warp`、`.claude`等官方兼容目录下的 `skills` | [官方 Skills](https://docs.warp.dev/agents/capabilities/skills) |
| ZCode | 用户与项目 `.zcode/skills` | [官方 Skills](https://www.zcode.network/en/docs/skill/) |
| Zed | 用户与项目 `.agents/skills` | [官方 Skills](https://zed.dev/docs/ai/skills) |
| WorkBuddy | `~/.workbuddy/skills`；个人候选目录，由官方发行代码的配置根与 Skills 子目录逻辑推导，未完成目标客户端实机核验 | [腾讯官方技能能力说明](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)；[官方发布包2.169.0元数据](https://registry.npmjs.org/@tencent-ai/codebuddy-code/2.169.0) |
| 千问办公 | `~/.qwenworkcn/skills`；仅个人目录 | [官方 Skills](https://docs.qwenwork.cn/features/skills) |
| 豆包桌面版（不在原用量来源表） | `~/Doubao/skills` 个人候选目录，或 Lumi 专用的绝对 `LUMI_DOUBAO_SKILLS_DIR` 指向的技能根；无项目约定 | [豆包开放平台的Skill能力](https://open.doubao.com/)；[SkillBuddy作者的macOS实测目录记录](https://github.com/konnga/skill-buddy/blob/main/docs/platform-conventions.md)。具体路径依据是作者的一手实测，不是豆包官方路径承诺；Windows/Linux及自定义工作目录未作实机核验。 |
| Reasonix（不在原用量来源表） | Unix默认 `~/.reasonix/skills`；Windows默认 `%APPDATA%/reasonix/skills`；项目 `.reasonix`、`.agents`、`.agent`、`.claude` 下的 `skills`；非隔离模式另读用户同名兼容目录 | [官方内置Skills说明](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/internal/skill/builtincontent/reasonix-guide/references/skills.md)；[官方目录解析](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/internal/config/paths.go) |

### 豆包桌面版与Reasonix补充（2026-10-19）

豆包只进入候选技能根，不扫描整个工作目录、Electron数据目录或内置`.skills`，也不把社区Doubao-TUI的`~/.doubao/skills`当成官方桌面路径。用户自定义工作目录时，可将`LUMI_DOUBAO_SKILLS_DIR`设为完整的实际Skills目录；该变量属于Lumi，不是豆包自身配置。非空绝对路径替换默认候选；相对值忽略，缺失目录沿用missing状态。没有本机豆包安装及默认技能目录的实机验证，不声称覆盖云端技能或所有桌面版本。

Reasonix按官方`REASONIX_HOME`隔离语义接入：有效绝对覆盖只扫描其`skills`，不回退系统用户的`.reasonix/.agents/.agent/.claude`目录；已添加项目的标准目录仍参与。未设置覆盖时按平台默认根及官方兼容目录扫描。仅扫描目录形式的`SKILL.md`，配置自定义paths、插件清单及平铺Markdown仍在既有未覆盖范围内。

## 未加入的来源

| 来源 | 核查结论 |
| --- | --- |
| Zerostack | [官方 README](https://github.com/gi-dellav/zerostack)描述 prompts/指令机制，未核实标准 `SKILL.md` 自动发现目录；不将 prompts 当作 Skills。 |
| Grok Bot | 与 Grok Build 是不同产品；未核实本地可枚举的标准 Skills 存储，不把 Build 路径套给 Bot。 |
| Vercel AI Gateway | 用量网关，没有对应的本地客户端 Skills 目录。 |

## 验证

WorkBuddy 路径补充依据：仅静态查看腾讯发布的 `@tencent-ai/codebuddy-code@2.169.0` 中 `dist/codebuddy-headless.js`：`getWorkbuddyConfigDir` 的默认根为 `~/.workbuddy`，`PathUtils.getHomeSkillsDir` 在宿主配置根下取 `skills`，用户 Skills 扫描调用该方法。由此保留上述候选路径；这不证明所有 WorkBuddy 发行版本都采用相同宿主配置，也不据此扫描其连接器、市场或其他数据目录。未安装或执行该包，未复制其代码。

最终包含豆包/Reasonix的 `CI=1 pnpm check` 通过：51个测试文件、408项测试，以及主页契约、TypeScript、ESLint、Rust fmt/check/clippy。首轮新增5项合成目录回归覆盖新增专属目录与项目目录、共享来源、同名保留、环境变量与Windows目录分支、共享根只读一次及错误传播、Quick的普通profile/技能根链接拒绝/会话目录排除/归档保留/64项边界；两款追加2项见文末。原有扫描、托管导入及文件读取回归全部通过。

一次并行重跑中既有工具后台日志用例等待超时；未修改该用例或超时阈值，清理本轮资料检查进程后，使用已有的 CI 单 worker 配置完整重跑通过。

首轮未运行用户技能脚本、未扫描用户真实技能库，未重启或替换正式应用，未提交/推送/发布。各厂商版本、平台与原生客户端加载未逐一实机核验；验证证明目录发现与Lumi既有业务链路，不证明目标软件实际启用了这些技能。

豆包/Reasonix追加验证：新增2项合成目录回归，覆盖豆包默认候选、自定义绝对路径替换、相对值忽略、缺失目录、TUI/内置/项目目录排除，以及Reasonix的个人/项目兼容目录、隔离不回退和Windows默认根。本机只读扫描`~/.reasonix/skills`发现12个技能，元信息均有效、无扫描错误；只输出计数，未执行技能、修改源目录或正式账本。豆包本机未安装，候选目录不存在，不能据此宣称实机验收。
