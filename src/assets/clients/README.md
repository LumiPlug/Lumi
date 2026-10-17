<!-- SPDX-License-Identifier: MPL-2.0 -->

# 软件 Logo

以下 SVG 来自 [SVGL](https://github.com/pheralb/svgl)，保留同目录 MIT LICENSE；软件名称和图形商标归各自权利方所有。仅用于标识本地用量来源，`logos.ts` 仅提取 SVG 的 viewBox 与 path 属性，在共用图标样式下随主题文字色显示，避免 macOS WebView 对外部 SVG 遮罩的兼容问题。

- `codex.svg`: `static/library/codex_dark.svg`
- `claude.svg`: `static/library/claude-ai-icon.svg`
- `cursor.svg`: `static/library/cursor_dark.svg`

新增工具标识复用 CodeBurn Windows/macOS 的模板图标与确定性 sigil（固定提交 `9a40cc6` 的 `windows/src/providerIcons.tsx`），MIT 许可保留为 `CODEBURN-LICENSE`。上游无品牌图标时使用其相同的稳定标识，不请求远程图片。
