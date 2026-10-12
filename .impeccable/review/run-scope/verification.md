<!-- SPDX-License-Identifier: MPL-2.0 -->
# 运行弹窗分类型编辑范围与查看参数

日期：2026-10-07。

## 实现

- Terminal 只展示已有外部参数值。工作目录、Shell、命令与环境变量在完整查看参数中只读展示。
- HTTP 请求方式和地址只读，已有请求头、请求参数、固定正文参数值可编辑。请求头名称只读，无新增/删除按钮。
- MCP 地址和本次工具只读，仅已有请求头值可编辑。调用参数来自当前工具预设。
- 底栏查看参数始终可访问，共用 Modal 和只读 Textarea 显示全部工具定义、本次操作与最新参数。未完成的 JSON 编辑也列入预览；执行后有效参数来自冻结快照。
- 沿用配置/运行节点、独立日志及结果区、复制及重新运行保留输入。

## 浏览器及真实执行验证

CUA 使用隔离真实 Core，HTTP 本地服务及 MCP SDK 上游；没有改动用户工具或数据。

- Terminal 修改 TEXT 与 COUNT=0：预览包含最新值和完整 Shell/Schema，Textarea readOnly；Escape 返回查看参数按钮，后台保留一个主弹窗。执行输出为修改值，重新运行保留输入并清空日志。
- HTTP 请求方式、URL、请求头名称 readOnly；请求头最新值、正文 message、query 修改后均出现在完整预览和实际请求中。固定正文参数不显示新增入口。运行仍为 POST 与原 /api 目标。
- 未完成正文 JSON 的原始编辑文本出现在只读预览的未完成编辑字段，修正后可继续运行。
- MCP 地址和本次工具 readOnly，选择框数量 0，无调用参数编辑入口；修改的请求头在真实 MCP 连接中收到，结果为既有预设内容。执行后查看参数仍包含正确预设快照。
- HTTP/MCP 的 720×560 布局无页面横向溢出，嵌套查看参数可关闭，输入不会丢失。
- 三次实际运行，所有原始工具定义完全未变。真实请求摘要见 execution-evidence.json。

自动验证：pnpm check（19 文件、145 测试，类型、Lint、Rust 格式/检查/Clippy）与 pnpm build:frontend。构建保留原有体积提示。

截图：terminal-desktop.png、terminal-preview.png、http-desktop.png、http-preview-desktop.png、http-minimum.png、http-preview-minimum.png、mcp-desktop.png、mcp-preview-desktop.png、mcp-minimum.png、mcp-preview-minimum.png。
临时浏览器与 Core/IPC/上游服务、测试源文件已关闭清理，截图和验证摘要保留。
