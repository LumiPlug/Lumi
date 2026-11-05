<!-- SPDX-License-Identifier: MPL-2.0 -->

# 运行边界

主页静态资源由 Lumi 的独立 loopback 服务加载到开放浏览器能力的 iframe。页面可运行脚本、提交表单、下载、打开继承沙盒的弹窗、嵌套页面，以及请求指针锁定、方向锁定和演示等功能。iframe 与资源响应共用同一权限策略，不再仅允许脚本。

内容安全策略允许 HTTP(S)/WebSocket 网络请求、CDN、外部脚本与样式、内联脚本、动态求值、Worker、图片、字体及音视频。仍建议将工程入口放进 `app.js`/`style.css` 并优先使用包内相对资源，便于离线使用；外部服务、模块和字体须满足 CORS，当前 iframe 请求的 Origin 为 `null`，Lumi 不绕过服务端跨域规则。全屏、剪贴板、音视频、定位等浏览器权限已委派，实际可用性仍取决于系统 WebView、用户手势、浏览器/系统授权及 API 的 origin 要求，不代表静默授予系统权限。

宿主隔离仍有效：页面保持 opaque origin，不开放 `allow-same-origin`、顶层导航或弹窗逃逸；页面、子页面和弹窗不能借同源访问宿主 UI、内部运行状态、父页面 DOM、Tauri API 或 Core/MCP 凭据。工作台入口的 localStorage/sessionStorage 由受控注入的兼容层提供，同步预载项目/窗口会话数据并异步桥接保存，可用 `await lumi.storage.flush()` 等待确认；不共享宿主存储，不开放其他项目或任意数据库键。Cookie、IndexedDB 及依赖非 opaque origin 的部分设备 API 仍可能不可用。兼容层与 `window.lumi.storage` 的 JSON KV 隔离，具体容量与写入确认语义见 `sdk-api.md`。仅通过兼容桥接协议的 `window.lumi` 访问公开接口和已授权工具；公开版本/功能契约、主题和工具任务结果按 SDK 提供。SDK 由当前宿主提供，不接收用户工程里的同名运行脚本；应用及 SDK 发布号变化不影响同契约主页的加载。iframe 隔离不保证独立进程或抵抗恶意死循环。

本地直接打开模板使用明确标记的模拟模式，工具调用与存储不写入 Lumi。实际功能以 `context.get()` 和 `tools.list()` 为准；已启用的 Terminal/HTTP/MCP 工具可产生真实执行效果，工具按其配置及运行账户权限执行，不受页面的浏览器沙盒约束。Memory、Skills 等尚未接入的操作会明确失败。项目源码与构建包按版本保存，恢复页面不会恢复项目 KV。
