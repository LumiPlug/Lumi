<!-- SPDX-License-Identifier: MPL-2.0 -->

# 原生 WebView 存储验证 · 2026-10-19

macOS arm64，Lumi 0.1.4 Tauri debug 应用包，内嵌生产前端与独立 Node SEA Core。使用独立应用标识、数据库、随机 loopback 端口和合成工作台；未向用户原有工作台写入测试内容。由实际 WKWebView 执行测试并回传断言，原生无障碍树和截图确认最终“全部通过”。

## 结果

| 范围 | 实际验证 | 结果 |
| --- | --- | --- |
| 注入顺序 | 首个业务脚本同步读取预载 localStorage；iframe 刷新首脚本读取 sessionStorage | 通过 |
| localStorage | set/get、属性写入、removeItem；含中文和 NUL 的大值；iframe 自刷新及应用和 Core 重启后保留 | 通过 |
| sessionStorage | 当前窗口刷新保留，clear 后为空，应用和 Core 重启清空 | 通过 |
| flush | 正常写入确认；模拟 SQLite 写入失败时拒绝；内存值和未保存队列保留；去除故障后重试成功，重启后值存在 | 通过 |
| 配额 | 超过单值限额同步抛出 QuotaExceededError | 通过 |
| SDK KV | lumi.storage JSON 值与浏览器 Storage 命名空间独立 | 通过 |
| 隔离 | iframe 无法读取 parent.document 和宿主 nonce | 通过 |

原生验证首次发现 iframe 自行刷新后不能重新握手。已增加每文档随机 ID，关闭旧 MessagePort，允许新文档重新连接，并将异步回包限定在原通道。修复后重新打包，完整三阶段（首次加载→iframe 刷新与故障重试→应用和 Core 重启）通过。新增宿主通道和 SDK 握手回归测试。

`pnpm check` 全部通过：54 个测试文件、424 项测试，契约、类型、lint、Rust fmt/check/clippy 均通过。默认应用标识构建复用同一前端和 SEA 产物，已更新并启动 `/Applications/Lumi.app`；Core 健康检查为 ok，原生截图确认原有“个人工作台”正常显示且已连接 Lumi 0.1.4。旧应用包已备份至 `.impeccable/native-storage-20261019/Previous-Lumi.app`，原有主页未替换为测试页。

证据：[原生断言记录](results.json)、[WKWebView 最终截图](wkwebview-storage.png)。WKWebView 在 Apple Silicon 上返回兼容用的 MacIntel/Intel UA，不代表本次运行硬件是 Intel。

本次覆盖 macOS WKWebView；Windows WebView2 未实机验证。尚未 flush 的立即导航或异常退出仍不保证最后写入保存；本轮不覆盖完整原生 Storage 品牌检查、跨文档 StorageEvent、IndexedDB 或 Cookie。
