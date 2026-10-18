<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 当前 UI 基线与开发约束

2026-10-18 排行同步补充：软件排行与模型明细中，Token 数字、百分比、条宽共用同一动画帧/进度；未知不补0，K/M与估算前缀保持，减少动态效果和隐藏时同步呈现最终值。

2026-10-18 分类计数：Skills 的全部来源、Lumi 托管、各软件来源与已归档，以及知识库的全部、待处理与已归档 Tab 均通过共用 Tabs 的 `count` 显示分类总数（含 0），不受搜索关键词影响。来源按技能记录去重，一条多来源技能可分别计入对应来源；全部来源仅含未归档且仍存在的技能，Lumi 托管按 managed 判定；知识库全部排除归档，待处理沿用有构建或尚无发布版本的条件。数量随列表数据更新，辅助技术名称包含数量与单位。

2026-10-18 用户确认的数据动效扩展：AI 用量的指标数字、趋势柱、软件/模型排行进度条采用共用900ms数据变化过渡，静态数据不重播，快速更新接续当前状态；未知直接切换、减少动态效果或窗口隐藏时直接落位。通过 UI组件预览中的更新合成数据入口验收，业务仅传数据和开关，不另写动画样式。

核对日期：2026-10-18。代码快照：`93f7758`（0.1.2）；核对开始时受跟踪文件无未提交改动，已有未跟踪 `reports/` 未纳入、未修改。本文件总结当前实现，防止后续生成 UI 时重新选择布局和样式，不是新一轮设计方案。

## 1. 使用顺序与修改边界

- **新增 UI 默认严格沿用本基线；只有用户主动要求修改，才可改变既定布局、样式和交互。** “新增功能”“优化代码”“修复问题”本身不授权重设计。保留本次任务之外的用户改动。
- 先读本文件，再读 [UI_DESIGN.md](UI_DESIGN.md) 的对应现行要求与 [UI_COMPONENTS.md](UI_COMPONENTS.md) 的组件接口。旧文档按日期积累了多轮方案；不能因为某段仍写着“当前方案”，就恢复已被后续实现取代的布局。已知差异见第 10 节，未解决差异不能自动归为用户认可的新标准。
- 实际尺寸和状态以本文标明的代码来源为依据；若后续代码与本基线冲突，先说明具体差异，不能以“代码已有”或“统一风格”为由静默改写基线。用户新要求优先，确认的改变应同步更新本文件及相关规范。
- 首页工作台内容及其构建模板沿用项目既有组件复用例外；其余新增或修改 UI 必须使用 [ui/index.ts](../src/components/ui/index.ts) 导出的共用组件。业务只安排数据、文案、图标、回调、状态及必要布局，不覆盖同用途控件的颜色、圆角、阴影、焦点或动效。
- 新需求未被覆盖时，先组合最相近的现有组件与业务模式。无法兼容时，列出“现有组件／缺少的能力／拟改变的具体表现／影响页面”，向用户确认；确认前不新增视觉组件、效果、临时皮肤或替代页面。确认后先在共用组件及开发态“设置 → UI组件”实现，再接入业务，并同步 [UI_COMPONENTS.md](UI_COMPONENTS.md) 和 [UI_DESIGN.md](UI_DESIGN.md)。
- [DESIGN.md](DESIGN.md) 是保留的品牌原文，不改写；其中色板前言、微字号、字阶等不能直接替代当前主题 token。本基线不引入新的色板、间距体系或组件库。

## 2. 证据等级与本次核验范围

本文件中的“现有行为”均指代码静态核对，除下述历史图片外，不表示本次实际运行或截图验收通过。

| 证据 | 本次结果及限制 |
| --- | --- |
| 仓库指引 | 已读根 [AGENTS.md](../AGENTS.md)、[CONTRIBUTING.md](../CONTRIBUTING.md)、UI 设计、组件、工具和卡片相关文档；本项目仅发现根 AGENTS.md |
| 主题与组件 | 已核对主题两文件、全局壳、共用控件、表单、弹层、提示、数据面板、分页、日志及实际调用处 |
| 业务页面 | 核对工具配置／运行、Skills、知识库、设置、AI 用量看板／会话列表／二级详情及返回代码 |
| 原生运行实例／截图 | 尝试通过原生应用清单读取，工具返回 Mac 锁定且自动解锁失败，未取得 Lumi 窗口或新截图；未尝试解锁或改权限 |
| 浏览器运行实例 | 可用浏览器清单中无 Lumi 页面；本地 1420 端口未发现监听。未启动、构建或安装新的实例，未用模拟页面代替产品验收 |
| 仓库图片 | 查看了 [office-empty.png](qa/2026-10-17-workbench-presets/office-empty.png)，它带“隔离预览”栏，仅作 2026-10-17 工作台空态历史参考，不能证明本次原生壳、双主题或其他页面通过验收 |
| 测试 | 本次只改文档，没有运行产品测试或 `pnpm check`，未改动、删除或暂存任何测试文件；第 11 节是后续适用验收清单，不是已通过结果 |

## 3. 主题、文字与基础尺寸

所有值均来自 [obsidian-solar-amber.css](../src/theme/obsidian-solar-amber.css) 与 [palette.css](../src/theme/palette.css)。使用语义变量，不把下表颜色再次硬编码到业务页面。

### 3.1 当前双主题映射

| 语义变量 | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#16161B` | `#F8F9FA` | 应用外壳背景 |
| `--content-card` | `#0E0E11` | `#F8F9FA` | 主内容背景 |
| `--panel` | `#1E1E26` | `#FFFFFF` | 弹层、独立运行窗口表面 |
| `--input` | `#1C1C23` | `#F1F3F5` | 输入、日志和凹槽 |
| `--lumi-card-bg` | `--input` | `#FFFFFF` | Card |
| `--lumi-dashboard-surface` | `--bg` | `#FFFFFF` | 数据面板、指标卡 |
| `--hover` | `#24242D` | `#F4F4F6` | 悬停表面 |
| `--line` | `#2C2C37` | `#E5E7EB` | 常规 1px 边界与分隔 |
| `--lumi-card-border-hover` | `--accent` | `#D1D5DB` | 交互卡片悬停边界 |
| `--text` | `#F8FAFC` | `#0F1117` | 主文字 |
| `--secondary` / `--quiet` | 均为 `#94A3B8` | `#4B5563` / `#6B7280` | 说明与辅助文字 |
| `--accent` / `--accent-bg` | `#F59E0B` / 琥珀 12% | `#B45309` / `#FEF3C7` | 强调、选中、键盘焦点 |
| `--button` / `--button-text` | `#F59E0B` / `#0E0E11` | `#D97706` / `#0F1117` | 主操作 |
| `--lumi-primary-hover` | `#FB923C` | `#F59E0B` | 主操作悬停 |
| `--lumi-operational` | `#10B981` | `#047857` | 运行／健康状态 |
| `--lumi-protocol` | `#38BDF8` | `#075985` | 协议语义 |
| `--lumi-error` | `#FFB4AB` | `#B42318` | 错误文字与边界 |

工具身份与来源身份分别复用 palette 中的 `--lumi-tool-*`、`--lumi-source-*`，由 Badge 的 `data-tool-kind`／`data-source` 映射，不能用身份颜色替代成功、错误等语义色。终端 ANSI 基础 16 色及 dim 透明度也由主题维护，不另配日志色板。

[useTheme.ts](../src/lib/useTheme.ts) 默认深色，以 `lumi.theme` 保存深／浅偏好，更新根 `data-theme`，storage 事件同步其他窗口；没有自动跟随系统主题的现行模式。主题缩略图复用 palette 的 preview 映射。

### 3.2 字体和字阶

UI 字体栈为 Geist → Apple 系统 → Segoe UI → PingFang SC → Microsoft YaHei → sans-serif；技术字体栈为 JetBrains Mono → ui-monospace／SFMono-Regular／Consolas → 系统 Emoji／中文回退 → monospace。本次未核验设备安装字体，不声称实际必定渲染为 Geist 或 JetBrains Mono。

| 场景 | 字号／行高 | token 或来源 |
| --- | --- | --- |
| 页面主标题 | 26／36px | `--lumi-text-page`／`--lumi-leading-page` |
| 常规区块／弹窗／详情标题 | 18／27px | `--lumi-text-section`／`--lumi-leading-section` |
| 设置项紧凑标题 | 16／24px，600 | `--lumi-text-section-compact`；settings.css |
| 正文／输入 | 14／22px | `--lumi-text-body`／`--lumi-leading-body` |
| 按钮／说明／日志 | 13／21px | `--lumi-text-help`／`--lumi-leading-help` |
| 标签／Tab／元信息 | 12／18px | `--lumi-text-label`／`--lumi-leading-label` |
| 单值指标／双值指标 | 32／40px、26／36px，600，等宽 | dashboard.css 的 `.ui-metric-value > strong`／`.ui-metric-pair dd` |

标题保持固定字号，窄窗靠换行。不要给所有二级详情套 26px；共用 `.ui-detail-heading` 实际为 18／27px。字重按组件沿用（Button／Field 标题 600，Tab 600，分页普通页码 400、当前页 700），不新建全局字重表。

知识与技能文档复用 DocumentViewer 的阅读排版：正文 14／22；h1 26／36／600，h2 18／27／600，h3/h4 14／22／600，h5/h6 14／22／500。h1–h3 段前 24px，h4 20px、h5 16px、h6 12px；h1/h2 段后 12px，其余 8px；首块无段前距。来源：[ui/knowledge.css](../src/components/ui/knowledge.css) 的 `.ui-reading-content`。

### 3.3 尺寸、圆角、阴影、动效

| 项目 | 现行值及边界 |
| --- | --- |
| 常规控件／图标操作 | 最小高 36px；IconButton 命中区 36×36px；`iconSize="small"` 仅图形 20px；提示问号图形 16px、命中区仍 36px |
| 容器与分组内边距 | Card normal 16px、compact 8px、flush 0；FieldGroup gap 12px，FieldRow gap 8px；MetricCard 使用第8节的既有专用布局，不覆盖普通Card |
| 圆角 | control 4px、container 8px、floating 12px；Card／Modal／Tooltip 实际用 container，Toast／侧栏图标导航用 floating。Switch 沿用 control；圆形状态点／圆环按既有组件，不推广为圆角控件 |
| 字段尺寸 | 标签列 144px，普通单行输入上限 320px，wide 上限 480px（320×1.5）；多行及具体业务组合按已有调用，不能所有输入一律定宽 |
| 通用搜索 | `--lumi-search-width: 240px`；用量会话搜索当前 280px，是业务布局，不替换全局 token |
| 常规／浮层阴影 | `0 4px 12px`／`0 8px 22px`，颜色用 `--lumi-shadow-color`：深色黑 24%、浅色 `rgb(38 38 41 / 12%)` |
| 重阴影 | 控件 `0 6px 18px` + `0 2px 6px`；浮层 `0 16px 40px` + `0 6px 16px`；颜色用 `--lumi-shadow-heavy-color`：深色黑 60%、浅色 `rgb(38 38 41 / 24%)` |
| 重阴影状态 | 非图标普通按钮常态阴影透明度 .6，hover／键盘焦点 1，按下 .3；hover 上移 1px，按下下移 1px 并缩放 .985；text 按钮无背景／边框／阴影／位移。交互卡片与选择控件按自身状态绘制阴影，不给所有容器加重阴影 |
| outline 图标光晕 | `glow` 图标常态辅助灰，hover／键盘焦点／按下显示 tone 语义色；重档 blur 8px、下移6px、交互透明度1，图形副本不可点击／播报；卡片内独立图标交互不同时激活整卡阴影 |
| Tab 选中阴影 | `--lumi-choice-selected-shadow-opacity` 深色 1、浅色 .4；不能降低所有浅色控件阴影 |
| 焦点 | 共用控件 2px `--accent` 描边，offset -2px；指针与键盘输入区分由 focus.ts／SurfaceEffects 维护，输入仍保留编辑反馈 |
| 滚动阴影留白 | 普通 token 0px，heavy 18px；具体列表使用 token 或 `max(4px, token)`，不能再叠额外顶栏到列表间距 |
| 动效 | hover 120ms、press 100ms、reveal 160ms、enter 180ms、exit 120ms；ease-out `cubic-bezier(.16,1,.3,1)`、ease-in `cubic-bezier(.7,0,.84,0)` |

来源：[ui.css](../src/components/ui/ui.css) 的控件、`[data-ui-depth='heavy']`、text 例外；[SurfaceEffects.tsx](../src/components/ui/SurfaceEffects.tsx)、[focus.ts](../src/components/ui/focus.ts)。App 业务区及 ToolRunWindow 显式采用 heavy，Modal／Tooltip 将档位带入 portal；UI组件预览也采用 heavy。阴影以伪元素透明度显隐，不动画 blur 或 box-shadow；不做整屏入场或装饰循环。已有加载旋转采用 progress 900ms，工作台等待呼吸 1800ms；DistributionRing 已获确认的真实份额插值用 900ms，不能据此新增装饰动画。减少动态效果时取消过渡／旋转／位移，保留最终状态。

间距没有一个可以覆盖所有页面的统一 token 阶梯：现有组件常用 4／8／12／16／24px，也有 10／14／18／20／28／40px 等具体布局值。新增应复用对应组合，不把“4px 基线”理解为可重排全部间距。

## 4. 应用壳、侧栏、页面与层级

来源：[styles.css](../src/styles.css)、[App.tsx](../src/App.tsx)、[tauri.conf.json](../src-tauri/tauri.conf.json)。

- 主窗口配置默认 1120×820，最小 720×560，可缩放；macOS 为 Overlay、隐藏系统标题。CSS 的 body 最小 320px 是底层约束，不是已支持 320px 原生窗口的证据。
- 壳为 100dvh，外层不滚动；侧栏固定 56px，正文左移 56px。侧栏 padding `40px 6px 14px`，品牌格 44px、标志 34px，主导航距品牌 38px；导航 gap 8px，底部设置靠下。
- 导航复用 NavigationButton：44×44px、12px 圆角、20px 图标；当前项无块状填色／线框，主色图标，左侧 4×20px 竖线与 2px 间隔、向右 44×44px 静态扇形光束。深色灯光主色，强度 44%／18%／50%；浅色图标 `#B87500`、灯光 `#F59E0B`，20%／6%／35%。悬停非当前项用 hover 背景，焦点独立保留；强制颜色模式保留系统竖线／图标，隐藏光束。
- 主窗口拖动区在 x=80px 以后、高 28px；不覆盖左上原生控制。正文默认 max-width 1152px、居中，padding `40px 40px 24px`；窗口 ≤1000 为 `40px 24px 24px`，≤780 为 `40px 24px 20px`，≤560 为 `40px 16px 20px`。工具／Skills／知识库覆盖为铺满宽度和剩余高度；用量另有专用宽度。
- 工具／Skills／知识库顶栏复用 `.ui-list-toolbar`：左侧分类 Tab 和分类末尾新增操作，右侧搜索及筛选／刷新／导入等；宽窗同行居中，空间不足时右侧操作整体靠右换行，间隔 8px，Tab 自身横向滚动。顶栏与列表仅保留列表的阴影上内边距（heavy 18px）；不恢复旧的两行布局，也不在列表设置负顶部 margin。
- 布局应说明谁滚动、谁固定，不能把所有页面复制成相同 max-width 或整页滚动。来源见下一节。

层级沿用实现而非新建统一 z-index 序列：主拖动区 z=1，侧栏 z=2；导航局部提示 z=10；Tooltip z=20；Toast z=30；拖动快照 z=50；表头／输出按钮等局部 sticky／overlay z=1。Modal 使用原生 dialog top layer，Tooltip 挂最近 dialog、Toast 注册到当前 dialog；不能用普通 z-index 判断能否压过原生 dialog。来源：ui.css、styles.css、[Tooltip.tsx](../src/components/ui/Tooltip.tsx)、[Modal.tsx](../src/components/ui/Modal.tsx)、[toast.css](../src/components/toast.css)。

## 5. 现有页面布局与返回约定

| 页面 | 当前布局、滚动与返回 | 代码来源 |
| --- | --- | --- |
| 工具列表／详情 | 列表独立滚动，三列 gap 12px；窗口 ≤960 两列、≤600 一列。紧凑卡片标题单行截断，用途按两行最小高度留位，底部类型／时间按现有组合。点击卡片进入二级配置页；列表用 hidden 保留挂载、筛选和滚动节点，返回恢复触发焦点。详情头／Tab 固定、`.tools-detail-scroll` 滚动；有草稿时返回／导航／受保护切换经过未保存决策，不清空草稿 | [ToolsPage.tsx](../src/components/ToolsPage.tsx)、[tools.css](../src/components/tools.css) |
| Skills 列表／详情 | 列表独立滚动、稳定滚动槽；三列 gap 12px，**容器** ≤780 两列、≤480 一列。分类／搜索状态留在父组件，进入详情隐藏列表，返回恢复触发按钮；切换主导航会清掉打开的详情，不等同于永久恢复详情。详情文件树／阅读用既有组合 | [SkillsPage.tsx](../src/components/SkillsPage.tsx)、[SkillDetailPage.tsx](../src/components/SkillDetailPage.tsx)、[skills.css](../src/components/skills.css) |
| 知识库列表／详情 | 列表 auto-fill，卡片最小 min(100%,280px)，gap 8px；列表独立滚动。进入记录列表 scrollTop／库 ID，返回显式恢复滚动和卡片焦点。详情目录宽 240px、正文独立滚动；容器 ≤760 隐藏侧目录，使用已有移动目录入口；图谱检查布局另有 ≤1050 降列规则 | [KnowledgePage.tsx](../src/components/KnowledgePage.tsx)、[knowledge.css](../src/components/knowledge.css) |
| 设置 | 通用宽度；每行左标题、右控件／状态靠右，padding `24px 0`、gap 24px、细分隔，不套独立窄卡片；行标题 16／24px。**容器** ≤479 改一列、gap 16px。主题、MCP、首页提示、Core、开发组件入口沿用实际项目 | [SettingsPage.tsx](../src/components/SettingsPage.tsx)、[settings.css](../src/components/settings.css) |
| 工作台 | 现有引导最大 560px、单列；实际主页为已有文档／模板渲染，不能用隔离预览顶部栏推导宿主布局。保持主导航与窗口壳；组件复用例外不授权默认重设计 | [WorkbenchPage.tsx](../src/components/WorkbenchPage.tsx)、[WorkbenchContent.tsx](../src/components/WorkbenchContent.tsx)、[workbench.css](../src/components/workbench.css) |

工具／Skills／知识库当前卡片列表没有接入分页；不要因为存在 Pagination 就新增产品分页。卡片共用 [ui/knowledge.css](../src/components/ui/knowledge.css) 的资源标题／描述／元信息，业务只排布，不照旧设计记录恢复已删除状态栏或按钮。

“返回保留状态”按具体页面代码核对，不承诺跨应用重启保存所有页面状态。App 主要业务组件保持挂载，active 控制显示／读取；设置为条件挂载。新增同类详情应沿用最近模式，至少保留用户进入前的筛选、排序、页码、滚动、触发焦点；这是新增页面的验收要求，不是全项目现有行为已实测证明。

## 6. 表单与工具配置

来源：[Field.tsx](../src/components/ui/Field.tsx)、[FieldGroup.tsx](../src/components/ui/FieldGroup.tsx)、[controls.tsx](../src/components/ui/controls.tsx)、[SimpleToolConfig.tsx](../src/components/SimpleToolConfig.tsx)、[ToolConfigFields.tsx](../src/components/ToolConfigFields.tsx)、tools.css。

- 复用 Field／FieldTitle／FieldGroup／FieldRow 与 Input／Textarea／Select／Checkbox／Switch。Field 默认纵排 gap 8px；inline 标签列 144px、列距 16px，控制区默认上限 320px 并靠右、wide 480px。视口 ≤600 改纵排；工具配置还按容器 ≤559 改列、≤439 允许目录组合换行。不要混淆视口与容器宽度。
- 常规多行 Textarea 默认五行，工具用途说明显式五行并显示字数；运行正文等已有三行调用保留。参数及 JSON 编辑器沿用实际类型处理、原始输入草稿和只读状态，不用样式变更改参数契约。
- Field 自动关联 label／id、description／error 与 aria-describedby，并设置 aria-invalid；业务仍负责校验、展开错误所在区域、切到对应 Tab、聚焦首错和 useToast。服务故障不能当作字段错误。
- 目录复用 [TerminalWorkingDirectory.tsx](../src/components/TerminalWorkingDirectory.tsx)：inline／wide，revealEnd 默认看长路径末尾；可输入／选择文件夹，留空主目录；只读时不显示选择操作。配置提示与运行输入内提示由已有参数控制。
- **Terminal 工具配置表与运行参数不是同一种布局。** 配置用 [TerminalParameters.tsx](../src/components/TerminalParameters.tsx)：Card flush、288px 内部视口（36×8）、最小表宽 800px（320×2.5），表间距 8px。列为外部可见／参数名／参数值／描述／必填，另留删除列；可见性列 108px、必填列 52px、操作 36px。窄窗在表内横向滚动，参数数目和错误不撑高表。
- 配置行悬停／焦点进入／拖动时显示手柄及删除，预留位置不跳动；拖动用 [useTableDragPreview.ts](../src/components/ui/useTableDragPreview.ts)，草稿、输入、遮蔽状态随行移动，Escape／取消／失焦恢复；键盘方向键和 Home／End 排序。不得重建一套页面拖动视觉。
- HTTP 配置参数及 Header 复用 FieldRow／KeyValues 的横向视口，单条配置保持同行，需要时在组内横向滚动；不将运行的三段布局直接倒灌到配置页。
- Button 已保留普通／loading 两层文字占位，loading 禁用；业务异步入口还需防重入。用 `variant="text"` 表达文字操作；主操作阶段规则沿用 ToolsPage（有修改保存、待启用启用、已启用运行），不能仅因忙碌改按钮层级。

## 7. 工具运行窗口与输出：不可回退的组合

主要来源：[ToolRunWindow.tsx](../src/components/ToolRunWindow.tsx)、[ToolRunPanel.tsx](../src/components/ToolRunPanel.tsx)、[RunParameters.tsx](../src/components/RunParameters.tsx)、[RunParameterRow.tsx](../src/components/RunParameterRow.tsx)、[RunConfigurationFields.tsx](../src/components/RunConfigurationFields.tsx)、[tools.css](../src/components/tools.css)。

### 7.1 窗口及阶段

独立运行窗口复用 WindowPanel，默认 760×680、最小 560×480，尺寸从主题经 [tool-run-window.ts](../src/lib/tool-run-window.ts) 传给 [run_windows.rs](../src-tauri/src/run_windows.rs)。标题安全区 28px、左侧原生控制 80px；窗口标题区、正文、底栏同 panel 背景。固定标题／底部操作，正文按准备或执行阶段滚动，不恢复早期固定小日志窗的布局。

始终自上而下“配置”“执行”两个 StageSection，节点距 12px、正文距标题 4px，无 28px 左缩进。准备时配置展开；执行后配置默认折叠，可查看本次冻结输入，输出填剩余高度；展开配置时正文允许整体滚动，执行区保持至少日志高度的可读区域。顶部不再添加运行窗口的关闭 ×，独立窗口用原生控制，备用 Modal 保留 Escape 和业务关闭保护。

重新运行先回配置、保留输入，再点击运行才执行；历史缺少输入快照时明确说明，不能拿当前配置冒充历史。运行中关闭使用既有共用 Modal 的结束／后台／取消选择，不新增系统弹窗。断连、停止等待和远端结果未知保持真实状态，不伪报成功。

### 7.2 参数行与输入提示

- 参数行宽窗为 **名称、现有标签、输入控件三个相邻区域，同一行**。CSS 为 `144px max-content minmax(0,1fr)`，gap `8px 16px`；名称／标签最小高 36px，长名称可换行。显示名当前代码为 `schema.title || key`；不创造新业务标签。
- 标签为既有“外部可见／外部不可见”和“必填／可选”。必填及预检依赖先显示，可选组按原顺序折叠，折叠保留值，含错误时自动展开。不恢复标签堆在名称下方或五列表头运行表。
- 当 **参数容器** ≤559px，名称和标签仍相邻，输入移至下一整行。这是现行窄窗适配，不能把宽窗同行要求改为永远纵排。
- 非空描述才显示 InputHint 问号：单行输入内右侧垂直居中、多行右上角；输入右侧预留 `36px + 8px`。说明不常驻；hover／点击／键盘 focus 显示同一 Tooltip，Escape 关闭；portal 避免列表裁切，长内容换行和内部滚动。输入保留辅助技术描述，**校验错误仍在输入下方持续可见**。来源：[InputHint.tsx](../src/components/ui/InputHint.tsx)、Tooltip.tsx。
- Terminal／HTTP 可编辑范围及私有值遮蔽沿用真实契约；MCP 使用已保存 schema／预设，只读。不能因为统一外观而开放新编辑能力。

### 7.3 HTTP／MCP 连接行

HTTP 仅一行“请求：”后接固定方式和地址；MCP 仅一行“MCP：”后接地址／连接摘要和工具下拉或空选择。使用共用 Field、Input、Select，固定信息不加“固定／固定值”视觉 Badge；辅助技术名称中的“固定”和“恢复固定值”等动作文字保留语义。

地址复用 [tool-run.ts](../src/lib/tool-run.ts) 的 `safeRunAddress` 脱敏；stdio 显示传输标识和命令 basename，不编造 URL。MCP 仅列出保存的合法 discovery 工具；允许清空选择，但当前无合法空工具调用，空选不实际执行；选择改变不覆盖保存配置。窄窗按既有连接组内规则换行，不拆回多行固定标签。

### 7.4 日志、结果与复制

当前运行输出复用 [LogViewer.tsx](../src/components/ui/LogViewer.tsx)：**不显示“运行内容”可见标题行**，运行代码传 label 作为可读名称、不传 title；不应为隐藏标题删掉辅助技术标签。Terminal 无多余输出 Tab／查看详情标题栏；HTTP／MCP 保留运行记录与响应／结果 Tab，结束及用户主动选择决定当前阅读内容。

复制 IconButton 浮置右上，20px 图形、36px 命中区；overlay 距上／右各 12px，日志与滚动条让出右侧 `36px + 24px`。恢复跟随入口在同侧底部；向上阅读暂停自动跟随，距底部不足 24px 视为恢复跟随。复制各区域的完整原始文本（Terminal 去 ANSI 保留 Unicode），不从当前 DOM 可见片段取值；反馈通过 Toast。

HTTP／MCP 结果有多个实际内容块时仍可显示各块的 FieldTitle；不要把“移除冗余日志标题”误解成删掉所有结果分区语义。HTTP 状态保留，未保存的响应头不虚构展示。

LogViewer token 默认日志高 240px、结果 200px、combined 440px，但当前运行主输出用 fill 自适应；这些默认档位不应成为运行窗口固定高度。配置表 288px 也不适用于当前 RunParameters。

## 8. AI 用量、会话列表与二级明细

来源：[UsagePage.tsx](../src/components/UsagePage.tsx)、[usage.css](../src/components/usage.css)、[DataDashboard.tsx](../src/components/ui/DataDashboard.tsx)、[DataMetrics.tsx](../src/components/ui/DataMetrics.tsx)、[dashboard.css](../src/components/ui/dashboard.css)。

- 内容最大 1600px，padding `40px 24px 24px`，保留左侧菜单；页区块 gap 12px。顶部无重复标题／副标题、无背景卡片，软件／日期复用默认 Tabs／Segmented，软件横向区域可独立滚动，操作靠右，窄窗换行。来源只取实际扫描识别范围，网关独立，不混加“全部”。
- 三张 MetricCard 并排，卡间 16px；最小高 144px，padding `12px 12px 8px`，标题与值区 gap 8px、自定义值区底对齐，内容换行可增高。双指标用 MetricPair，不恢复独立底部数值行；设备实际份额用 DistributionRing（高 88px、最大宽 300px）。空数据是 0，已存在记录但未报告的字段是未知，估算沿用已有标识。
- 趋势与排行列比 1.4:1、gap 16px，分析区最小 320px、绘图区 200px；窗口 ≤1050 纵排，指标 ≤780 纵排。排行为只读 compact 行（gap 6px、padding 7px 10px），不能重新加点击筛选。图表横向浏览与共用提示沿用已有组件。
- 会话区域用 ExpandableTable 的 **onRowOpen 模式**，点击行或具名箭头打开独立二级页，不在当前会话表行内展开。表 viewport 固定 420px、最小表宽 740px、表头 sticky；每页 10 会话，数量以筛选全量 matched 计。排序常驻，筛选变化回首页，刷新保留有效页／页数收缩回最后有效页。
- Pagination 复用 Button text：无常态背景、边框、阴影；普通页码 400，当前页主文字色 700、aria-current。总页数 ≤7 全显示，>7 固定 7 个页码／省略号槽位；槽宽 `max(36px, 总页数字数×1ch+18px)`。上一／下一位置不随切页跳动，内部不换行，窄窗整组换行或横向滚动，焦点不自动翻页。来源：[pagination.ts](../src/components/ui/pagination.ts)。

二级会话详情来源：[UsageSessionDetail.tsx](../src/components/UsageSessionDetail.tsx)、[UsageSessionCard.tsx](../src/components/UsageSessionCard.tsx) 的 UsageSessionRecords、[UsageRecordCard.tsx](../src/components/UsageRecordCard.tsx)。

- 顶部 ArrowLeft IconButton 返回、18／27px 详情标题（名称或脱敏 ID）、软件／模型，长标题换行；进入聚焦标题。父列表 hidden 保留挂载，返回显式恢复 workspace 滚动及原行按钮焦点，筛选／排序／页码保持。列表自身滚动节点保留；本次未实测其像素位置恢复。
- 详情填剩余窗口高度，外层不纵滚；头部、日期／总计、数量和加载更多保持可见，只有记录区内部纵滚。统一外层横向滚动包住表头和记录，表头与行同一列模板并都预留稳定纵向滚动槽；不恢复每条记录嵌套卡片。
- 八列为时间、模型、输入、输出、缓存读取、缓存写入、总计、来源；最小表宽 980px，列模板 `232px minmax(120px,1fr) repeat(5,84px) 72px`、列距 16px，行最小高 36px、行间 8px。时间／模型可省略并有完整 title；数值 K／M 缩写但辅助描述保留精确值、缓存语义；来源复用 Badge。
- 日期为默认未选中样式的单项 Segmented 触发 DateRangeCalendar，初始继承实际筛选范围（含趋势桶）；应用才重查，取消不改查询。数量与总计覆盖整个范围，不受“加载更多”截断；切换范围清空旧记录／分页，迟到响应不得覆盖新查询。错误 Toast 并提供重试，加载保留区域。

2026-10-18 对齐补充：DateRangeCalendar 的36px日期按钮明确使用 minmax(0,1fr) 单列网格，数字以按钮中心对齐，避免隐藏加载文案撑宽隐式网格列造成数字偏右。此修复同时作用于 UI组件预览和业务调用，其他视觉及日期行为不变。

## 9. 弹窗、提示与反馈

- Modal 原生 dialog，常规宽 `min(760px,100vw-32px)`、max-height `100dvh-48px`；确认宽 440px。8px 圆角，panel 表面；遮罩黑 48%。默认标题 padding `16px 24px`，正文 `0 24px 20px`，底栏 `16px 24px`、gap 12px、换行、非图标按钮 min-width 112px。工具新增窗口另用 tools-dialog 既有尺寸／内边距覆盖，不据此重设全局 Modal。
- Modal 打开聚焦标题或传入 initialFocus，关闭恢复触发者；确认默认聚焦取消。busy 阻止关闭；退出时内容 inert、防止再次提交；默认不点击遮罩关闭，有 requestClose 时由业务先处理草稿保护。进入 180ms 上移 4px 淡入，退出 120ms；不要照旧文字给弹窗加缩放。来源：Modal.tsx、[ConfirmationDialog.tsx](../src/components/ConfirmationDialog.tsx)、ui.css。
- Tooltip 为 8px 圆角、padding 12px、13／21px；最大宽 `min(40ch,100vw-32px)`、最大高 `100dvh-32px`，窗口边缘留 16px，与触发器间距 8px，必要时翻到上方；滚动／resize／Escape 关闭，提示自身滚动不关闭。它与 Toast 是不同组件，不能互相替代。
- 按钮成功／失败／校验／提醒统一 [ToastProvider.tsx](../src/components/ToastProvider.tsx) 的 useToast，窗口顶部居中、不抢焦点、不放页面底部或按钮下方；持续服务状态、静态说明、字段错误仍放原位置。Toast 当前区域距顶 `max(44px,safe-area)`、左侧让 56px，z=30；气泡最大宽 520px、12px 圆角、padding `4px 6px 4px 16px`，关闭命中区 44px。
- Toast 普通／成功 4 秒、错误 8 秒；进入 180ms 从上方 16px 下落、退出 120ms 淡出。hover／键盘 focus 暂停，重复操作替换并重新计时，id 校验防旧计时器清除新气泡；role=status、polite 播报，关闭时必要恢复焦点。最近 Modal 注册 viewport 保证反馈在顶层。Toast 特定阴影见差异表，不自行改为 heavy。

## 10. 不一致与待确认项（本任务不改产品）

| 差异 | 依据与当前处理 |
| --- | --- |
| 历史文档互相覆盖但标题仍称“当前” | UI_DESIGN／UI_COMPONENTS／TOOLS_DESIGN 同时记录五列运行表、左右两段、三段同行；移除节点／恢复双节点；旧两行顶栏／新同行；行内会话展开／独立详情。按本文给出的实际调用生成，新需求不能回退旧方案；本文入口不删除历史记录 |
| 旧浅色导航文字色、光色与最新色板不同 | UI_DESIGN 的旧导航段仍有 `#875600`／`#E89A12`；最新开头及 palette 为 accent `#B45309`、灯光 `#F59E0B`。复用现行 palette，不把旧值再次写入组件 |
| 旧运行参数容器宽 420px／固定 288px 说法已不适用 | tools.css 当前 RunParameters 在容器 ≤559 换行，且运行参数无 288px 固定卡片；288px 保留在配置编辑表。此差异应在后续整理历史章节时由用户确认，不移植旧规则 |
| Tooltip／导航提示／Toast 与“气泡 12px、统一阴影”概括不同 | Tooltip 与导航提示实际 8px；Toast 12px，阴影为固定 `0 8px 24px rgb(0 0 0 / 18%)`；导航提示为 `0 8px 22px rgba(23,38,29,.18)`，未使用通用 heavy。保留现有组件，未来是否收敛需用户主动要求，不能在业务补皮肤 |
| 通用字阶／间距描述不覆盖所有页面 | 设置标题 16px、详情 18px、指标 32px／26px；知识卡 gap 8px，工具／Skills gap 12px；用量指标 144px／分析 320px已替代早期160px／360px。按组件和页面取值，不虚构统一值 |
| 断点单位与数值不同 | 工具网格按窗口 960／600，Skills 按容器 780／480，运行参数按容器559；不能全改成一个“移动端断点”。原生主窗最小720px，低于最小尺寸的CSS不能冒充实机覆盖 |
| MCP 空选文案与运行能力边界 | 下拉文案“请选择工具（可留空）”，但空选没有合法执行模式；生成时保留空选择及运行校验，不宣称支持空工具调用，是否调整文案待用户要求 |
| 旧组件仍存在，不代表当前业务仍使用 | UsageSessionCard 默认组件仍可行内展开，当前 UsagePage 采用独立详情；ToolRunPanel 内旧结果组合与新运行输出共存。选组件应看实际调用，不按文件名／搜索命中恢复旧行为 |
| 主题 meta 颜色与浅色背景不一致 | useTheme 更新 meta theme-color 为 `#F0F0EE`，palette 实际浅色 bg `#F8F9FA`；未核验原生影响，保留并记录，不能以此改页面背景 |
| 视觉／可访问性未实看 | 未验证实际字体回退、像素对齐、对比度、窄窗裁切、原生弹层、键盘和返回滚动。代码存在支持不等于已完成设备验收，后续按下节测试 |

## 11. 新增 UI 的适用验收清单

以下为**建议执行的验收标准与项目既定要求的检查清单**，不是本次已运行的测试结果；只对功能实际涉及的模式执行，无该模式记 N/A，不能为了验收新增产品能力。

| 条件 | 应检查的结果 | 已有实现依据／仍需验证 |
| --- | --- | --- |
| 真实空数据 | 说明无数据与下一步；用量保留结构及0，未知不冒充0；无工具不假造可运行项目 | 当前页面有空态分支；需实际空库验证 |
| 初次／后台加载 | 布局有界、控件宽度稳定、可读忙碌状态；按钮防重复；保留已读内容按当前业务规则 | Button／页面 aria-busy 已实现；需验证并发操作 |
| 字段校验失败 | 首错可见、展开所在折叠组／Tab、焦点到字段，红边、辅助描述、顶部错误 Toast，用户输入不丢 | Field 与业务校验组合；不能仅测试出现红字 |
| 服务／网络／读取失败 | 区别字段错误，保留恢复／重试入口；断连／结果未知如实展示，不伪报成功 | 运行／用量／知识代码有独立分支；需故障验证 |
| 少量／长内容 | 1条／不足1页不拉伸为新布局；长名称、中文、URL、路径、JSON、Unicode日志不挡操作，必要截断可读完整值 | 已有 min-width:0、wrap、title／Tooltip、revealEnd；需实看 |
| 多页／页数收缩 | 用量10条／页；>7页、首尾与中段省略、三位页码、切页禁用、焦点不切页、刷新有效页保留 | paginationItems／Pagination 已实现；工具等无分页则N/A |
| 多条记录／滚动 | 工具列表、配置表、日志、会话表、详情记录各自在指定视口滚动；表头列对齐，固定头／底栏可达；无整页横向溢出 | CSS 划定滚动责任；需系统常驻滚动条及WebKit验证 |
| 返回上下文 | 从滚动后、筛选后、非首页进入详情，再返回；筛选、排序、页码、滚动、原行焦点保留；原行消失时明确合理落点 | 各页面机制不同，见第5／8节；消失后的回退焦点不承诺已全面实现 |
| 最小／默认／宽窗口 | 主窗720×560、1120×820及较宽窗口；运行560×480、760×680；按对应容器断点检查换行、滚动、标题不缩字号、原生控制和拖动区可用 | 窗口配置与CSS依据明确；本次无原生尺寸验收 |
| 双主题 | 实际页面与弹窗、Tooltip、Toast、日志、图表、选中阴影都正确继承；语义可辨，正文对比度目标4.5:1、关键图形3:1 | 主题映射已核对，未重新测量对比度 |
| 键盘／辅助技术 | Tab顺序、Enter／Space、Tabs方向键／Home／End、Escape关闭、关闭恢复焦点；icon具名、label关联、错误描述、表格标题和当前页可读 | 控件实现支持；需真实键盘／读屏检查 |
| 提示与反馈 | hover／点击／focus问号、长提示内滚、Escape；Toast 4／8秒、暂停、重复计时和嵌套dialog可见、不抢焦点 | Tooltip／Toast代码支持；需原生顶层核验 |
| 减少动态／高对比 | reduced-motion取消位移／缩放／旋转，图形静态可读；forced-colors保留选中、焦点和必要边界，不依赖光晕 | 已有共用规则，图表及具体页面仍需逐项实看 |
| 草稿／关闭／重跑 | 配置切Tab保留编辑，返回保护，运行输入快照真实，重跑先编辑，开始双击不误停，关闭后后台／结束行为真实 | 业务已有防护；不能仅按按钮外观判定通过 |

涉及实现变更时按 [CONTRIBUTING.md](../CONTRIBUTING.md) 执行 `pnpm check`，并对实际涉及页面做上述验收；报告执行项、跳过原因与截图来源。开发 UI组件预览有真实交互与124页分页示例，但不替代业务窗口验收。用户于 2026-10-18 再次明确本次发布不提交 `codeburn.test.ts` 的修改。该已跟踪文件保留原内容，未删除；原 CodeBurn 注册表边界保持兼容，新增四款来源由独立 native 测试覆盖。后续不能把不提交修改理解为删除授权。
