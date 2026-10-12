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
- `storage.get/set/delete(key)` 是按项目 ID 隔离的持久 KV：最多 128 键，单值最多 32 KiB。版本恢复不会回滚这份数据。
- `theme.get()` 返回深浅主题、减少动态效果状态和当前设计变量。`theme.subscribe(callback)` 订阅变化，返回取消订阅函数。SDK 自动将主题变量写入页面根元素。
- `toast.show(message,tone)` 使用 Lumi 窗口顶部气泡；`tone` 可为 `success`、`error`、`info`。
- 失败抛出 `Error`，可读取 `error.code` 与 `error.message`。连接超时或页面版本变化时应显示可重试状态。

页面不具备宿主 Tauri API、任意文件系统或本机服务凭据访问。仅允许公开 SDK 方法。
