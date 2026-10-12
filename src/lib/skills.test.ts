// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest'
import type { InstalledSkill } from '@lumiplug/shared'
import { normalizeSkillTimestamp } from '@lumiplug/shared'
import {
  displaySkillPath,
  filterInstalledSkills,
  skillAddedTime,
  skillClientOptions,
  skillProjectFailure,
} from './skills'

const skill: InstalledSkill = {
  id: 'skill',
  name: 'PDF',
  description: 'Read documents',
  path: '/Users/example/.codex/skills/pdf/SKILL.md',
  sources: [
    {
      client: 'Codex',
      scope: 'personal',
      root: '/Users/example/.codex/skills',
      path: '/Users/example/.codex/skills/pdf/SKILL.md',
    },
  ],
  metadataValid: true,
  present: true,
  archived: false,
  firstSeenAt: null,
  fileCreatedAt: null,
}
describe('Skills list filters', () => {
  it('matches names, descriptions and paths without case sensitivity and intersects the client filter', () => {
    expect(filterInstalledSkills([skill], ' pdf ', 'all')).toEqual([skill])
    expect(filterInstalledSkills([skill], 'documents', 'Codex')).toEqual([skill])
    expect(filterInstalledSkills([skill], '.codex/skills', 'Codex')).toEqual([skill])
    expect(filterInstalledSkills([skill], 'pdf', 'Qoder')).toEqual([])
    expect(filterInstalledSkills([skill], 'missing', 'all')).toEqual([])
  })
  it('preserves inventory date order through search, source and archived filtering', () => {
    const newer = { ...skill, id: 'newer', name: 'Z newer', fileCreatedAt: '2026-10-10T02:00:00Z' }
    const older = { ...skill, id: 'older', name: 'A older', fileCreatedAt: '2026-10-09T02:00:00Z' }
    const inventory = [newer, older, skill]
    for (const client of ['all', 'Codex']) {
      expect(filterInstalledSkills(inventory, 'documents', client)).toEqual(inventory)
      const archived = inventory.map((item) => ({ ...item, archived: true }))
      expect(filterInstalledSkills(archived, '', client)).toEqual(archived)
    }
  })
  it('shortens common home paths for display only', () => {
    expect(displaySkillPath(skill.path)).toBe('~/.codex/skills/pdf/SKILL.md')
    expect(displaySkillPath('/home/example/.claude/skills')).toBe('~/.claude/skills')
    expect(displaySkillPath('C:\\Users\\example\\.qoder\\skills')).toBe('~\\.qoder\\skills')
    expect(displaySkillPath('/workspace/project/.agents/skills')).toBe(
      '/workspace/project/.agents/skills',
    )
  })
})

describe('Skill card added time', () => {
  it('shows file creation time ahead of discovery time in the local timezone', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    try {
      expect(
        skillAddedTime({
          fileCreatedAt: '2026-10-09T17:03:00Z',
          firstSeenAt: '2026-10-10T10:00:00Z',
        }),
      ).toEqual({
        dateTime: '2026-10-09T17:03:00.000Z',
        text: '添加于 2026-10-10 01:03',
        description: 'SKILL.md 文件创建时间（本机时区）',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('labels discovery fallback explicitly when the file creation time is absent or invalid', () => {
    for (const fileCreatedAt of [null, 'invalid', '1970-01-01T00:00:00Z', '1970-01-01T00:00:01Z']) {
      const added = skillAddedTime({
        fileCreatedAt,
        firstSeenAt: '2026-10-08T13:45:00+08:00',
      })
      expect(added.dateTime).toBe('2026-10-08T05:45:00.000Z')
      expect(added.text).toMatch(/^首次发现 /)
      expect(added.description).toContain('文件创建时间未知')
    }
  })

  it('keeps unknown dates explicit and avoids invalid time elements', () => {
    for (const firstSeenAt of [null, 'invalid', '1970-01-01T00:00:01Z'])
      expect(skillAddedTime({ fileCreatedAt: '1970-01-01T00:00:01Z', firstSeenAt })).toMatchObject({
        dateTime: null,
        text: '添加时间未知',
      })
  })
})

it('rejects observed epoch placeholders without inventing a general age cutoff', () => {
  for (const value of [undefined, null, '', 'invalid', -1, 0, 1, 999, 1000, NaN, Infinity])
    expect(normalizeSkillTimestamp(value)).toBeNull()
  expect(normalizeSkillTimestamp(1001)).toBe('1970-01-01T00:00:01.001Z')
  expect(normalizeSkillTimestamp('2001-01-01T08:00:00+08:00')).toBe('2001-01-01T00:00:00.000Z')
})

it('keeps the selected source visible after its last skill disappears', () => {
  expect(skillClientOptions(['Codex'], 'Codex')).toEqual([{ value: 'Codex', label: 'Codex' }])
  expect(skillClientOptions([], 'Codex')).toEqual([{ value: 'Codex', label: 'Codex（暂无技能）' }])
  expect(filterInstalledSkills([], '', 'Codex')).toEqual([])
  expect(skillClientOptions([], 'all')).toEqual([])
})

it('marks project validation errors but preserves fields for Core and transport failures', () => {
  expect(skillProjectFailure('invalid_skill_project').fieldError).toBe(true)
  expect(skillProjectFailure(new Error('invalid_skill_project')).fieldError).toBe(true)
  for (const code of [
    'core_connection_failed',
    'core_not_ready',
    'skill_project_failed',
    'core_invalid_response',
  ]) {
    expect(skillProjectFailure(code)).toEqual({
      fieldError: false,
      message: '项目扫描未完成，请检查 Core 连接后重试',
    })
  }
})
