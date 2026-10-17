// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Cache, Provider } from '../../vendor/codeburn/reader.cjs'
import { CoreDatabase } from '../db/database'
import { CodeburnCollector } from './codeburn'
import { UsageService } from './service'

it('keeps Codex accounting stable across append, cached restart, pause and close in the default reader pipeline', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-codex-acceptance-'))
  const filename = path.join(directory, 'rollout-fixture.jsonl')
  const databasePath = path.join(directory, 'usage.sqlite')
  vi.stubEnv('LUMI_CODEBURN_CACHE_DIR', path.join(directory, 'parser-cache'))
  const event = (time: string, input: number, cached: number, output: number) => ({
    type: 'event_msg',
    timestamp: time,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: 5,
          total_tokens: input + output,
        },
      },
    },
  })
  const first = event('2026-10-10T23:59:59Z', 100, 80, 10)
  const second = event('2026-10-11T00:00:01Z', 300, 230, 50)
  const third = event('2026-10-11T01:00:01Z', 400, 300, 70)
  const provider: Provider = {
    name: 'codex',
    displayName: 'Codex',
    probeRoots: async () => [{ path: directory, label: 'fixture' }],
    discoverSessions: async () => [{ path: filename, provider: 'codex', project: 'fixture' }],
  }
  let database: CoreDatabase | undefined
  let service: UsageService | undefined
  const open = () => {
    database = new CoreDatabase(databasePath)
    const row = database.raw
      .prepare('SELECT value FROM usage_state WHERE key=?')
      .get('codeburn-cache')
    const collector = new CodeburnCollector(
      row ? (JSON.parse(row.value as string) as Cache) : undefined,
    )
    collector.providers = async () => [provider]
    service = new UsageService(database.raw, [], collector)
    return service
  }
  const period = {
    start: '2026-10-10T00:00:00Z',
    end: '2026-10-12T00:00:00Z',
    timezone: 'UTC',
  }
  const line = (value: unknown) => JSON.stringify(value) + '\n'
  try {
    await fs.writeFile(
      filename,
      line({ type: 'session_meta', payload: { id: 'synthetic-session' } }) +
        line({ type: 'turn_context', payload: { model: 'fixture-model' } }) +
        line(first),
    )
    let current = open()
    await current.scan()
    expect(current.query(period).totals).toMatchObject({
      input: 20,
      output: 10,
      cacheRead: 80,
      cacheWrite: 0,
      total: 110,
      count: 1,
    })
    await fs.appendFile(filename, line(first) + line(second))
    await current.scan()
    const beforeRestart = current.query(period)
    expect(beforeRestart.totals).toMatchObject({
      input: 70,
      output: 50,
      cacheRead: 230,
      cacheWrite: 0,
      total: 350,
      count: 2,
    })
    expect(beforeRestart.daily.map((day) => [day.key, day.total])).toEqual([
      ['2026-10-11', 240],
      ['2026-10-10', 110],
    ])
    expect(current.query({ ...period, timezone: 'Asia/Shanghai' }).daily).toHaveLength(1)
    expect(current.query({ ...period, end: second.timestamp }).totals.total).toBe(110)
    await current.scan()
    expect(current.query(period).records).toEqual(beforeRestart.records)
    await current.close()
    database!.close()
    current = open()
    await current.scan()
    expect(current.query(period).records).toEqual(beforeRestart.records)
    expect(current.querySessions(period).sessions[0]?.total).toBe(350)
    expect(current.exportSessions(period).csv).toContain('350')
    await current.setPaused(true)
    await fs.appendFile(filename, line(third))
    await current.scan()
    expect(current.query(period).totals.total).toBe(350)
    await current.close()
    database!.close()
    current = open()
    expect(current.paused).toBe(true)
    await current.scan()
    expect(current.query(period).totals.total).toBe(350)
    await current.setPaused(false)
    expect(current.query(period).totals).toMatchObject({
      input: 100,
      output: 70,
      cacheRead: 300,
      cacheWrite: 0,
      total: 470,
      count: 3,
    })
    await current.close()
    await fs.appendFile(filename, line(event('2026-10-11T02:00:01Z', 500, 350, 90)))
    await current.scan()
    expect(current.query(period).totals.total).toBe(470)
  } finally {
    await service?.close()
    database?.close()
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('keeps interrupted Codex resume checkpoints free of message text and pending tool details', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-codex-checkpoint-'))
  const cacheDirectory = path.join(directory, 'parser-cache')
  vi.stubEnv('LUMI_CODEBURN_CACHE_DIR', cacheDirectory)
  const filename = path.join(directory, 'rollout-interrupted.jsonl')
  const provider: Provider = {
    name: 'codex',
    displayName: 'Codex',
    discoverSessions: async () => [{ path: filename, provider: 'codex', project: 'fixture' }],
  }
  const rows = [
    { type: 'session_meta', payload: { id: 'interrupted-fixture' } },
    { type: 'turn_context', payload: { model: 'fixture-model' } },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'PRIVATE_CHECKPOINT_PROMPT' }],
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'PRIVATE_CHECKPOINT_TOOL',
        arguments: JSON.stringify({ command: 'PRIVATE_CHECKPOINT_COMMAND' }),
      },
    },
    { type: 'event_msg', timestamp: '2026-10-10T12:00:00Z', payload: { type: 'task_started' } },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'fixture reply' }],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-10-10T12:00:01Z',
      payload: { type: 'token_count', info: null },
    },
  ]
  try {
    await fs.writeFile(filename, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const collector = new CodeburnCollector()
    const first = await collector.collect(provider)
    expect(first.records).toHaveLength(1)
    expect(first.records[0]?.quality).toBe('estimated')
    const caches = await fs.readdir(cacheDirectory)
    expect(caches.some((name) => name.startsWith('codex-results'))).toBe(true)
    for (const cache of caches) {
      expect(await fs.readFile(path.join(cacheDirectory, cache), 'utf8')).not.toContain(
        'PRIVATE_CHECKPOINT_',
      )
    }
    expect(JSON.stringify(collector.snapshot())).not.toContain('PRIVATE_CHECKPOINT_')
    await fs.appendFile(
      filename,
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-10-10T12:00:02Z',
        payload: { type: 'task_complete' },
      }) + '\n',
    )
    // A fresh process proves the redacted on-disk checkpoint retains estimates;
    // a second collector in this process could reuse the reader's memory cache.
    const script = `
      const { CodeburnCollector } = require(process.argv[1]);
      const provider = { name: 'codex', displayName: 'Codex',
        discoverSessions: async () => [{ path: process.argv[2], provider: 'codex', project: 'fixture' }] };
      new CodeburnCollector().collect(provider).then(result => process.stdout.write(JSON.stringify(result.records)));
    `
    const resumed = execFileSync(
      process.execPath,
      ['-e', script, path.resolve(__dirname, '../../dist/usage/codeburn.js'), filename],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(resumed)).toEqual(first.records)
  } finally {
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('parses the registered Qwen reader with a synthetic transcript, deduplicates requests and drops prompt text', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-qwen-acceptance-'))
  vi.stubEnv('LUMI_CODEBURN_CACHE_DIR', path.join(directory, 'parser-cache'))
  const filename = path.join(directory, 'session.jsonl')
  const assistant = {
    uuid: 'reply-1',
    sessionId: 'qwen-fixture',
    type: 'assistant',
    timestamp: '2026-10-10T12:00:01Z',
    model: 'qwen-fixture-model',
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 5,
      cachedContentTokenCount: 0,
      totalTokenCount: 125,
    },
  }
  try {
    await fs.writeFile(
      filename,
      [
        { type: 'user', message: { role: 'user', parts: [{ text: 'PRIVATE_QWEN_PROMPT' }] } },
        assistant,
        assistant,
        { ...assistant, uuid: 'missing', usageMetadata: undefined },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
    )
    const collector = new CodeburnCollector()
    const registered = (await collector.providers()).find((provider) => provider.name === 'qwen')!
    const provider: Provider = {
      ...registered,
      discoverSessions: async () => [{ path: filename, provider: 'qwen', project: 'fixture' }],
      probeRoots: async () => [{ path: directory, label: 'fixture' }],
    }
    const result = await collector.collect(provider)
    expect(result.complete).toBe(true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      input: 100,
      output: 25,
      cacheRead: 0,
      cacheWrite: 0,
      total: 125,
      quality: 'reported',
    })
    expect(JSON.stringify(result.records)).not.toContain('PRIVATE_QWEN_PROMPT')
    expect(JSON.stringify(collector.snapshot())).not.toContain('PRIVATE_QWEN_PROMPT')
    const restored = new CodeburnCollector(collector.snapshot())
    expect((await restored.collect(provider)).records).toEqual(result.records)
  } finally {
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
