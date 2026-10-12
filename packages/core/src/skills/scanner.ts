// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import { normalizeSkillTimestamp } from '@lumiplug/shared'
import type {
  InstalledSkill,
  SkillScanIssue,
  SkillScanLocation,
  SkillSource,
} from '@lumiplug/shared'

export interface ScanRoot {
  client: string
  scope: SkillSource['scope']
  path: string
}

export function skillRoots(
  projects: string[],
  home = os.homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): ScanRoot[] {
  const codex = environment.CODEX_HOME
    ? path.resolve(environment.CODEX_HOME)
    : path.join(home, '.codex')
  const claude = environment.CLAUDE_CONFIG_DIR
    ? path.resolve(environment.CLAUDE_CONFIG_DIR)
    : path.join(home, '.claude')
  const clients = [
    ['Codex', '.agents'],
    ['Claude Code', '.claude'],
    ['Qoder', '.qoder'],
    ['Cursor', '.cursor'],
    ['Gemini CLI', '.gemini'],
  ] as const
  const roots: ScanRoot[] = [
    { client: 'Codex', scope: 'personal', path: path.join(codex, 'skills') },
    { client: 'Codex', scope: 'personal', path: path.join(home, '.agents/skills') },
    { client: 'Codex', scope: 'plugin', path: path.join(codex, 'plugins/cache') },
    { client: 'Claude Code', scope: 'personal', path: path.join(claude, 'skills') },
    { client: 'Claude Code', scope: 'plugin', path: path.join(claude, 'plugins/cache') },
    { client: 'Qoder', scope: 'personal', path: path.join(home, '.qoder/skills') },
    { client: 'QoderWork', scope: 'personal', path: path.join(home, '.qoderwork/skills') },
    { client: 'Cursor', scope: 'personal', path: path.join(home, '.cursor/skills') },
    { client: 'Gemini CLI', scope: 'personal', path: path.join(home, '.gemini/skills') },
    { client: 'Gemini CLI', scope: 'personal', path: path.join(home, '.agents/skills') },
    { client: 'Gemini CLI', scope: 'plugin', path: path.join(home, '.gemini/extensions') },
  ]
  for (const project of projects) {
    for (const [client, directory] of clients) {
      roots.push({ client, scope: 'project', path: path.join(project, directory, 'skills') })
    }
    roots.push({
      client: 'Gemini CLI',
      scope: 'project',
      path: path.join(project, '.agents/skills'),
    })
    // Older Codex projects may still use .codex/skills.
    roots.push({ client: 'Codex', scope: 'project', path: path.join(project, '.codex/skills') })
  }
  return roots.filter(
    (root, index) =>
      roots.findIndex((other) => other.path === root.path && other.client === root.client) ===
      index,
  )
}

const MAX_FILE_BYTES = 256 * 1024
const MAX_DIRECTORIES = 12_000
const MAX_DEPTH = 9
const ignored = new Set(['node_modules', '.git', 'target', '__pycache__'])

export function skillMetadata(
  content: string,
  fallbackName: string,
): {
  name: string
  description: string
  metadataValid: boolean
} {
  const header = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content)
  if (!header) return { name: fallbackName, description: '', metadataValid: false }
  try {
    const document = parseDocument(header[1] ?? '', { uniqueKeys: true })
    if (document.errors.length) throw new Error('invalid_metadata')
    const value: unknown = document.toJS({ maxAliasCount: 20 })
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('invalid_metadata')
    const fields = value as Record<string, unknown>
    const name = typeof fields.name === 'string' ? fields.name.trim() : ''
    const description = typeof fields.description === 'string' ? fields.description.trim() : ''
    return {
      name: (name || fallbackName).slice(0, 200),
      description: description.slice(0, 4096),
      metadataValid:
        name.length > 0 &&
        name.length <= 200 &&
        description.length > 0 &&
        description.length <= 4096,
    }
  } catch {
    return { name: fallbackName, description: '', metadataValid: false }
  }
}

export async function scanSkillRoots(roots: ScanRoot[]): Promise<{
  skills: InstalledSkill[]
  locations: SkillScanLocation[]
  issues: SkillScanIssue[]
}> {
  const found = new Map<string, InstalledSkill>()
  const locations: SkillScanLocation[] = []
  const issues: SkillScanIssue[] = []
  let directories = 0
  for (const root of roots) {
    const location: SkillScanLocation = { ...root, status: 'scanned' }
    locations.push(location)
    const visited = new Set<string>()
    async function walk(directory: string, depth: number): Promise<void> {
      if (++directories > MAX_DIRECTORIES || depth > MAX_DEPTH) {
        location.status = 'error'
        issues.push({ path: directory, message: '目录扫描达到上限，请缩小扫描范围。' })
        return
      }
      try {
        const realDirectory = await fs.realpath(directory)
        if (visited.has(realDirectory)) return
        visited.add(realDirectory)
        const entries = await fs.readdir(directory, { withFileTypes: true })
        const entry = entries.find((item) => item.name === 'SKILL.md')
        if (entry) {
          const filePath = path.join(directory, 'SKILL.md')
          const realPath = await fs.realpath(filePath)
          const fileStat = await fs.stat(realPath)
          if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES)
            throw new Error('skill_size_limit')
          const handle = await fs.open(realPath, 'r')
          let content: string
          let fileCreatedAt: string | null = null
          try {
            const stat = await handle.stat()
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('skill_size_limit')
            fileCreatedAt = normalizeSkillTimestamp(stat.birthtimeMs)
            const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
            if (bytesRead > MAX_FILE_BYTES) throw new Error('skill_size_limit')
            content = buffer.subarray(0, bytesRead).toString('utf8')
          } finally {
            await handle.close()
          }
          const source: SkillSource = {
            client: root.client,
            scope: root.scope,
            root: root.path,
            path: filePath,
          }
          const existing = found.get(realPath)
          if (existing) {
            if (
              !existing.sources.some(
                (item) => item.path === source.path && item.client === source.client,
              )
            )
              existing.sources.push(source)
          } else {
            const metadata = skillMetadata(content, path.basename(directory))
            found.set(realPath, {
              id: createHash('sha256').update(realPath).digest('hex'),
              ...metadata,
              path: realPath,
              sources: [source],
              present: true,
              archived: false,
              firstSeenAt: null,
              fileCreatedAt,
            })
            if (!metadata.metadataValid)
              issues.push({ path: filePath, message: '技能名称或描述缺失，或 YAML 元信息无效。' })
          }
          // Some installed packs also contain independently discoverable subskills.
          if (entries.some((item) => item.name === 'skills' && item.isDirectory())) {
            await walk(path.join(directory, 'skills'), depth + 1)
          }
          return
        }
        for (const child of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (directories >= MAX_DIRECTORIES) {
            location.status = 'error'
            issues.push({ path: directory, message: '目录扫描达到上限，请缩小扫描范围。' })
            break
          }
          if ((child.isDirectory() || child.isSymbolicLink()) && !ignored.has(child.name)) {
            // Only inspect symbolic links that resolve to directories; file links are not walked.
            if (child.isSymbolicLink()) {
              try {
                const linkedDirectory = await fs.realpath(path.join(directory, child.name))
                if (!(await fs.stat(linkedDirectory)).isDirectory()) continue
                const relative = path.relative(await fs.realpath(root.path), linkedDirectory)
                if (
                  relative.startsWith(`..${path.sep}`) ||
                  relative === '..' ||
                  path.isAbsolute(relative)
                ) {
                  // External links must point directly to a skill, never to an arbitrary directory tree.
                  const linkedSkill = await fs
                    .stat(path.join(linkedDirectory, 'SKILL.md'))
                    .catch(() => null)
                  if (!linkedSkill?.isFile()) continue
                }
              } catch {
                location.status = 'error'
                issues.push({
                  path: path.join(directory, child.name),
                  message: '符号链接目标不可读取。',
                })
                continue
              }
            }
            await walk(path.join(directory, child.name), depth + 1)
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' && directory === root.path) {
          location.status = 'missing'
          return
        }
        location.status = 'error'
        issues.push({
          path: directory,
          message:
            code === 'EACCES' || code === 'EPERM'
              ? '没有读取权限。'
              : '无法读取技能目录或文件，请检查文件及大小限制。',
        })
      }
    }
    await walk(root.path, 0)
  }
  return { skills: [...found.values()], locations, issues }
}
