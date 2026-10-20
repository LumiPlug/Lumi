// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CoreDatabase } from '../db/database'
import { UsageCollector } from './collector'
import { nativeUsageRoots } from './native'
import { UsageService } from './service'

const period = { start: '2026-10-19T00:00:00Z', end: '2026-10-20T00:00:00Z' }
const event = (id: string, uuid = `event-${id}`) => ({
  type: 'assistant',
  sessionId: 'synthetic-session',
  uuid,
  timestamp: '2026-10-19T02:00:00Z',
  message: {
    id,
    role: 'assistant',
    model: 'fixture',
    content: 'PRIVATE_SENTINEL',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 0,
    },
  },
})

async function fixture(
  run: (context: {
    service: UsageService
    write: (origin: 'cn' | 'international', row: ReturnType<typeof event>) => Promise<void>
  }) => Promise<void>,
) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-qoder-cn-')))
  const db = new CoreDatabase(':memory:')
  const roots = nativeUsageRoots(home)
  const collector = new UsageCollector(undefined, roots)
  vi.spyOn(collector, 'providers').mockResolvedValue([
    { name: 'qoder', displayName: 'Qoder', discoverSessions: async () => [] },
  ])
  const service = new UsageService(db.raw, undefined, collector)
  const write = async (origin: 'cn' | 'international', row: ReturnType<typeof event>) => {
    const root = roots.find((item) => item.software === 'qoder' && item.origin === origin)!
    await fs.mkdir(root.directory, { recursive: true })
    await fs.writeFile(path.join(root.directory, 'fixture.jsonl'), JSON.stringify(row) + '\n')
  }
  try {
    await run({ service, write })
  } finally {
    await service.close()
    db.close()
    await fs.rm(home, { recursive: true, force: true })
  }
}

describe('Qoder regional roots and scan coverage', () => {
  it('reads CN when international roots are absent and reports real file counts', () =>
    fixture(async ({ service, write }) => {
      await write('cn', event('cn'))
      await service.scan()
      const report = service.query(period)
      expect(report.matched).toBe(1)
      expect(report.totals.total).toBe(18)
      expect(report.scan?.state).toBe('complete')
      expect(report.sources[0]!.filesProgress).toMatchObject({
        discovered: 1,
        checked: 1,
        read: 1,
        cached: 0,
        deferred: 0,
        failed: 0,
      })
      expect(JSON.stringify(report.scan)).not.toContain('lumi-qoder-cn-')
      expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL')
    }))

  it('counts a proven cross-root copy once across repeated scans and filters', () =>
    fixture(async ({ service, write }) => {
      await write('international', event('same'))
      await write('cn', event('same'))
      await service.scan()
      await service.scan()
      expect(service.query(period).matched).toBe(1)
      expect(service.query({ ...period, model: 'fixture' }).totals.total).toBe(18)
      expect(service.querySessions(period).matched).toBe(1)
    }))

  it('retains equal request IDs with different event identities and warns', () =>
    fixture(async ({ service, write }) => {
      await write('international', event('same', 'international-event'))
      await write('cn', event('same', 'cn-event'))
      await service.scan()
      const report = service.query(period)
      expect(report.matched).toBe(2)
      expect(report.totals.total).toBe(36)
      expect(service.querySessions(period).matched).toBe(2)
      expect(report.scan?.state).toBe('partial')
      expect(report.sources[0]!.problems).toContain('identity_unverified')
    }))

  it('returns isolated status snapshots without starting another scan', () =>
    fixture(async ({ service, write }) => {
      await write('cn', event('status'))
      await service.scan()
      const status = service.status()
      status.sources.length = 0
      expect(service.status().id).toBe(status.id)
      expect(service.status().sources).toHaveLength(1)
      expect(service.status().revision).toBe(1)
    }))
})
