<!-- SPDX-License-Identifier: MPL-2.0 -->

# 外部 AI 开发流程

1. 调用 `Lumi.get_context`、`Lumi.get_workbench`，确认版本、功能、当前主页源码和 `expectedVersion`。首次开发再取 `Lumi.get_workbench_template`。
2. 阅读 `LUMI_DEVELOPMENT.md` 和知识库，根据用户要求自由编写 HTML、CSS、JavaScript。固定根目录三个文件与 SDK 协议；可增加组件、图片、字体、脚本，最终均须为离线静态资源。
3. 调用 `Lumi.list_capabilities`、`tools/list` 读取真实功能及参数 Schema。页面通过 `window.lumi` 访问公开 SDK；未实现的 Runner 不应模拟成功。
4. 构造标准 `manifest/files/sourceFiles`，以已读取的 `expectedVersion` 调用 `Lumi.publish_workbench`。模拟预览不代表真实业务验证。
5. 在 Lumi 内验证加载、主题、焦点、气泡及数据。冲突时重新取回源码合并。

工程协议不匹配时，获取当前 Lumi 的 HTML 模板重新开发。发布前确认根目录三个入口文件与 SDK 协议版本正确。
