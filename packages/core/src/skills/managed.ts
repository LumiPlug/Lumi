// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readSkillFile, SkillFileError, skillDirectoryRoot } from './files'
import { skillMetadata } from './scanner'

export const SKILL_ERRORS: Record<string, string> = {
  skill_import_invalid: '请选择包含有效 SKILL.md（名称和描述）的完整本地目录。',
  skill_import_unavailable: '技能导入失败，请检查目录权限后重试。',
  skill_already_imported: '此技能已经导入 Lumi，已有副本未被覆盖。',
  skill_import_link: '技能包含链接或特殊文件，请先整理为独立的普通文件目录。',
  skill_import_limit: '技能目录超过限制（2000 项、12 层、32 MiB），请移除大文件或依赖后重试。',
  skill_not_available: '技能未托管、已归档或不可用，请重新搜索 Lumi 技能。',
  skill_file_unavailable: '技能文件无法读取，请检查 Lumi 中的技能状态。',
  invalid_skill_file: '文件路径必须指向此技能目录内的普通文件。',
  skill_source_changed: '技能源目录已变化，请在 Lumi 重新扫描。',
  skill_not_found: '未找到技能，请在 Lumi 重新扫描。',
}

export function insideSkillRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    !!relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** Copy a bounded, self-contained package. Never follow links or execute code. */
export async function installSkill(directory: string, managedRoot: string): Promise<void> {
  if (!path.isAbsolute(directory) || directory.includes('\0'))
    throw new SkillFileError('skill_import_invalid')
  let source: string
  try {
    source = await fs.realpath(directory)
    await skillDirectoryRoot(path.join(source, 'SKILL.md'))
    const main = await readSkillFile(source, 'SKILL.md')
    if (!main.content || !skillMetadata(main.content, path.basename(source)).metadataValid)
      throw new Error('invalid_metadata')
  } catch {
    throw new SkillFileError('skill_import_invalid')
  }
  await fs.mkdir(managedRoot, { recursive: true, mode: 0o700 })
  const root = await fs.realpath(managedRoot)
  if (source === root || insideSkillRoot(root, source) || insideSkillRoot(source, root))
    throw new SkillFileError('skill_import_invalid')
  const slot = createHash('sha256').update(source).digest('hex')
  const destination = path.join(root, slot)
  if (
    await fs.lstat(destination).then(
      () => true,
      () => false,
    )
  )
    throw new SkillFileError('skill_already_imported')
  // Staging is a sibling, so scans never discover a partial package.
  const staging = await fs.mkdtemp(path.join(path.dirname(root), '.skill-import-'))
  const excluded = new Set(['.git', 'node_modules', 'target', '__pycache__'])
  let entries = 0
  let bytes = 0
  const limit = 32 * 1024 * 1024
  async function copy(from: string, to: string, depth: number): Promise<void> {
    if (++entries > 2000 || depth > 12) throw new SkillFileError('skill_import_limit')
    const stat = await fs.lstat(from)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new SkillFileError('skill_import_link')
    if ((await fs.realpath(from)) !== from) throw new SkillFileError('skill_source_changed')
    if (stat.isDirectory()) {
      await fs.mkdir(to, { mode: 0o700 })
      const handle = await fs.opendir(from)
      for await (const entry of handle) {
        if (excluded.has(entry.name) && entry.isDirectory()) continue
        await copy(path.join(from, entry.name), path.join(to, entry.name), depth + 1)
      }
      return
    }
    if (stat.size > limit - bytes) throw new SkillFileError('skill_import_limit')
    const handle = await fs.open(from, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const current = await handle.stat()
      if (
        !current.isFile() ||
        current.ino !== stat.ino ||
        current.dev !== stat.dev ||
        (await fs.realpath(from)) !== from
      )
        throw new SkillFileError('skill_source_changed')
      const buffer = Buffer.alloc(Math.min(current.size, limit - bytes) + 1)
      let offset = 0
      while (offset < buffer.length) {
        const chunk = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (!chunk.bytesRead) break
        offset += chunk.bytesRead
      }
      if (offset > current.size || bytes + offset > limit)
        throw new SkillFileError('skill_import_limit')
      const after = await handle.stat()
      if (
        offset !== current.size ||
        after.size !== current.size ||
        after.mtimeMs !== current.mtimeMs ||
        (await fs.realpath(from)) !== from
      )
        throw new SkillFileError('skill_source_changed')
      bytes += offset
      await fs.writeFile(to, buffer.subarray(0, offset), { flag: 'wx', mode: stat.mode & 0o777 })
    } finally {
      await handle.close()
    }
  }
  try {
    const target = path.join(staging, path.basename(source))
    await copy(source, target, 0)
    const main = await readSkillFile(target, 'SKILL.md')
    if (!main.content || !skillMetadata(main.content, path.basename(source)).metadataValid)
      throw new SkillFileError('skill_import_invalid')
    // A concurrent import cannot replace a populated installation slot.
    await fs.rename(staging, destination).catch(async (error: NodeJS.ErrnoException) => {
      if (['EEXIST', 'ENOTEMPTY'].includes(error.code ?? ''))
        throw new SkillFileError('skill_already_imported')
      throw error
    })
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
