<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 官方主页开发方案

2026-09-30：外部 AI 开发的主页采用唯一官方免构建 HTML 模板。Lumi 桌面宿主本身仍使用 React/TypeScript/Vite。

## 用户工程

`templates/html-home` 的三个必要文件是根目录 `index.html`、`app.js`、`style.css`，`index.html` 是固定入口。开发者可添加图片、字体、其他脚本及目录；其他框架也可以使用，但交付给 Lumi 的静态工程最终须有这三个根文件，资源引用使用相对 URL。页面编辑、模拟预览和 MCP 发布均不要求用户安装 Node、pnpm 或执行构建。框架自身的编译如有需要由其开发环境完成，不转嫁给普通用户。

模板还提供可恢复项目清单 `lumi.home.json`、版本化知识库、本地预览主题 CSS 与浏览器 SDK 脚本。这些由 Lumi 提供，不是用户必须编写的三个入口文件。AI 发布时使用官方模板中的项目清单；已有工程继续开发时保持 `projectId`，以保留项目 KV。

## SDK 与版本

SDK 源码位于 `packages/home-sdk`；应用构建时用 esbuild 生成随应用发布的独立浏览器脚本与存储兼容脚本。Lumi 在运行时提供受控的 `lumi-sdk.js` 与 `lumi-storage.js`，无需信任用户工程中的同名脚本；资源服务始终在 `index.html` 业务脚本前加入存储预载与 SDK 引用，原有 SDK 重复引用保持幂等，不改写项目源码。官方模板附带的脚本用于本地直接打开文件时的明确模拟预览。`window.lumi` 提供 ready、context、capabilities、tools、storage、theme、toast。页面与外部 MCP 共享 CapabilityRegistry，页面只可访问公开功能。

2026-10-16：应用发布版本与主页协议分离。清单中的 `lumiVersion`、`sdkVersion` 仅记录工程创建时的发布信息，不参与加载、发布、导出、历史恢复或 SDK 握手的兼容性判定，也不比较大小。实际兼容性依据 HTML 工程格式（format 2、lumi-html-home、index.html）与桥接协议（bridge 1）；SDK 握手仅校验桥接协议。应用升级自动继续加载同契约的已有主页，使用宿主当前 SDK，无需重新发布、改写工程清单或迁移项目 KV。未来破坏性协议变更应独立升级 format／bridge 并提供迁移方案，不能由应用或 SDK 发布号变化触发阻断。

## 发布与版本

工作台不提供本地文件导入按钮。外部 AI 调用 `Lumi.get_workbench_template`、`Lumi.get_workbench` 和 `Lumi.publish_workbench`，提交 `manifest/files/sourceFiles` 中的文本或 base64 文件内容及 `expectedVersion`，Core 校验后通过同一发布事务保存，无需 Node 构建包。版本冲突须读取新版本并合并。工程导出只写新建或空目录，保留源码与知识库；历史恢复产生新版本，项目 KV 不回滚。

标准包限制：最多 512 文件，单文件 4 MiB，运行文件与源码解码后合计 16 MiB，请求 JSON 最大 24 MiB。校验入口、源文件、清单一致性、版本、编码和安全相对路径；拒绝路径穿越、重复文件和运行包伪造 SDK。源码可包含辅助资料，运行服务只暴露运行文件与 Lumi 生成的 SDK。

## 隔离与版本

2026-10-19 原生验证完成：macOS Tauri/WKWebView 中确认同步预载、localStorage 刷新/应用重启持久化、sessionStorage 刷新保留/应用重启清空，以及 flush 失败拒绝和重试成功。iframe 自刷新使用每文档随机 ID 重新握手，异步回包绑定原 MessagePort，避免刷新超时或旧请求串包。完整记录见 [原生存储验证](qa/2026-10-19-storage-native/README.md)；Windows WebView2 尚未实机验证。

2026-10-19 用户授权存储兼容层：资源服务在入口的任何业务脚本之前注入受控 `lumi-storage.js`，同步预载当前项目 localStorage 与当前窗口会话的 sessionStorage。页面可直接使用 Storage 的 getItem/setItem/removeItem/clear/key/length 及属性形式；内存同步更新，按操作顺序异步经原有 MessageChannel 写入，`await lumi.storage.flush()` 明确等待确认，失败保留队列、拒绝 flush 并复用顶部错误 Toast，允许再次 flush 重试。异常退出/未 flush 的立即导航不保证最后写入落盘，不伪称同步持久化。localStorage 使用独立 SQLite 表并按 projectId 隔离，sessionStorage 仅保存在 Core 内存、按项目和宿主窗口会话隔离，刷新保留，应用重启清空；会话 ID 由宿主窗口提供，RPC 由宿主覆盖，页面不能选择其他项目。浏览器存储与原 SDK KV 分开，clear 不影响另一命名空间；IndexedDB/Cookie 不做模拟。注入仅针对工作台入口，不向任意远程子页面或弹窗注入桥。

浏览器存储每区域/项目会话 5 MiB、最多4096键、单值1 MiB、键最多1024 UTF-8字节，超限同步抛 QuotaExceededError；原 SDK KV 扩展为4096键、单值256 KiB、项目总量5 MiB，旧数据保留。仅存储 RPC 提高至8 MiB消息限额以容纳 JSON 转义，其余 RPC 仍64 KiB；服务端校验同样限额与当前项目/版本，操作原子提交，持久化失败不清空已有数据。主窗口会话标识使用宿主自己的 sessionStorage；Core 至多保留32个会话区，关闭应用清空。保留 opaque origin 及宿主凭据隔离，不以 allow-same-origin 解决存储。

2026-10-19 用户授权放开主页浏览器能力：静态资源仍在独立随机 loopback 端口提供，iframe 与资源响应共用 `packages/shared/src/workbench-permissions.ts` 的权限策略。开放外部 HTTP(S)/WebSocket 请求、CDN、内联脚本与动态求值、外部样式/图片/字体/媒体、Worker、嵌套页面、表单、下载、弹窗、指针与方向锁定及演示；iframe 委派常用浏览器权限，不再通过响应头统一禁用摄像头、麦克风和定位。实际可用性仍受 CORS、系统 WebView、浏览器与系统授权限制。

为满足“不访问宿主 UI 与内部运行信息”，保留 opaque origin、禁止顶层导航以及弹窗继承沙盒；不启用 `allow-same-origin`、`allow-top-navigation` 或弹窗逃逸，页面及子页面/弹窗不能经导航变为宿主同源页面。浏览器原生 Cookie/IndexedDB 以及依赖非 opaque origin 的设备 API 因此仍可能不可用；localStorage/sessionStorage 由上述受控兼容层提供，JSON 持久数据也可继续使用项目隔离的 SDK storage。MessageChannel 校验来源窗口与实例、限制 RPC 大小/并发，公开 Registry 工具可真实执行，管理接口与 Tauri/Core/MCP 凭据不开放。公开 SDK 上下文、主题及工具任务结果仍按现有契约提供，不包含宿主进程、连接令牌或 UI 内部状态。主窗口自定义 IPC 继续使用仅主 frame 可得的凭证。iframe 隔离不保证独立进程或抵抗恶意死循环；已授权的工具按自身权限执行，不是操作系统沙盒。

加载、发布、导出与历史恢复均要求当前 HTML format 2 契约。协议不匹配的工程不予加载或恢复。

## 验证

根工程执行 `pnpm check` 与前端/Core 构建，检查生成契约与嵌入模板一致。测试三个入口文件校验、MCP 发布、SDK 受控提供、真实工具调用、版本冲突、当前契约下的历史恢复、项目数据及隔离边界。模板直接在浏览器模拟预览，在 macOS 原生 WebView 验证 SDK；其他平台按实际结果记录。

## 默认效率工作台（2026-10-17）

连接引导第二步提供通用办公、开发者、内容创作三个内置模板，选择后通过“应用模板”直接发布并加载，无需外部 AI 构建；保留原有 AI 定制提示词。模板沿用官方 HTML 契约和主题，应用本身不运行任何工具，发布校验 expectedVersion，历史版本可恢复。已有主页继续直接显示，不自动覆盖。

三个模板共用待办、工作流绑定与运行、真实任务记录及结果展示，使用不同的场景文案和工作流。初始没有虚构数据；待办由用户录入并保存到项目 KV。工作流由用户明确绑定已授权工具，参数按真实 Schema 输入，缺少配置时提供工具页配置步骤并允许刷新。未启用、失效、运行失败、服务不可用分别展示真实状态；不预装或自动授权工具，不虚构 AI 汇报产出或效率数字。操作反馈使用宿主顶部 Toast。引导入口复用共用 ChoiceCard 和 Button，不新增视觉组件。
