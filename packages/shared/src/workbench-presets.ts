// SPDX-License-Identifier: MPL-2.0

export const WORKBENCH_PRESETS = [
  {
    id: 'office',
    label: '通用办公',
    description: '安排重点、整理资料与汇总工作',
    title: '把今天的工作安排好',
    introduction: '记录要做的事，把常用操作放在一起，随时查看真实执行结果。',
    todoTitle: '今日重点',
    todoPlaceholder: '添加今天要推进的一件事',
    workflows: [
      {
        id: 'organize',
        title: '整理资料',
        description: '绑定文件整理或资料检索工具，减少手动查找。',
      },
      {
        id: 'summarize',
        title: '汇总工作',
        description: '绑定已有的工作汇总工具，读取实际资料并生成结果。',
      },
      { id: 'routine', title: '日常操作', description: '把经常使用的一项办公操作留在这里。' },
    ],
  },
  {
    id: 'developer',
    label: '开发者',
    description: '推进任务、检查项目与运行开发工具',
    title: '从下一项开发任务开始',
    introduction: '集中开发待办与常用检查，用真实运行结果确认进展。',
    todoTitle: '开发待办',
    todoPlaceholder: '添加要修复的问题或推进的功能',
    workflows: [
      {
        id: 'inspect',
        title: '检查项目',
        description: '绑定项目状态或代码检查工具，查看当前项目情况。',
      },
      { id: 'verify', title: '运行验证', description: '绑定已配置的测试、构建或验证操作。' },
      {
        id: 'routine',
        title: '开发操作',
        description: '集中你常用的 Terminal、HTTP 或 MCP 操作。',
      },
    ],
  },
  {
    id: 'creator',
    label: '内容创作',
    description: '管理选题、整理素材与处理内容',
    title: '把想法推进成作品',
    introduction: '记录选题与制作任务，连接已有素材和内容工具，留下真实产出。',
    todoTitle: '创作计划',
    todoPlaceholder: '添加一个选题或制作任务',
    workflows: [
      {
        id: 'research',
        title: '查找素材',
        description: '绑定素材检索或资料收集工具，为创作准备材料。',
      },
      { id: 'process', title: '处理内容', description: '绑定已有的文本、图片或其他内容处理工具。' },
      {
        id: 'routine',
        title: '创作操作',
        description: '把常用的内容处理流程放在这里，运行后查看产出。',
      },
    ],
  },
] as const

export type WorkbenchPresetId = (typeof WORKBENCH_PRESETS)[number]['id']
export function isWorkbenchPresetId(value: unknown): value is WorkbenchPresetId {
  return WORKBENCH_PRESETS.some((preset) => preset.id === value)
}
