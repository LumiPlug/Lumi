<!-- SPDX-License-Identifier: MPL-2.0 -->

# 运行弹窗两节点调整（2026-10-06）

- 删除结果节点，将参数配置简化为配置；运行节点在执行中及终态保持展开。
- 共用 LogViewer 默认自动置底。首次展示、文本更新、视口 ResizeObserver 通知均滚动到日志底部；手动上翻不会关闭后续输出的自动置底。保持内部滚动、行号和 240px 高度，不移动焦点。
- Terminal 终态不重复日志，保留 stdout/stderr、耗时、退出码和复制输出；HTTP/MCP 的最终响应加入同一日志区，仅终态显示。失败沿用运行节点标记。
- 共用 UI组件预览同步两节点及追加日志按钮，规范同步至 UI_COMPONENTS、UI_DESIGN、TOOLS_DESIGN。

## 验证

- pnpm check 通过：19 个文件、140 项测试，含 TypeScript、ESLint、前后端测试与 Rust 格式/检查/Clippy。
- pnpm build:frontend 通过；沿用已有构建块大小提示。
- CUA + 隔离真实 Core 服务，验证 360 行持续输出；新输出后距日志底部 0px，焦点仍在 body。
- 1120×820 与 720×560：恰好两个节点，日志 240px，页面无横向溢出，改变视口后距底部 0px。
- 实际 exit 2 任务：81 行输出保持展开，stdout/stderr 不重复，运行红色失败标记，日志停在末尾。
- 真实 HTTP 返回 JSON：执行事件与最终响应均可读，运行成功绿色标记，没有结果节点。
- 浏览器及临时 IPC/Core 服务已关闭，临时脚本和 HTML 已清理；开发服务继续运行。

截图：running-desktop.png、running-minimum.png、completed-minimum.png、http-completed.png。
