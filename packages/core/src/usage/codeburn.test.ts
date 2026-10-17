// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usageSoftwareIds } from '@lumiplug/shared'
import { CoreDatabase } from '../db/database'
import { codeburnRecord, CodeburnCollector } from './codeburn'
import { UsageService } from './service'
import { allProviderNames, getAllProviders } from '../../vendor/codeburn/reader.cjs'
import type { Call, Provider } from '../../vendor/codeburn/reader.cjs'
const call = (provider: string): Call => ({
  provider,
  model: 'fixture-model',
  timestamp: '2026-10-10T10:00:00Z',
  deduplicationKey: 'request-1',
  usage: {
    inputTokens: 70,
    outputTokens: 20,
    cacheReadInputTokens: 10,
    cacheCreationInputTokens: 5,
    cachedInputTokens: 99999,
    reasoningTokens: 7,
  },
})
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
describe('CodeBurn complete registry and Lumi accounting boundary', () => {
  it('registers exactly all 42 upstream tools and the separate gateway, with no lazy provider dropped', async () => {
    expect([...usageSoftwareIds].sort()).toEqual([...allProviderNames()].sort())
    const providers = await getAllProviders()
    expect(providers).toHaveLength(43)
    expect(providers.filter((provider) => !provider.network)).toHaveLength(42)
  })
  it.each(usageSoftwareIds)(
    'normalizes %s without double-counting cached aliases or included reasoning',
    (provider) => {
      const row = codeburnRecord(call(provider), 'session-raw', '<title>')!
      const output = ['claude', 'codex', 'copilot', 'dsh'].includes(provider) ? 20 : 27
      expect(row).toMatchObject({
        software: provider,
        input: 70,
        output,
        cacheRead: 10,
        cacheWrite: 5,
        total: 85 + output,
        inputIncludesCache: false,
        reader: 'codeburn',
        quality: 'reported',
      })
      expect(row.session).not.toContain('session-raw')
      expect(row.id).not.toContain('request-1')
      expect(codeburnRecord(call(provider), 'session-raw', 'renamed')?.id).toBe(row.id)
      expect(codeburnRecord(call(provider), 'session-raw', 'renamed')?.session).toBe(row.session)
    },
  )
  it('does not label estimates as metered or invalid counters as zero', () => {
    expect(codeburnRecord({ ...call('warp'), isEstimated: true }, 's')?.quality).toBe('estimated')
    const bad = call('gemini')
    bad.usage.outputTokens = NaN
    expect(codeburnRecord(bad, 's')).toMatchObject({
      quality: 'missing',
      output: null,
      total: null,
    })
    expect(codeburnRecord({ ...call('gemini'), timestamp: 'not-a-date' }, 's')).toBeNull()
  })
  it('reads Claude full transcripts including stream dedup and display titles', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-claude-full-'))
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }))
    const time = '2026-10-10T10:00:00Z'
    await fs.writeFile(
      path.join(directory, 'session-a.jsonl'),
      [
        {
          type: 'user',
          sessionId: 'session-a',
          timestamp: time,
          message: { role: 'user', content: 'PRIVATE_ONLY_IN_MEMORY' },
        },
        {
          type: 'assistant',
          sessionId: 'session-a',
          timestamp: time,
          message: {
            id: 'm',
            role: 'assistant',
            type: 'message',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'response' }],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 40,
            },
          },
        },
        { type: 'ai-title', aiTitle: 'Human title', sessionId: 'session-a', timestamp: time },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
    )
    const collector = new CodeburnCollector()
    collector.begin()
    const result = await collector.collect({
      name: 'claude',
      displayName: 'Claude',
      discoverSessions: async () => [{ path: directory, provider: 'claude', project: 'test' }],
    })
    expect(result.complete).toBe(true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      total: 100,
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      sessionName: 'Human title',
    })
    expect(JSON.stringify(result.records)).not.toContain('PRIVATE_ONLY_IN_MEMORY')
  })
  it('fetches gateway daily aggregates with a range, excludes them from All and retains a good snapshot on HTTP failure', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'synthetic-key')
    const request = vi.fn(async (input: unknown) => {
      expect(String(input)).toContain('https://ai-gateway.vercel.sh/v1/report')
      return new Response(
        JSON.stringify({
          results: [
            {
              day: '2026-10-10',
              model: 'gpt-4o',
              input_tokens: 100,
              output_tokens: 20,
              cached_input_tokens: 30,
              request_count: 4,
            },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', request)
    const collector = new CodeburnCollector()
    const provider = (await getAllProviders()).find(
      (provider) => provider.name === 'vercel-gateway',
    )!
    vi.spyOn(collector, 'providers').mockResolvedValue([provider])
    const database = new CoreDatabase(':memory:')
    cleanups.push(async () => database.close())
    const service = new UsageService(database.raw, undefined, collector)
    cleanups.push(() => service.close())
    await service.scan()
    expect(request).toHaveBeenCalled()
    expect(String(request.mock.calls[0]?.[0])).toContain('start_date=')
    const period = { start: '2026-10-10T00:00:00Z', end: '2026-10-11T00:00:00Z' }
    expect(service.query(period).matched).toBe(0)
    expect(service.query({ ...period, software: 'vercel-gateway' }).totals.total).toBe(150)
    vi.stubGlobal('fetch', async () => new Response('Unavailable', { status: 503 }))
    await service.scan()
    expect(service.query({ ...period, software: 'vercel-gateway' }).totals.total).toBe(150)
  })
  it('runs real JSON discovery/parse, cache reload, summary, detail, export and replacement without duplicate generations', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-codeburn-integration-'))
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }))
    const filename = path.join(directory, 'session.json')
    await fs.writeFile(
      filename,
      JSON.stringify({
        sessionId: 'gemini-real',
        startTime: '2026-10-10T10:00:00Z',
        messages: [
          {
            id: 'u',
            type: 'user',
            timestamp: '2026-10-10T10:00:00Z',
            content: 'PRIVATE_PROMPT_MUST_NOT_PERSIST',
          },
          {
            id: 'a',
            type: 'gemini',
            timestamp: '2026-10-10T10:00:01Z',
            model: 'gemini-2.5-pro',
            content: 'ignored output',
            tokens: { input: 100, output: 20, cached: 40, thoughts: 5 },
          },
        ],
      }),
    )
    const provider: Provider = {
      name: 'gemini',
      displayName: 'Gemini',
      probeRoots: async () => [{ path: directory, label: 'sessions' }],
      discoverSessions: async () => [{ path: filename, provider: 'gemini', project: 'fixture' }],
    }
    const collector = new CodeburnCollector()
    vi.spyOn(collector, 'providers').mockResolvedValue([provider])
    const database = new CoreDatabase(':memory:')
    cleanups.push(async () => database.close())
    const service = new UsageService(database.raw, undefined, collector)
    cleanups.push(() => service.close())
    const period = {
      start: '2026-10-10T00:00:00Z',
      end: '2026-10-11T00:00:00Z',
      detectedOnly: true,
      granularity: 'hour',
    }
    await service.scan()
    const first = service.query(period)
    expect(first.totals).toMatchObject({
      input: 60,
      output: 25,
      cacheRead: 40,
      cacheWrite: 0,
      total: 125,
      count: 1,
      inputIncludesCache: false,
    })
    const sessions = service.querySessions(period)
    expect(sessions.matched).toBe(1)
    expect(sessions.sessions[0]?.total).toBe(125)
    expect(
      service.query({ ...period, session: sessions.sessions[0]!.session }).records,
    ).toHaveLength(1)
    expect(service.exportSessions(period).csv).toContain('125')
    expect(first.hourly?.[0]?.total).toBe(125)
    await service.scan()
    expect(service.query(period).totals.total).toBe(125)
    const snapshot = collector.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_PROMPT_MUST_NOT_PERSIST')
    const restored = new CodeburnCollector(snapshot)
    restored.begin()
    expect((await restored.collect(provider)).records[0]?.total).toBe(125)
    provider.discoverSessions = async () => {
      throw new Error('unavailable')
    }
    await service.scan()
    expect(service.query(period).totals.total).toBe(125)
    expect(service.query(period).sources[0]?.state).toBe('incompatible')
  })
})
