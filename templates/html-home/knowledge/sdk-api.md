<!-- SPDX-License-Identifier: MPL-2.0 -->

# 浏览器 SDK

官方 HTML 模板通过 `window.lumi` 访问当前 Lumi 的 SDK。页面中的 `lumi-sdk.js` 供直接打开本地文件时模拟预览；Lumi 运行时会提供同版本 SDK，页面无需访问 Core 地址或会话令牌。

```js
const host = await window.lumi.ready()
const context = await window.lumi.context.get()
const tools = await window.lumi.tools.list()
await window.lumi.tools.call('Lumi.create_capability_draft', { kind: 'terminal', name: 'my-project' })
await window.lumi.storage.set('greeting', '你好')
const greeting = await window.lumi.storage.get('greeting')
await window.lumi.toast.show('已完成', 'success')
```

- `ready()` 返回 `{lumiVersion,sdkVersion,bridgeVersion,projectId,mode}`。`mode` 为 `lumi` 或 `mock`；模拟模式不写入真实数据。
- `context.get()` 返回宿主版本和真实功能范围；连接后先读取。
- `capabilities.list()` 返回公开能力摘要。`tools.list()` 返回可用工具及输入输出 Schema；`tools.call(name,args)` 按这些 Schema 调用，不要猜测参数。
- `storage.get/set/delete(key)` 是按项目 ID 隔离的持久 JSON KV：最多4096键，单值256 KiB，项目合计5 MiB；原有键格式保持。版本恢复不会回滚这份数据。
- 工作台入口会在业务脚本前预载并注入 `localStorage` / `sessionStorage` 兼容层，可直接同步使用 `getItem/setItem/removeItem/clear/key/length` 和属性形式。localStorage 按项目持久化；sessionStorage 按项目与宿主窗口会话隔离，刷新保留，应用重启清空。每区域5 MiB、最多4096键、单值1 MiB、键最多1024 UTF-8字节，超限同步抛出 `QuotaExceededError`。这两个区域与上述 JSON KV 分开，clear 不会清掉其他区域。
- `await lumi.storage.flush()` 等待兼容层之前排队的写入经宿主确认。同步 setItem 只确认内存更新；需要可靠保存、立即刷新或关闭页面前应 await flush。持久化失败会拒绝 flush、保留内存和待写队列，并通过宿主顶部 Toast 及 `lumi:storage-error` 事件反馈；修复后再次 flush 可重试。异常退出或未 flush 的立即导航不能保证最后写入落盘。此方法不是原 SDK JSON KV 的批量提交，JSON KV 的 set/delete 本身应 await。
- `theme.get()` 返回深浅主题、减少动态效果状态和当前设计变量。`theme.subscribe(callback)` 订阅变化，返回取消订阅函数。SDK 自动将主题变量写入页面根元素。
- `toast.show(message,tone)` 使用 Lumi 窗口顶部气泡；`tone` 可为 `success`、`error`、`info`。
- 失败抛出 `Error`，可读取 `error.code` 与 `error.message`。连接超时或页面版本变化时应显示可重试状态。

页面不具备宿主 UI/内部运行状态、Tauri API、任意文件系统或本机服务凭据的直接访问权限。宿主功能仅通过公开 SDK 方法调用；已授权工具仍可按自身配置读写文件、联网或执行命令。页面直接联网、CDN、内联脚本等浏览器能力与宿主桥接权限分开，具体边界见 `security-and-limitations.md`。

```js
localStorage.setItem('preferences', JSON.stringify({ compact: true }))
sessionStorage.setItem('selected-tab', 'today')
await lumi.storage.flush() // 收到宿主确认后再提示“已保存”或导航
```

兼容层只注入 Lumi 工作台入口，不改写任意远程子页面或弹窗；不模拟 IndexedDB、Cookie、StorageEvent 跨文档广播或浏览器 Storage 原生品牌检查等完整底层行为。本地直接打开模板时沿用浏览器自身存储及模拟 SDK，不写入正式 Lumi 数据。
