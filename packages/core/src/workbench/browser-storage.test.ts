// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOME_STORAGE_LIMITS as limits } from '@lumiplug/shared'
import { CoreDatabase } from '../db/database'
import { WorkbenchRepository } from './repository'

let directory: string
let database: CoreDatabase
let repository: WorkbenchRepository
const project = randomUUID()
const session = randomUUID()
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-browser-storage-'))
  database = new CoreDatabase(path.join(directory, 'test.sqlite'))
  repository = new WorkbenchRepository(database.raw)
})
afterEach(() => {
  database.close()
  fs.rmSync(directory, { recursive: true, force: true })
})
const mutate = (area: 'local' | 'session', operation: string, key?: string, value?: string) =>
  repository.browserStorage.mutate(project, { session, area, operation, key, value })
const snapshot = () => repository.browserStorage.snapshot(project, session)

describe('project browser storage', () => {
  it('upgrades a pre-compatibility database without changing existing SDK state', () => {
    repository.state(project, 'set', 'existing', { retained: true })
    database.raw.exec(
      'DROP TABLE workbench_browser_storage; DELETE FROM schema_migrations WHERE id = 13;',
    )
    database.close()
    database = new CoreDatabase(path.join(directory, 'test.sqlite'))
    repository = new WorkbenchRepository(database.raw)
    expect(repository.state(project, 'get', 'existing')).toEqual({ retained: true })
    expect(snapshot()).toEqual({ local: [], session: [] })
  })
  it('preserves arbitrary string keys and values across restart, while clearing session data', () => {
    for (const key of ['', '__proto__', '中文 key', '\0', '\ud800'])
      mutate('local', 'set', key, `value\0\udfff${key}`)
    mutate('session', 'set', 'temporary', 'session only')
    const saved = snapshot().local
    database.close()
    database = new CoreDatabase(path.join(directory, 'test.sqlite'))
    repository = new WorkbenchRepository(database.raw)
    expect(snapshot().local).toEqual(saved)
    expect(snapshot().local.find(([key]) => key === '\ud800')?.[1]).toBe('value\0\udfff\ud800')
    expect(snapshot().session).toEqual([])
  })

  it('isolates projects, sessions and SDK KV, including clear and delete', () => {
    repository.state(project, 'set', 'sdk', { keep: true })
    mutate('local', 'set', 'same', 'local')
    mutate('session', 'set', 'same', 'session')
    expect(repository.browserStorage.snapshot(randomUUID(), session)).toEqual({
      local: [],
      session: [],
    })
    expect(repository.browserStorage.snapshot(project, randomUUID())).toEqual({
      local: [['same', 'local']],
      session: [],
    })
    mutate('local', 'clear')
    expect(snapshot()).toEqual({ local: [], session: [['same', 'session']] })
    expect(repository.state(project, 'get', 'sdk')).toEqual({ keep: true })
    mutate('session', 'delete', 'same')
    expect(snapshot().session).toEqual([])
  })

  it('rejects invalid sessions, oversized values and total quota without partial changes', () => {
    expect(() =>
      repository.browserStorage.mutate(project, {
        session: 'not-a-session',
        area: 'local',
        operation: 'clear',
      }),
    ).toThrow('invalid_browser_storage')
    mutate('local', 'set', 'stable', 'old')
    expect(() => mutate('local', 'set', 'stable', 'x'.repeat(limits.valueBytes + 1))).toThrow(
      'browser_storage_quota',
    )
    expect(snapshot().local).toEqual([['stable', 'old']])
    for (let index = 0; index < 4; index++)
      mutate('local', 'set', String(index), 'x'.repeat(limits.valueBytes))
    expect(() => mutate('local', 'set', 'overflow', 'x'.repeat(limits.valueBytes))).toThrow(
      'browser_storage_quota',
    )
    expect(snapshot().local).toHaveLength(5)
    expect(() => mutate('session', 'set', 'too-big', 'x'.repeat(limits.valueBytes + 1))).toThrow(
      'browser_storage_quota',
    )
    expect(snapshot().session).toEqual([])
  })

  it('rolls back a failed database write and permits a later retry', () => {
    mutate('local', 'set', 'value', 'old')
    database.raw.exec(
      "CREATE TRIGGER storage_failure BEFORE INSERT ON workbench_browser_storage BEGIN SELECT RAISE(ABORT, 'simulated_disk_failure'); END;",
    )
    expect(() => mutate('local', 'set', 'value', 'new')).toThrow('simulated_disk_failure')
    expect(snapshot().local).toEqual([['value', 'old']])
    database.raw.exec('DROP TRIGGER storage_failure;')
    mutate('local', 'set', 'value', 'new')
    expect(snapshot().local).toEqual([['value', 'new']])
  })
})
