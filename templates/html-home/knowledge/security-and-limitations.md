<!-- SPDX-License-Identifier: MPL-2.0 -->

# 运行边界

主页静态资源由 Lumi 的独立 loopback 服务加载到 `sandbox="allow-scripts"` iframe。页面没有同源宿主权限，不可直接访问 Tauri、Core、MCP 凭据或父页面 DOM；仅能通过版本匹配的 `window.lumi` 调用受限接口。SDK 从 Lumi 当前版本提供，不接收用户工程里的同名运行脚本。

内容安全策略禁止外部网络连接、CDN、内联脚本、顶层导航和弹窗。将 JavaScript 放进外部 `app.js`（或其他相对路径 `.js` 文件），CSS 放进 `style.css`。图片和字体使用相对路径；不要依赖远程包或浏览器扩展。iframe 隔离不保证独立进程或抵抗恶意死循环。

本地直接打开模板使用明确标记的模拟模式，工具调用与存储不写入 Lumi。实际功能以 `context.get()` 和 `tools.list()` 为准；已启用的 Terminal/HTTP/MCP 工具可产生真实执行效果，Memory、Skills 等尚未接入的操作会明确失败。项目源码与构建包按版本保存，恢复页面不会恢复项目 KV。
