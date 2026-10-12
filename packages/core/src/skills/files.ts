// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { SkillDirectory, SkillFileEntry, SkillFilePreview } from '@lumiplug/shared'

const MAX_ENTRIES = 800
const MAX_DEPTH = 12
const MAX_TEXT_BYTES = 256 * 1024
const MAX_IMAGE_BYTES = 1024 * 1024
const excluded = new Set(['.git', 'node_modules', 'target', '__pycache__'])
export class SkillFileError extends Error {}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function skillDirectoryRoot(skillPath: string): Promise<string> {
  try {
    // Inventory paths are canonical. A moved/replaced root requires a fresh scan.
    const root = path.dirname(skillPath)
    if ((await fs.realpath(skillPath)) !== skillPath || (await fs.realpath(root)) !== root)
      throw new SkillFileError('skill_source_changed')
    if (!(await fs.lstat(skillPath)).isFile()) throw new SkillFileError('skill_file_unavailable')
    return root
  } catch (error) {
    if (error instanceof SkillFileError) throw error
    throw new SkillFileError('skill_file_unavailable')
  }
}

export async function listSkillDirectory(
  root: string,
  mainFile = 'SKILL.md',
): Promise<SkillDirectory> {
  let count = 1
  let truncated = false
  async function walk(directory: string, prefix: string, depth: number): Promise<SkillFileEntry[]> {
    const nodes: SkillFileEntry[] = prefix ? [] : [{ name: mainFile, path: mainFile, kind: 'file' }]
    if (depth > MAX_DEPTH) {
      truncated = true
      return nodes
    }
    const handle = await fs.opendir(directory)
    for await (const entry of handle) {
      if (!prefix && entry.name === mainFile) continue
      if (count >= MAX_ENTRIES) {
        truncated = true
        break
      }
      if (entry.isDirectory() && excluded.has(entry.name)) {
        truncated = true
        continue
      }
      count++
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const node: SkillFileEntry = {
        name: entry.name,
        path: relativePath,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }
      nodes.push(node)
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        node.kind = 'unavailable'
        node.note = '链接或特殊文件不提供预览'
      } else if (entry.isDirectory()) {
        try {
          const target = await resolveSkillFile(root, relativePath)
          node.children = await walk(target, relativePath, depth + 1)
        } catch {
          node.note = '此目录暂时无法读取'
          node.children = []
        }
      }
    }
    return nodes.sort((a, b) => {
      if (a.path === mainFile) return -1
      if (b.path === mainFile) return 1
      return (
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name)
      )
    })
  }
  try {
    return { rootPath: root, entries: await walk(root, '', 0), truncated }
  } catch {
    throw new SkillFileError('skill_file_unavailable')
  }
}

async function resolveSkillFile(root: string, relativePath: string): Promise<string> {
  if (
    !relativePath ||
    relativePath.length > 4096 ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    path.isAbsolute(relativePath) ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new SkillFileError('invalid_skill_file')
  let target = root
  for (const part of relativePath.split('/')) {
    target = path.join(target, part)
    if ((await fs.lstat(target)).isSymbolicLink()) throw new SkillFileError('invalid_skill_file')
  }
  const real = await fs.realpath(target)
  if (!inside(root, real) || real !== target || (await fs.realpath(root)) !== root)
    throw new SkillFileError('invalid_skill_file')
  return target
}

function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  return null
}

export async function readSkillFile(root: string, relativePath: string): Promise<SkillFilePreview> {
  try {
    const target = await resolveSkillFile(root, relativePath)
    const before = await fs.lstat(target)
    if (!before.isFile()) throw new SkillFileError('invalid_skill_file')
    const image = /\.(png|jpe?g|gif|webp)$/i.test(target)
    const limit = image ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
    const base = { path: relativePath, size: before.size }
    if (before.size > limit) return { ...base, kind: 'too-large' }
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let bytes: Buffer
    try {
      const current = await handle.stat()
      if (!current.isFile() || current.ino !== before.ino || current.dev !== before.dev)
        throw new SkillFileError('skill_source_changed')
      // Check the path again after opening; never expose a newly redirected link target.
      await resolveSkillFile(root, relativePath)
      const buffer = Buffer.alloc(limit + 1)
      let offset = 0
      while (offset < buffer.length) {
        const result = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (!result.bytesRead) break
        offset += result.bytesRead
      }
      if (offset > limit) return { ...base, size: offset, kind: 'too-large' }
      bytes = buffer.subarray(0, offset)
    } finally {
      await handle.close()
    }
    if (image) {
      const mime = imageMime(bytes)
      return mime
        ? {
            ...base,
            size: bytes.length,
            kind: 'image',
            content: `data:${mime};base64,${bytes.toString('base64')}`,
          }
        : { ...base, kind: 'unsupported' }
    }
    try {
      if (bytes.includes(0)) return { ...base, kind: 'unsupported' }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return {
        ...base,
        size: bytes.length,
        kind: /\.(md|markdown|mdown)$/i.test(target) ? 'markdown' : 'text',
        content,
      }
    } catch {
      return { ...base, kind: 'unsupported' }
    }
  } catch (error) {
    if (error instanceof SkillFileError) throw error
    throw new SkillFileError('skill_file_unavailable')
  }
}
