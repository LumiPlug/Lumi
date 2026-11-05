// SPDX-License-Identifier: MPL-2.0

import type { DatabaseSync } from 'node:sqlite'
import { HOME_STORAGE_LIMITS as limits } from '@lumiplug/shared'
import type { HomeStorageSnapshot } from '@lumiplug/shared'
import { WorkbenchError } from './validation'

type Session = { entries: Map<string, string>; bytes: number }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export class BrowserStorage {
  private readonly sessions = new Map<string, Session>()
  public constructor(private readonly database: DatabaseSync) {}

  private session(projectId: string, sessionId: unknown): Session {
    if (typeof sessionId !== 'string' || !uuid.test(sessionId))
      throw new WorkbenchError('invalid_browser_storage')
    const id = `${projectId}:${sessionId}`
    const current = this.sessions.get(id) ?? { entries: new Map<string, string>(), bytes: 0 }
    this.sessions.delete(id)
    if (this.sessions.size >= limits.sessions)
      this.sessions.delete(this.sessions.keys().next().value!)
    this.sessions.set(id, current)
    return current
  }

  public snapshot(projectId: string, sessionId: string): HomeStorageSnapshot {
    const rows = this.database
      .prepare(
        'SELECT key, value FROM workbench_browser_storage WHERE project_id = ? ORDER BY rowid',
      )
      .all(projectId) as { key: string; value: string }[]
    return {
      // JSON preserves NULs and lone UTF-16 surrogates through SQLite UTF-8.
      local: rows.map(({ key, value }) => [JSON.parse(key) as string, JSON.parse(value) as string]),
      session: [...this.session(projectId, sessionId).entries],
    }
  }

  public mutate(projectId: string, args: Record<string, unknown>): null {
    const { area, operation, key, value } = args
    if (
      !['local', 'session'].includes(String(area)) ||
      !['set', 'delete', 'clear'].includes(String(operation)) ||
      (operation !== 'clear' &&
        (typeof key !== 'string' || Buffer.byteLength(key) > limits.keyBytes)) ||
      (operation === 'set' && typeof value !== 'string')
    )
      throw new WorkbenchError('invalid_browser_storage')
    const session = this.session(projectId, args.session)
    if (area === 'session') {
      if (operation === 'clear') {
        session.entries.clear()
        session.bytes = 0
      } else {
        const name = key as string
        const old = session.entries.get(name)
        const oldBytes = old === undefined ? 0 : Buffer.byteLength(name) + Buffer.byteLength(old)
        if (operation === 'delete') {
          session.entries.delete(name)
          session.bytes -= oldBytes
        } else {
          const text = value as string
          const nextBytes =
            session.bytes - oldBytes + Buffer.byteLength(name) + Buffer.byteLength(text)
          this.quota(session.entries.size + (old === undefined ? 1 : 0), nextBytes, text)
          session.entries.set(name, text)
          session.bytes = nextBytes
        }
      }
      return null
    }
    // One transaction covers quota validation and the mutation, including clear.
    this.database.exec('BEGIN IMMEDIATE;')
    try {
      if (operation === 'clear') {
        this.database
          .prepare('DELETE FROM workbench_browser_storage WHERE project_id = ?')
          .run(projectId)
      } else if (operation === 'delete') {
        this.database
          .prepare('DELETE FROM workbench_browser_storage WHERE project_id = ? AND key = ?')
          .run(projectId, JSON.stringify(key))
      } else {
        const name = key as string
        const text = value as string
        const current = this.database
          .prepare(
            'SELECT key_bytes, value_bytes FROM workbench_browser_storage WHERE project_id = ? AND key = ?',
          )
          .get(projectId, JSON.stringify(name)) as
          { key_bytes: number; value_bytes: number } | undefined
        const stats = this.database
          .prepare(
            'SELECT COUNT(*) AS count, COALESCE(SUM(key_bytes + value_bytes), 0) AS bytes FROM workbench_browser_storage WHERE project_id = ?',
          )
          .get(projectId) as { count: number; bytes: number }
        const oldBytes = current ? current.key_bytes + current.value_bytes : 0
        this.quota(
          stats.count + (current ? 0 : 1),
          stats.bytes - oldBytes + Buffer.byteLength(name) + Buffer.byteLength(text),
          text,
        )
        this.database
          .prepare(
            'INSERT INTO workbench_browser_storage (project_id, key, value, key_bytes, value_bytes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, key_bytes = excluded.key_bytes, value_bytes = excluded.value_bytes',
          )
          .run(
            projectId,
            JSON.stringify(name),
            JSON.stringify(text),
            Buffer.byteLength(name),
            Buffer.byteLength(text),
          )
      }
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
    return null
  }

  private quota(count: number, bytes: number, value: string): void {
    if (
      count > limits.keys ||
      bytes > limits.totalBytes ||
      Buffer.byteLength(value) > limits.valueBytes
    )
      throw new WorkbenchError('browser_storage_quota')
  }
}
