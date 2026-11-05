// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest'
import { HOME_STORAGE_LIMITS as limits } from '../../shared/src/workbench-storage'
import type { HomeStorageMutation } from '../../shared/src/workbench-storage'
import { installStorageBridge } from './storage'

function setup(local: [string, string][] = [], session: [string, string][] = []) {
  class NativeStorage {}
  const target = { Storage: NativeStorage, DOMException } as unknown as Window & typeof globalThis
  Object.defineProperty(target, 'localStorage', {
    get: () => {
      throw new DOMException('opaque origin', 'SecurityError')
    },
    configurable: true,
  })
  const bridge = installStorageBridge(target, { local, session })
  const writes: HomeStorageMutation[] = []
  const write = vi.fn(async (operation: HomeStorageMutation) => {
    writes.push(operation)
  })
  const report = vi.fn()
  return { target, bridge, writes, write, report, connect: () => bridge.connect(write, report) }
}

describe('sandbox Storage compatibility', () => {
  it('preloads before connection and supports synchronous methods, named properties and string conversion', async () => {
    const { target, bridge, connect, writes } = setup([['saved', 'before scripts']])
    const local = target.localStorage
    expect(local.getItem('saved')).toBe('before scripts')
    expect(local.length).toBe(1)
    local.setItem('', 'empty key')
    local.setItem('__proto__', 'ordinary data')
    local.setItem('constructor', 'stored constructor')
    local.setItem('数字', 42 as unknown as string)
    local.named = 'named value'
    expect(local.named).toBe('named value')
    expect(local.getItem('__proto__')).toBe('ordinary data')
    expect(local.getItem('constructor')).toBe('stored constructor')
    expect(local.getItem('数字')).toBe('42')
    expect(Object.keys(local)).toContain('named')
    delete local.named
    expect(local.getItem('named')).toBeNull()
    expect(local.key(0)).toBe('saved')
    expect(local.key(999)).toBeNull()
    expect(() => local.getItem(Symbol() as unknown as string)).toThrow(TypeError)
    expect(() => (local.setItem as (...args: unknown[]) => void)('missing')).toThrow(TypeError)
    expect(writes).toHaveLength(0)
    connect()
    await bridge.flush()
    expect(writes).toContainEqual({ area: 'local', operation: 'set', key: '', value: 'empty key' })
    expect(writes.at(-1)).toEqual({ area: 'local', operation: 'delete', key: 'named' })
  })

  it('keeps namespaces separate and coalesces edits made before the bridge connects', async () => {
    const { target, bridge, connect, writes } = setup([['old', 'local']], [['old', 'session']])
    target.localStorage.setItem('edit', 'first')
    target.localStorage.setItem('edit', 'final')
    target.localStorage.clear()
    target.localStorage.setItem('new', 'after clear')
    expect(target.sessionStorage.getItem('old')).toBe('session')
    connect()
    await bridge.flush()
    expect(writes).toEqual([
      { area: 'local', operation: 'clear' },
      { area: 'local', operation: 'set', key: 'new', value: 'after clear' },
    ])
  })

  it('retains failed writes and local values, rejects flush, then retries in order', async () => {
    const { target, bridge, write, report, connect, writes } = setup()
    write.mockRejectedValueOnce(new Error('disk unavailable'))
    target.localStorage.setItem('retry', 'kept')
    connect()
    await expect(bridge.flush()).rejects.toThrow('disk unavailable')
    expect(target.localStorage.getItem('retry')).toBe('kept')
    expect(report).toHaveBeenCalledOnce()
    await bridge.flush()
    expect(writes).toEqual([{ area: 'local', operation: 'set', key: 'retry', value: 'kept' }])
  })

  it('does not drop a newer edit while an older write is waiting for acknowledgement', async () => {
    const { target, bridge, write, writes, connect } = setup()
    let acknowledge!: () => void
    write.mockImplementationOnce(async (operation) => {
      writes.push(operation)
      await new Promise<void>((resolve) => {
        acknowledge = resolve
      })
    })
    target.localStorage.setItem('value', 'first')
    connect()
    const flushing = bridge.flush()
    await Promise.resolve()
    await Promise.resolve()
    target.localStorage.setItem('value', 'latest')
    acknowledge()
    await flushing
    expect(writes.map((operation) => ('value' in operation ? operation.value : null))).toEqual([
      'first',
      'latest',
    ])
  })

  it('checks byte, key and total quotas synchronously without changing existing values', () => {
    const { target } = setup()
    const local = target.localStorage
    local.setItem('stable', 'original')
    expect(() => local.setItem('stable', 'x'.repeat(limits.valueBytes + 1))).toThrow(
      expect.objectContaining({ name: 'QuotaExceededError' }),
    )
    expect(local.getItem('stable')).toBe('original')
    expect(() => local.setItem('中'.repeat(limits.keyBytes), 'x')).toThrow(
      expect.objectContaining({ name: 'QuotaExceededError' }),
    )
    for (let index = 0; index < 4; index++)
      local.setItem(String(index), 'x'.repeat(limits.valueBytes))
    expect(() => local.setItem('overflow', 'x'.repeat(limits.valueBytes))).toThrow(
      expect.objectContaining({ name: 'QuotaExceededError' }),
    )
    const full = setup(Array.from({ length: limits.keys }, (_, index) => [String(index), '']))
    expect(() => full.target.localStorage.setItem('new', 'x')).toThrow(
      expect.objectContaining({ name: 'QuotaExceededError' }),
    )
    full.target.localStorage.setItem('0', 'update allowed')
  })
})
