// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { NativeUsageCollector, nativeUsageRoots } from './native'
import type { UsageSource } from '@lumiplug/shared'

it('resolves Windows Qoder roots within a home containing spaces and Chinese characters', () => {
  const home = path.resolve(os.tmpdir(), 'Lumi 测试用户')
  const roots = nativeUsageRoots(home, 'win32')
  expect(roots.filter((root) => root.software === 'qoder')).toEqual([
    {
      software: 'qoder',
      directory: path.join(home, 'AppData/Roaming/Qoder/SharedClientCache/cache/db/local.db'),
      sqlite: true,
    },
    { software: 'qoder', directory: path.join(home, '.qoder/projects'), origin: 'international' },
    { software: 'qoder', directory: path.join(home, '.qoder-cn/projects'), origin: 'cn' },
  ])
})

it('reports real discovery/read/limit counts without reading an oversized Windows source', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'Lumi 中文 路径-')))
  try {
    const roots = nativeUsageRoots(directory, 'win32')
    const root = roots.find((root) => root.origin === 'cn')!
    await fs.mkdir(root.directory, { recursive: true })
    const oversized = await fs.open(path.join(root.directory, '超限 文件.jsonl'), 'w')
    await oversized.truncate(64 * 1024 * 1024 + 1)
    await oversized.close()
    const snapshots: UsageSource[] = []
    const result = await new NativeUsageCollector(roots).collect(
      'qoder',
      () => false,
      (source) => snapshots.push(structuredClone(source)),
    )
    expect(result.status.problems).toContain('limit')
    expect(result.status.filesProgress).toMatchObject({
      stage: 'done',
      discovered: 1,
      checked: 1,
      read: 0,
      limited: 1,
      failed: 0,
    })
    expect(snapshots.some((source) => source.filesProgress?.stage === 'reading')).toBe(true)
    expect(result.records).toEqual([])
    expect((await fs.stat(path.join(root.directory, '超限 文件.jsonl'))).size).toBe(
      64 * 1024 * 1024 + 1,
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
