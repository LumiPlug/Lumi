<!-- SPDX-License-Identifier: MPL-2.0 -->
# 工具运行配置和双输出区域验证

2026-10-06：配置阶段允许编辑执行目录、命令、公开参数和固定参数值。仅进入当前手动任务及同会话重放快照；工具定义、AI 公开参数和原授权保持不变。重新运行保留配置并清空运行内容。

- 共用 LogViewer：日志区 240px，结果区 200px；固定标题行右上角各有 Copy IconButton，正文独立滚动。日志带行号、随输出置底，结果等待终态、静态阅读不自动置底、长行换行，无耗时及事件时间显示。
- 隔离真实 Core + CUA：编辑目录为 /tmp、修改 Shell 命令、TEXT=本次参数、固定 SECRET 值后运行；请求包含修改的设置与固定参数，真实输出为 TEXT=本次参数；原定义完全一致。
- 运行态两个区域存在，结果为空等待；长日志区域自动置底（scrollTop 1931、scrollHeight 2124、clientHeight 193）。终态结果生成，两区域高度保持。
- 独立滚动：结果 End 后 scrollTop 从 0 到 3714，日志 scrollTop 3632 保持不变。两者 scrollHeight 分别 3825/3867。
- 复制结果包含最终文本与退出码，复制日志不包含退出码、不包含行号；两处独立顶部 Toast 成功反馈。
- 720×560 无页面横向溢出；重新运行后目录、命令、TEXT 和固定值保留，全部输入未禁用，运行视口 DOM 数量归零，节点恢复配置/未开始。
- 后端测试覆盖 Terminal/HTTP/MCP 配置覆盖真实生效、设置不会写回原定义、秘密值继续脱敏、MCP 分离连接、同会话重放、AI 覆盖拒绝、版本冲突、错误参数与目录定位。
- pnpm check：19 个文件、142 项测试通过，类型/Lint/Rust 格式、检查和 Clippy 通过。pnpm build:frontend 通过；保留原有打包块大小提示。

截图：config-desktop.png、running-desktop.png、finished-desktop.png、finished-minimum.png、reset-minimum.png。
临时浏览器、Core/IPC 服务与测试源文件清理，截图保留供评审。
