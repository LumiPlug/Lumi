// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import { normalizeSkillTimestamp } from '@lumiplug/shared'
import type {
  InstalledSkill,
  SkillScanIssue,
  SkillScanLocation,
  SkillSource,
} from '@lumiplug/shared'

import { skillRoots, type ScanRoot } from './roots'
export { skillRoots }
export type { ScanRoot }

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
  // Shared directory candidates are read once; preserve all client/scope labels.
  const groups = new Map<string, ScanRoot[]>()
  for (const root of roots) {
    const key = JSON.stringify([root.path, root.layout])
    const group = groups.get(key)
    if (group) group.push(root)
    else groups.set(key, [root])
  }
  for (const aliases of groups.values()) {
    const root = aliases[0]!
    const aliasLocations = aliases.map(({ client, scope, path: directory }) => ({
      client,
      scope,
      path: directory,
      status: 'scanned' as SkillScanLocation['status'],
    }))
    locations.push(...aliasLocations)
    const location = aliasLocations[0]!
    const visited = new Set<string>()
    async function walk(directory: string, depth: number, boundary = root.path): Promise<void> {
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
          const sources: SkillSource[] = aliases.map((alias) => ({
            client: alias.client,
            scope: alias.scope,
            root: alias.path,
            path: filePath,
          }))
          const existing = found.get(realPath)
          if (existing) {
            for (const source of sources)
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
              sources,
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
            await walk(path.join(directory, 'skills'), depth + 1, boundary)
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
                const relative = path.relative(await fs.realpath(boundary), linkedDirectory)
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
            await walk(path.join(directory, child.name), depth + 1, boundary)
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
    if (root.layout === 'profiles') {
      try {
        const profiles = await fs.opendir(root.path)
        let checked = 0
        for await (const profile of profiles) {
          if (++checked > 64) {
            location.status = 'error'
            issues.push({ path: root.path, message: 'Profile 枚举达到上限，请缩小扫描范围。' })
            break
          }
          if (profile.isDirectory()) {
            const directory = path.join(root.path, profile.name, 'skills')
            // Missing skills in an otherwise valid profile is a normal empty candidate.
            try {
              const stat = await fs.lstat(directory)
              if (stat.isSymbolicLink()) {
                location.status = 'error'
                issues.push({ path: directory, message: 'Profile 技能根目录不能是符号链接。' })
                continue
              }
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
            }
            await walk(directory, 0, directory)
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') location.status = 'missing'
        else {
          location.status = 'error'
          issues.push({ path: root.path, message: '无法读取 Profile 技能目录，请检查权限。' })
        }
      }
    } else await walk(root.path, 0)
    for (const alias of aliasLocations) alias.status = location.status
  }
  return { skills: [...found.values()], locations, issues }
}
