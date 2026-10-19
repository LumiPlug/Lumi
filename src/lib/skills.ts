// SPDX-License-Identifier: MPL-2.0
import { t, getLocale } from '../i18n'

import type { InstalledSkill } from '@lumiplug/shared'
import { normalizeSkillTimestamp } from '@lumiplug/shared'

export interface MarketSkill {
  id: string
  name: string
  description: string
  publisher: string
  url: string
}

// A small, curated source directory; this is not a live marketplace feed.
export const marketSkills: MarketSkill[] = [
  {
    id: 'openai-docs',
    name: 'openai-docs',
    get description() {
      return t('查询 OpenAI 产品和 API 的官方文档，帮助理解接口、配置与使用方法。')
    },
    publisher: 'OpenAI',
    url: 'https://github.com/openai/skills/tree/main/skills/.curated/openai-docs',
  },
  {
    id: 'openai-pdf',
    name: 'pdf',
    get description() {
      return t('读取、创建和检查 PDF，结合页面渲染验证文档的视觉布局。')
    },
    publisher: 'OpenAI',
    url: 'https://github.com/openai/skills/tree/main/skills/.curated/pdf',
  },
  {
    id: 'anthropic-frontend-design',
    name: 'frontend-design',
    get description() {
      return t('设计并实现前端页面与组件，注重视觉表达和可交付的界面质量。')
    },
    publisher: 'Anthropic',
    url: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
  },
  {
    id: 'anthropic-skill-creator',
    name: 'skill-creator',
    get description() {
      return t('创建和改进技能，设计测试用例并评估技能的触发与执行效果。')
    },
    publisher: 'Anthropic',
    url: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator',
  },
]

export function filterInstalledSkills(
  skills: InstalledSkill[],
  query: string,
  client: string,
): InstalledSkill[] {
  const needle = query.trim().toLocaleLowerCase()
  return skills.filter(
    (skill) =>
      (client === 'all' ||
        (client === 'Lumi'
          ? skill.managed === true
          : skill.sources.some((source) => source.client === client))) &&
      (!needle ||
        [
          skill.name,
          skill.description,
          skill.path,
          ...skill.sources.flatMap((source) => [source.client, source.path]),
        ]
          .join('\n')
          .toLocaleLowerCase()
          .includes(needle)),
  )
}

export function displaySkillPath(filePath: string): string {
  return filePath.replace(
    /^\/Users\/[^/]+(?=\/)|^\/home\/[^/]+(?=\/)|^[A-Za-z]:\\Users\\[^\\]+(?=\\)/,
    '~',
  )
}

export function skillAddedTime(skill: Pick<InstalledSkill, 'fileCreatedAt' | 'firstSeenAt'>): {
  dateTime: string | null
  text: string
  description: string
} {
  for (const [value, label, source] of [
    [skill.fileCreatedAt, t('添加于'), t('SKILL.md 文件创建时间')],
    [skill.firstSeenAt, t('首次发现'), t('Lumi 首次发现时间，文件创建时间未知')],
  ] as const) {
    const timestamp = normalizeSkillTimestamp(value)
    if (!timestamp) continue
    const date = new Date(timestamp)
    const formatted = new Intl.DateTimeFormat(getLocale(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(date)
      .replaceAll('/', '-')
    return {
      dateTime: date.toISOString(),
      text: `${label} ${formatted}`,
      description: t('{v0}（本机时区）', { v0: source }),
    }
  }
  return {
    dateTime: null,
    text: t('添加时间未知'),
    description: t('文件创建时间与 Lumi 首次发现时间均未知'),
  }
}

export function skillClientOptions(
  clients: string[],
  selected: string,
): { value: string; label: string }[] {
  const options = [...new Set(clients)].sort().map((client) => ({ value: client, label: client }))
  if (selected !== 'all' && !clients.includes(selected)) {
    options.unshift({ value: selected, label: t('{v0}（暂无技能）', { v0: selected }) })
  }
  return options
}

export function skillProjectFailure(error: unknown): { fieldError: boolean; message: string } {
  const code = error instanceof Error ? error.message : error
  return code === 'invalid_skill_project'
    ? { fieldError: true, message: t('无法添加项目，请检查完整路径、目录权限及项目数量上限') }
    : { fieldError: false, message: t('项目扫描未完成，请检查 Core 连接后重试') }
}

export function skillImportFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : error
  const messages: Record<string, string> = {
    skill_import_invalid: t('请选择包含有效 SKILL.md（名称和描述）的完整本地目录'),
    skill_already_imported: t('此技能已经导入 Lumi，已有副本未被覆盖'),
    skill_import_link: t('技能包含链接或特殊文件，请先整理为独立的普通文件目录'),
    skill_import_limit: t('技能超过 2000 项、12 层或 32 MiB，请移除大文件或依赖后重试'),
    skill_import_host_required: t('导入需要 Lumi 桌面宿主，请重新启动 Lumi 后重试'),
    skill_source_changed: t('技能源目录已变化，请重新扫描后再导入'),
    skill_not_found: t('技能记录已失效，请重新扫描后再导入'),
  }
  return typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code]!
    : t('导入失败，请检查目录权限和 Core 连接后重试')
}

export function skillSourceKey(client: string): string {
  const sources: Record<string, string> = {
    Codex: 'codex',
    'Claude Code': 'claude',
    Qoder: 'qoder',
    QoderWork: 'qoderwork',
    Cursor: 'cursor',
    'Gemini CLI': 'gemini',
    OpenAI: 'openai',
    Anthropic: 'claude',
  }
  return Object.hasOwn(sources, client) ? sources[client]! : 'other'
}
