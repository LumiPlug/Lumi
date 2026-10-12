<!-- SPDX-License-Identifier: MPL-2.0 -->

# 重新运行重置交互（2026-10-06）

终态弹窗仅提供共用 primary Button“重新运行”。点击后解除任务 ID 和提交任务关联，清除快照、预检、错误与展开状态；配置恢复当前黄圆，运行恢复未开始灰圈，运行日志、耗时、退出信息、复制状态均移除。本次操作与输入状态保留，正文返回顶部并聚焦配置。再次点击“运行”才提交新任务。

## 验证

- pnpm check 通过：19 个测试文件、140 项测试；类型检查、Lint、Rust 格式/检查/Clippy 全部通过。
- pnpm build:frontend 通过，保留已有构建块大小提示。
- CUA + 隔离真实 Core：填写字符串、覆盖默认值、false、0 后执行到 exit 2；终态只显示重新运行，重置后四项值完全保留，配置/运行标记为 current/pending，日志 DOM 数量 0，退出与错误详情不再存在，聚焦 TEXT。
- 重置后经过任务刷新旧日志未重新出现；服务端 run 请求仍为 1、restart 为 0、历史任务为 1，证明重置不触发执行或删除历史。
- 再次主动运行后 run 请求为 2、restart 为 0、两个任务 ID 不同；重复重置仍保留配置并清空运行内容。
- 1120×820、720×560 验证，无横向页面溢出。
- 临时浏览器和 Core/IPC 已关闭，测试脚本、HTML 和 fixture JSON 已清理。

截图：finished-desktop.png、reset-desktop.png、finished-minimum.png、reset-minimum.png。
