<!-- SPDX-License-Identifier: MPL-2.0 -->

# 能力与工具模型

Lumi 的 Core 是业务数据源。主页 SDK 与外部 AI 的 MCP 连接使用同一 CapabilityRegistry。页面先用 `window.lumi.context.get()` 看当前范围，再用 `capabilities.list()` 看公开目录、`tools.list()` 看实际工具和参数 Schema。

当前可读取上下文和能力摘要，并可调用 `Lumi.create_capability_draft` 保存未启用草稿。草稿不能从主页自行启用或执行；用户在 Lumi 中审阅。已授权的 Terminal／HTTP／上游 MCP 操作与手动入口共用 Registry；Terminal 后台 start 返回 taskId，普通调用等待结果。通过 `Lumi.list_tasks/get_task/stop_task/restart_task` 查看、停止或重新运行任务，重新运行会再次产生真实效果。结果和有限日志经裁剪与脱敏，原始私密配置不进入页面。

管理主页发布、恢复、目录导出等属于宿主和外部 AI 的管理流程，不开放给 iframe 页面。页面不能猜测内部数据库、令牌或 Runner 参数；工具目录变化后重新读取 `tools.list()`。
