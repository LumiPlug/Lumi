<!-- SPDX-License-Identifier: MPL-2.0 -->

# 免构建 HTML 主页验收记录

日期：2026-09-30。Lumi/SDK 0.1.0，静态主页 format 2，bridge 1。仅接受符合当前 HTML 契约的主页。

## 自动检查

- `pnpm check`：生成契约与嵌入模板一致性、TypeScript、ESLint、52 项测试、Rust fmt/check/clippy，全部通过。
- `pnpm build`：桌面前端、Core 与 MCP 代理构建通过。官方 HTML 模板无需单独安装或构建。
- 测试覆盖三个入口文件及 manifest 的校验、拒绝缺失文件和伪造 SDK/主题文件、资源服务自动提供 SDK/主题、当前契约下的历史恢复、版本冲突、源码导出和工具调用隔离。
- AI 通过 MCP 发布主页；导出当前主页时会补充同版本 SDK、主题与知识库。未覆盖已有文件。

## 实际运行

使用隔离的 `com.lumiplug.home-verification` macOS 验证应用与独立数据目录；没有把测试主页或草稿写入用户原有 Lumi 数据。原生交互测试执行于本地导入按钮移除之前；当前发布入口为 MCP。

| 检查 | 结果 |
| --- | --- |
| 浏览器模拟预览 | 直接提供静态文件，加载官方 `index.html`；显示“本地模拟环境”，模拟创建不写入 Lumi |
| SDK 与主题 | 宿主提供 SDK 和主题文件，页面连到 Lumi 0.1.0，真实 tools/list 与主题渲染成功 |
| 真实调用 | HTML 页面创建 `html-native-qa` Terminal 草稿，宿主顶部成功气泡出现；草稿未启用或执行 |
| 隔离 | 主页运行在独立资源服务与 sandbox iframe；已有主 frame IPC 防护保留 |

## 范围

当前实测为 macOS 开发构建与本地浏览器模拟模式。Windows/Linux 原生 WebView、正式安装包和平台 sidecar 未作运行验收。Terminal/HTTP/MCP Runner、Memory、Skills 的业务执行仍在后续阶段；本次只验证已有公开能力目录和创建草稿。
