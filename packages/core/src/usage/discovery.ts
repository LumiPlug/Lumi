// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import type { UsageSoftware } from '@lumiplug/shared'
export interface UsageRoot {
  software: UsageSoftware
  directory: string
  sqlite?: boolean
}
export function standardRoots(home: string, platform = process.platform): UsageRoot[] {
  const cursor =
    platform === 'darwin'
      ? path.join(home, 'Library/Application Support/Cursor')
      : platform === 'win32'
        ? path.join(home, 'AppData/Roaming/Cursor')
        : path.join(home, '.config/Cursor')
  return [
    { software: 'codex', directory: path.join(home, '.codex/sessions') },
    { software: 'codex', directory: path.join(home, '.codex/archived_sessions') },
    { software: 'claude', directory: path.join(home, '.claude/projects') },
    {
      software: 'cursor',
      directory: path.join(cursor, 'User/globalStorage/state.vscdb'),
      sqlite: true,
    },
  ]
}
/** Reject every symlink component rather than escaping the selected standard root. */
export async function safeStat(filename: string) {
  const resolved = path.resolve(filename),
    parsed = path.parse(resolved)
  let current = parsed.root
  let stat
  for (const part of resolved.slice(parsed.root.length).split(path.sep)) {
    current = path.join(current, part)
    stat = await fs.lstat(current)
    if (stat.isSymbolicLink())
      throw Object.assign(new Error('symlink_not_allowed'), { code: 'EACCES' })
  }
  return stat!
}
export async function discover(
  root: UsageRoot,
  shouldStop: () => boolean = () => false,
): Promise<{ files: string[]; issues: number; limited: boolean; denied: boolean }> {
  const stat = await safeStat(root.directory)
  if (root.sqlite)
    return {
      files: stat.isFile() ? [root.directory] : [],
      issues: 0,
      limited: false,
      denied: false,
    }
  if (!stat.isDirectory()) return { files: [], issues: 1, limited: false, denied: false }
  const queue = [{ directory: root.directory, depth: 0 }],
    files: string[] = []
  let issues = 0,
    limited = false,
    visited = 0,
    denied = false
  while (queue.length && !shouldStop()) {
    const item = queue.shift()!
    if (++visited > 20000) {
      limited = true
      break
    }
    try {
      const directory = await fs.opendir(item.directory)
      for await (const entry of directory) {
        if (shouldStop()) break
        if (files.length >= 20000 || queue.length >= 20000) {
          limited = true
          break
        }
        if (entry.isSymbolicLink()) {
          issues++
          continue
        }
        const filename = path.join(item.directory, entry.name)
        if (entry.isDirectory()) {
          if (item.depth < 5) queue.push({ directory: filename, depth: item.depth + 1 })
          else limited = true
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(filename)
      }
    } catch (error) {
      issues++
      const code = (error as NodeJS.ErrnoException).code
      denied ||= code === 'EACCES' || code === 'EPERM'
    }
  }
  return { files: files.sort(), issues, limited, denied }
}
