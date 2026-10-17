// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { hash } from './adapters'
import { safeStat, type UsageRoot } from './discovery'

const MAX_INDEX_BYTES = 16 * 1024 * 1024
const MAX_NAMES = 100000

function title(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200)
  return text || null
}

/** Codex metadata hashes the raw ID once; usage records hash that parser session again. */
function sessionKey(id: string): string {
  return hash(hash(id)).slice(0, 24)
}

/** Display-only data, loaded separately so renames never rekey or rewrite usage records. */
export async function readCodexSessionNames(
  roots: UsageRoot[],
  shouldStop: () => boolean = () => false,
  keyForSession: (id: string) => string = sessionKey,
): Promise<Map<string, string>> {
  const homes = new Set(
    roots
      .filter((root) => root.software === 'codex' && !root.sqlite)
      .map((root) => path.dirname(root.directory)),
  )
  const indexed = new Map<string, { name: string; updated: number }>()
  const fallback = new Map<string, string>()
  for (const home of homes) {
    if (shouldStop()) break
    try {
      const filename = path.join(home, 'session_index.jsonl')
      const info = await safeStat(filename)
      if (info.isFile() && info.size <= MAX_INDEX_BYTES) {
        const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          const stream = handle.createReadStream({ autoClose: false, end: MAX_INDEX_BYTES - 1 })
          const lines = createInterface({ input: stream, crlfDelay: Infinity })
          try {
            for await (const line of lines) {
              if (shouldStop()) break
              if (line.length > 65536) continue
              try {
                const entry: unknown = JSON.parse(line)
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
                const row = entry as Record<string, unknown>
                if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 256) continue
                const name = title(row.thread_name)
                if (!name) continue
                const id = keyForSession(row.id)
                const timestamp =
                  typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN
                const updated = Number.isFinite(timestamp) ? timestamp : -Infinity
                const old = indexed.get(id)
                if ((!old && indexed.size < MAX_NAMES) || (old && updated >= old.updated))
                  indexed.set(id, { name, updated })
              } catch {
                // Partial appends and malformed metadata do not block token collection.
              }
            }
          } finally {
            lines.close()
            stream.destroy()
          }
        } finally {
          await handle.close()
        }
      }
    } catch {
      // An optional index may be absent, unreadable or concurrently replaced.
    }
    try {
      await safeStat(home)
      const entries = await fs.readdir(home, { withFileTypes: true })
      const databases = entries
        .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
        .sort((a, b) => Number(b.name.slice(6, -7)) - Number(a.name.slice(6, -7)))
      for (const entry of databases.slice(0, 8)) {
        if (shouldStop()) break
        let source: DatabaseSync | undefined
        try {
          const filename = path.join(home, entry.name)
          if (!(await safeStat(filename)).isFile()) continue
          source = new DatabaseSync(filename, { readOnly: true })
          source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100;')
          for (const row of source
            .prepare(
              `SELECT id, substr(title,1,1000) AS title FROM threads
             WHERE typeof(id)='text' AND typeof(title)='text' LIMIT ${MAX_NAMES}`,
            )
            .iterate()) {
            if (shouldStop()) break
            if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 256) continue
            const id = keyForSession(row.id)
            const name = title(row.title)
            if (name && !fallback.has(id) && fallback.size < MAX_NAMES) fallback.set(id, name)
          }
        } catch {
          // Other schema versions or locked databases remain optional fallbacks.
        } finally {
          source?.close()
        }
      }
    } catch {
      // Keep any index names even if the home directory cannot be enumerated.
    }
  }
  for (const [id, { name }] of indexed) fallback.set(id, name)
  return fallback
}
