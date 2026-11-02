<!-- SPDX-License-Identifier: MPL-2.0 -->

# Browser User 集成边界

用户于 2026-11-02 确认：LumiBrowserMCP 仅交付通用 Chrome 扩展；本地连接、注册和 MCP 能力由 Lumi 软件提供。Lumi 设置新增 **Browser User**，沿用现有 UI 组件，不另做独立适配器安装产品。

## 链路与授权

本地 Agent → 现有 Lumi MCP（HTTP 或已有 stdio proxy）→ Core BrowserService → 本机 IPC → 随 Lumi 分发的 Native Messaging host → 用户授权的扩展标签页 → CDP。

- 不新增第二个 MCP server、桌面程序、托盘或自动启动后台 broker。Native host 只能连接已经运行且已启用 Browser User 的 Core。
- 默认关闭。在设置中由用户确认扩展 ID 与用户级 Native Messaging 注册后启用；MCP 工具不能启用、注册或授予标签页权限。
- 启用偏好保存在 Lumi 用户目录。Core 重启可恢复已同意的服务设置，但不恢复网页授权；需用户重新在扩展授权。
- 现有 Lumi MCP 是共享凭据、无状态 HTTP。首版明确采用 **同一个 Lumi 控制域**：所有工具操作串行，共享已授权会话，**不是多 Agent 身份隔离**。不得以 HTTP 请求 ID 或每次请求生命周期伪造客户端身份。
- 停用、移除、Core 关闭会中断 native host 并撤销标签页会话。已送达 Chrome 的输入无法撤回；不确定结果标记 `outcome_unknown`，禁止自动重放。
- 注册修复和移除必须通过主窗口宿主认证与用户确认；不得通过公共 MCP token 调用。只清理本项目注册和定位文件，不删除其他客户端配置。

## 状态与验证

设置分别显示服务启用、Native Host 注册与文件路径、扩展连接和授权标签页。注册成功不等于已连接；无连接不显示完整可用。应用升级或移动导致路径不一致时报告需修复，不偷偷修改系统注册。

自动测试覆盖服务队列、取消、断线、协议上限、权限边界、设置动作及平台包构建。真实 Windows/macOS Chrome、系统鼠标/前台、125%和多显示器由用户实机验收，不能以 CI 替代。

## 迁移与开发版验证

已有独立 LumiBrowserMCP adapter 预览安装时，同名 Native Host 会被识别为其他安装，不覆盖。先退出旧 MCP 客户端，使用旧版自带卸载脚本移除旧宿主，再在 Lumi 设置的 Browser User 中确认注册；不需要把独立 adapter MCP 配置继续保留为新链路。新链路使用已有 Lumi MCP 接入方式，不新增客户端配置入口。

开发预览分发仍为 macOS ad-hoc / Windows 未发布者签名；不得绕过系统警告。应用移除前在 Browser User 选择“移除连接”，尤其 macOS 拖入废纸篓没有可靠自动清理回调。移除只清本项目 Native Host/定位文件，保留扩展和浏览器数据。

本地已运行类型检查、lint、首页契约检查、全套测试和前端/Core生产构建。云端 Unix socket 权限使真实 OS IPC 集成测试明确跳过；CI 不允许此跳过，必须验证 HTTP MCP → Core → 本机 IPC → Native Host → 模拟扩展帧。模拟扩展不是实际 Chrome。完整平台包、Rust 检查/测试及当前精确 commit CI 以 PR 验证结果为准；本机无 Rust 工具链，不声称本机原生构建通过。
