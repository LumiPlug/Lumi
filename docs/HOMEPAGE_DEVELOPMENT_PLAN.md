<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 官方主页开发方案

2026-09-30：外部 AI 开发的主页采用唯一官方免构建 HTML 模板。Lumi 桌面宿主本身仍使用 React/TypeScript/Vite。

## 用户工程

`templates/html-home` 的三个必要文件是根目录 `index.html`、`app.js`、`style.css`，`index.html` 是固定入口。开发者可添加图片、字体、其他脚本及目录；其他框架也可以使用，但交付给 Lumi 的静态工程最终须有这三个根文件，资源引用使用相对 URL。页面编辑、模拟预览和 MCP 发布均不要求用户安装 Node、pnpm 或执行构建。框架自身的编译如有需要由其开发环境完成，不转嫁给普通用户。

模板还提供可恢复项目清单 `lumi.home.json`、版本化知识库、本地预览主题 CSS 与浏览器 SDK 脚本。这些由 Lumi 提供，不是用户必须编写的三个入口文件。AI 发布时使用官方模板中的项目清单；已有工程继续开发时保持 `projectId`，以保留项目 KV。

## SDK 与版本

SDK 源码位于 `packages/home-sdk`；应用构建时用 esbuild 生成同版本的独立浏览器脚本。Lumi 在运行时提供受控的 `lumi-sdk.js`，无需信任用户工程中的同名脚本；对未主动引用 SDK 的自定义 `index.html`，资源服务自动加入引用。官方模板附带的脚本用于本地直接打开文件时的明确模拟预览。`window.lumi` 提供 ready、context、capabilities、tools、storage、theme、toast。页面与外部 MCP 共享 CapabilityRegistry，页面只可访问公开功能。版本契约由根发布版本生成：format 2、bridge 1、Lumi/SDK 同版本；不再检查 React、TypeScript 或 Vite 的开发依赖版本。

## 发布与版本

工作台不提供本地文件导入按钮。外部 AI 调用 `Lumi.get_workbench_template`、`Lumi.get_workbench` 和 `Lumi.publish_workbench`，提交 `manifest/files/sourceFiles` 中的文本或 base64 文件内容及 `expectedVersion`，Core 校验后通过同一发布事务保存，无需 Node 构建包。版本冲突须读取新版本并合并。工程导出只写新建或空目录，保留源码与知识库；历史恢复产生新版本，项目 KV 不回滚。

标准包限制：最多 512 文件，单文件 4 MiB，运行文件与源码解码后合计 16 MiB，请求 JSON 最大 24 MiB。校验入口、源文件、清单一致性、版本、编码和安全相对路径；拒绝路径穿越、重复文件和运行包伪造 SDK。源码可包含辅助资料，运行服务只暴露运行文件与 Lumi 生成的 SDK。

## 隔离与版本

静态资源在独立随机 loopback 端口提供。主页运行于仅允许脚本的 sandbox iframe，通过来源与实例验证的 MessageChannel 和限额 RPC 调用宿主；CSP 阻止外部网络、内联脚本、顶层导航与弹窗。主题和操作反馈由宿主提供；主窗口自定义 IPC 继续使用主 frame 凭证。iframe 隔离不保证独立进程或抵抗恶意死循环。

加载、发布、导出与历史恢复均要求当前 HTML format 2 契约。协议不匹配的工程不予加载或恢复。

## 验证

根工程执行 `pnpm check` 与前端/Core 构建，检查生成契约与嵌入模板一致。测试三个入口文件校验、MCP 发布、SDK 受控提供、真实工具调用、版本冲突、当前契约下的历史恢复、项目数据及隔离边界。模板直接在浏览器模拟预览，在 macOS 原生 WebView 验证 SDK；其他平台按实际结果记录。
