<!-- SPDX-License-Identifier: MPL-2.0 -->

# 静态文件交付与版本

`lumiVersion` 与 `sdkVersion` 是工程创建时的发布信息，不要求与当前应用一致。Lumi 升级后，format／template／entry 与 bridge 契约相同的主页可直接加载、继续发布、导出和恢复；保留原清单与 projectId，无需为匹配应用发布号重新发布。

根目录必要文件：`index.html`、`app.js`、`style.css`。`index.html` 是入口，可以加载其他同目录或子目录静态资源；使用相对 URL（`./`），不要引用开发服务器、CDN 或绝对磁盘路径。其他框架可由 AI 在其环境中开发，但交给 Lumi 的输出必须是包含这三个文件的静态目录，不要求用户安装 Node。

通过 Lumi MCP 发布标准包 `manifest/files/sourceFiles`。工程导出包含 `lumi.home.json`、官方 SDK 预览文件、主题和知识库；这四者可由 Lumi 提供。更新同一主页时保持 `projectId` 不变。

外部 AI 通过 MCP 发布时，先调用 `Lumi.get_workbench` 读取 `expectedVersion` 和已有源码；首次可调用 `Lumi.get_workbench_template`。发布对象包含 `manifest`、运行文件 `files` 和可恢复的 `sourceFiles`，文本文件使用 `encoding: "utf8"`，二进制资源使用 `encoding: "base64"`。`sourceFiles` 至少包含三个入口文件和与 manifest 相同的 `lumi.home.json`；`files` 至少包含三个入口文件，不需要带 `lumi-sdk.js`，Lumi 会提供它。文件路径为相对 POSIX 路径。版本冲突先合并，不强制覆盖。

限制：最多 512 文件，单文件 4 MiB，运行文件与源码解码后合计 16 MiB，请求 JSON 最大 24 MiB。不得包含 `..`、绝对路径、重复路径、符号链接或隐藏配置。仅可恢复符合当前 HTML 契约的历史版本；恢复会生成新版本，项目 KV 保持当前数据。
