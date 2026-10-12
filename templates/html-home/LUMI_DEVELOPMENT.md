<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi 官方 HTML 主页开发入口

只需修改 `index.html`、`app.js`、`style.css`，无需 Node、pnpm、React 或构建。`index.html` 是固定入口；三者必须位于目录根部。图片、字体、额外脚本可放在相对路径下。通过 Lumi MCP 发布静态主页文件包，由 Lumi 校验、加载与保存版本。

1. 调用 `Lumi.get_workbench` 读取当前源码和版本；首次调用 `Lumi.get_workbench_template` 获取模板和知识库。需要写出工程文件时使用 `Lumi.export_workbench_project`。
2. AI 阅读本文件及 `knowledge/`，自由修改三个入口文件。需要更多文件或其他框架时，最终静态产物仍保留根目录三个入口；`index.html` 加载其他相对路径资源即可。
3. 通过浏览器全局对象 `window.lumi` 调用 SDK。例如 `await window.lumi.ready()`、`window.lumi.tools.list()`。`lumi-sdk.js` 是随 Lumi 版本生成的预览文件，不要修改；在 Lumi 内由宿主提供。
4. 可直接在浏览器打开官方 `index.html` 预览模拟模式；模拟操作不会写入 Lumi。
5. 使用 `Lumi.publish_workbench` 提交 `manifest/files/sourceFiles` JSON，使用读取时的 `expectedVersion`；发生版本冲突时先取回最新源码合并。
6. 在真实 Lumi 中确认交互、主题、键盘、反馈与业务数据。

`lumi.home.json` 保存项目 ID 和 SDK 协议版本。继续开发同一主页应保留 `projectId`，避免丢失该项目的持久数据。发布和恢复的工程都必须符合当前 Lumi 的 HTML 契约。

## 开发知识库

- [SDK API](knowledge/sdk-api.md)
- [能力与工具](knowledge/capabilities-and-tools.md)
- [交付与版本](knowledge/build-and-delivery.md)
- [隔离与限制](knowledge/security-and-limitations.md)
- [界面与主题](knowledge/ui-guidelines.md)
- [AI 开发流程](knowledge/ai-workflow.md)
