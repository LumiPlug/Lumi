// SPDX-License-Identifier: MPL-2.0

import type { DatabaseSync } from 'node:sqlite'
import { emptyWorkbench } from '@lumiplug/shared'
import type { HomeBundle, JsonValue, WorkbenchSnapshot } from '@lumiplug/shared'
import { validateHomeBundle, WorkbenchError } from './validation'
export { WorkbenchError } from './validation'

export class WorkbenchRepository {
  private readonly cache = new Map<number, WorkbenchSnapshot>()
  public constructor(private readonly database: DatabaseSync) {}
  public get(version?: number): WorkbenchSnapshot {
    const currentVersion =
      version ??
      (
        this.database
          .prepare('SELECT version FROM workbench_versions ORDER BY version DESC LIMIT 1')
          .get() as { version: number } | undefined
      )?.version
    if (currentVersion === undefined) return emptyWorkbench()
    const cached = this.cache.get(currentVersion)
    if (cached) return cached
    const row = this.database
      .prepare(
        'SELECT version, document_json, updated_at FROM workbench_versions WHERE version = ?',
      )
      .get(currentVersion) as
      { version: number; document_json: string; updated_at: string } | undefined
    if (!row) return emptyWorkbench()
    const snapshot: WorkbenchSnapshot = {
      version: row.version,
      updatedAt: row.updated_at,
      bundle: JSON.parse(row.document_json) as HomeBundle,
    }
    if (this.cache.size >= 2) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(currentVersion, snapshot)
    return snapshot
  }
  public publish(expectedVersion: number, input: unknown): WorkbenchSnapshot {
    const bundle = validateHomeBundle(input)
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= Number.MAX_SAFE_INTEGER
    )
      throw new WorkbenchError('invalid_home_bundle')
    const serialized = JSON.stringify(bundle)
    this.database.exec('BEGIN IMMEDIATE;')
    try {
      const current = this.get()
      if (current.version !== expectedVersion)
        throw new WorkbenchError('workbench_version_conflict')
      const snapshot: WorkbenchSnapshot = {
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        bundle,
      }
      this.database
        .prepare(
          'INSERT INTO workbench_versions (version, document_json, updated_at) VALUES (?, ?, ?)',
        )
        .run(snapshot.version, serialized, snapshot.updatedAt)
      this.database.exec('COMMIT;')
      return snapshot
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
  }
  public restore(expectedVersion: number, version: number): WorkbenchSnapshot {
    const selected = this.get(version)
    if (!selected.bundle) throw new WorkbenchError('workbench_version_missing')
    return this.publish(expectedVersion, selected.bundle)
  }
  public listVersions() {
    const rows = this.database
      .prepare(
        "SELECT version, updated_at, json_extract(document_json, '$.manifest.name') AS name FROM workbench_versions ORDER BY version DESC LIMIT 30",
      )
      .all() as unknown as { version: number; updated_at: string; name: string }[]
    return rows.map((row) => ({ version: row.version, updatedAt: row.updated_at, name: row.name }))
  }
  public state(projectId: string, operation: string, key: unknown, value?: unknown): JsonValue {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(key))
      throw new WorkbenchError('invalid_workbench_state')
    const storageKey = `${projectId}:${key}`
    const current = this.database
      .prepare('SELECT value_json FROM workbench_state WHERE key = ?')
      .get(storageKey) as { value_json: string } | undefined
    if (operation === 'get') return current ? (JSON.parse(current.value_json) as JsonValue) : null
    if (operation === 'delete') {
      this.database.prepare('DELETE FROM workbench_state WHERE key = ?').run(storageKey)
      return null
    }
    if (operation !== 'set') throw new WorkbenchError('invalid_workbench_state')
    const serialized = JSON.stringify(value)
    if (!serialized || Buffer.byteLength(serialized) > 32 * 1024)
      throw new WorkbenchError('invalid_workbench_state')
    const count = this.database
      .prepare('SELECT COUNT(*) AS count FROM workbench_state WHERE key LIKE ?')
      .get(`${projectId}:%`) as { count: number }
    if (!current && count.count >= 128) throw new WorkbenchError('invalid_workbench_state')
    this.database
      .prepare(
        'INSERT INTO workbench_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(storageKey, serialized)
    return JSON.parse(serialized) as JsonValue
  }
}
