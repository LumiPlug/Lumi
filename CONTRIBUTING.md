<!-- SPDX-License-Identifier: MPL-2.0 -->

# 贡献指南

感谢你参与 Lumi 的开发。开始前请阅读 [产品规格](docs/PRODUCT_SPEC.md)、[技术架构](docs/TECHNICAL_ARCHITECTURE.md) 和 [开发计划](docs/DEVELOPMENT_PLAN.md)。产品、架构和研发决策应先更新对应文档，再进入实现。

## 提交改动

1. 围绕一个明确的问题提交改动，并说明目的、影响与验证结果。
2. 修改实现时同步更新相关文档。
3. 涉及代码变更时运行 `pnpm check`；注明未完成的验证及原因。
4. 提交前检查文件中没有凭证、个人数据或本地构建产物。

## 贡献许可

向本项目提交并供本项目合并的原创贡献，应按 [MPL-2.0](LICENSE) 提供。贡献者保留其贡献的版权；贡献行为不要求转让版权。

请确保你有权按该许可证提交贡献。引入第三方代码或资源时，应保留其原有许可和版权通知，并说明来源及许可条件。

新增源码和构建脚本请使用适合该文件语法的 SPDX 许可注释，例如：

```ts
// SPDX-License-Identifier: MPL-2.0
```

CSS 使用 `/* SPDX-License-Identifier: MPL-2.0 */`，HTML、SVG 和 Markdown 使用 `<!-- SPDX-License-Identifier: MPL-2.0 -->`，YAML 和 TOML 使用 `# SPDX-License-Identifier: MPL-2.0`。包含 shebang 的脚本在 shebang 后放置许可注释；JSON 等不支持注释的格式由根目录 `LICENSE` 和 [许可与品牌说明](docs/LICENSING.md) 覆盖。
