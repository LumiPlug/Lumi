// SPDX-License-Identifier: MPL-2.0
export const HOME_ERRORS: Record<string, string> = {
  invalid_home_bundle: '主页包格式无效，请检查 index.html、app.js、style.css 与版本信息。',
  invalid_home_path: '主页包包含无效或重复路径，请重新构建。',
  home_bundle_too_large: '主页包超过大小限制：最多512文件、单文件4MiB、合计16MiB。',
  home_source_missing: '主页包缺少三个入口文件或可恢复的工程信息。',
  home_version_incompatible: '主页工程版本与当前 Lumi 不一致，请使用当前版本的官方 HTML 模板。',
  workbench_version_conflict: '主页已被更新，请取回最新源码并合并后重试。',
  workbench_version_missing: '指定主页版本不存在，请刷新版本列表。',
  workbench_unavailable: '主页服务暂不可用，请保持 Lumi 运行后重试。',
  workbench_instance_expired: '主页版本已变化，请等待新页面加载后重试。',
  invalid_workbench_state:
    '页面数据无效：每值32KiB、最多128键，键使用英文、数字、点、下划线或短横线。',
  invalid_export_directory: '请输入导出目录的完整绝对路径。',
  export_directory_not_empty: '导出目录不是空目录，请选择新建或空目录。',
  method_unavailable: '页面不能调用此管理方法，请使用公开 SDK 接口。',
  invalid_tool_arguments: '工具参数不符合公开 Schema，请检查必填字段与类型。',
  ai_tool_not_found_or_disabled: '工具不存在或已禁用，请刷新工具目录。',
  reserved_tool_namespace: 'Lumi 为保留命名空间，请选择其他命名空间。',
  capability_draft_invalid: '草稿未能保存，请检查名称与命名空间。',
  public_tool_schema_invalid: '工具 Schema 不可用，请检查能力配置。',
  runner_execution_not_implemented_until_m4_m6: '当前版本尚未接入此工具的执行器，操作未执行。',
}
