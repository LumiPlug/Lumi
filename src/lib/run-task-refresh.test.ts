// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolTask } from '@lumiplug/shared'
import { completeTaskSnapshot, refreshRunState } from './run-task-refresh'
const task = (id: string, stdout = '', status: ToolTask['status'] = 'running'): ToolTask => ({
  id,
  capabilityId: 'tool',
  capabilityName: 'test',
  operation: 'test.run',
  version: 1,
  runnerType: 'terminal',
  source: 'manual',
  status,
  stdout,
  stderr: '',
  result: status === 'completed' ? { stdout, stderr: '', exitCode: 0 } : null,
  startedAt: '2026-10-12T00:00:00Z',
  finishedAt: status === 'completed' ? '2026-10-12T00:00:01Z' : null,
  error: null,
  truncated: false,
  cancellationUncertain: false,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, no) => {
    resolve = ok
    reject = no
  })
  return { promise, resolve, reject }
}
afterEach(() => vi.useRealTimers())
describe('run task snapshot refresh', () => {
  it('keeps complete new tasks absent from an earlier list and both final streams with exit code', () => {
    const full = { ...task('new', 'line1\nline2\n末尾完整\n', 'completed'), stderr: '提醒\n' }
    const metadata = [task('old')]
    expect(completeTaskSnapshot(metadata, full, 'tool')).toEqual([full, ...metadata])
    expect(completeTaskSnapshot([task('new')], full, 'tool')).toEqual([full])
    expect(completeTaskSnapshot(metadata, null, 'tool')).toBe(metadata)
    expect(() => completeTaskSnapshot(metadata, full, 'other')).toThrow('task_not_found')
  })
  it('serializes slow reads and publishes increments followed by the complete terminal snapshot', async () => {
    vi.useFakeTimers()
    const first = deferred<ToolTask>(),
      second = deferred<ToolTask>(),
      final = deferred<ToolTask>()
    const read = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(final.promise)
    const update = vi.fn(),
      fail = vi.fn()
    const dispose = refreshRunState({ read, update, fail, interval: 500 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(read).toHaveBeenCalledTimes(1)
    first.resolve(task('a', '一\n'))
    await vi.advanceTimersByTimeAsync(500)
    second.resolve(task('a', '一\n二\n'))
    await vi.advanceTimersByTimeAsync(500)
    const done = task('a', '一\n二\n末尾\n', 'completed')
    final.resolve(done)
    await vi.advanceTimersByTimeAsync(0)
    expect(update.mock.calls.map(([t]) => t.stdout)).toEqual(['一\n', '一\n二\n', done.stdout])
    expect(update).toHaveBeenLastCalledWith(done)
    expect(fail).not.toHaveBeenCalled()
    dispose()
  })
  it('coalesces visibility/focus wakeups without overlapping reads and removes both listeners', async () => {
    vi.useFakeTimers()
    const target = new EventTarget(),
      first = deferred<string>(),
      second = deferred<string>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const update = vi.fn(),
      fail = vi.fn()
    const remove = vi.spyOn(target, 'removeEventListener')
    const dispose = refreshRunState({ read, update, fail, interval: 500, wakeTarget: target })
    target.dispatchEvent(new Event('focus'))
    target.dispatchEvent(new Event('visibilitychange'))
    expect(read).toHaveBeenCalledTimes(1)
    first.resolve('before')
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    second.resolve('fresh')
    await vi.advanceTimersByTimeAsync(0)
    dispose()
    expect(remove).toHaveBeenCalledTimes(3)
    target.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('discards an old task read arriving after switching tasks and a late failure after unmount', async () => {
    vi.useFakeTimers()
    const old = deferred<string>(),
      update = vi.fn(),
      fail = vi.fn()
    const dispose = refreshRunState({ read: () => old.promise, update, fail, interval: 500 })
    dispose()
    const disposeNext = refreshRunState({
      read: async () => 'new complete',
      update,
      fail,
      interval: 500,
    })
    await vi.advanceTimersByTimeAsync(0)
    old.resolve('old running')
    await vi.advanceTimersByTimeAsync(0)
    expect(update.mock.calls).toEqual([['new complete']])
    disposeNext()
    const late = deferred<string>()
    refreshRunState({ read: () => late.promise, update, fail, interval: 500 })()
    late.reject(new Error('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fail).not.toHaveBeenCalled()
  })
  it('retries after a failure and reads immediately when a sleeping window resumes', async () => {
    vi.useFakeTimers()
    const target = new EventTarget(),
      read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('complete')
    const update = vi.fn(),
      fail = vi.fn()
    const dispose = refreshRunState({ read, update, fail, interval: 500, wakeTarget: target })
    await vi.advanceTimersByTimeAsync(0)
    expect(fail).toHaveBeenCalledTimes(1)
    target.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledWith('complete')
    dispose()
  })
})

describe('background resource lifecycle', () => {
  it('makes no reads while hidden, pauses an in-flight timer and refreshes on return', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    let visible = false
    const read = vi.fn().mockResolvedValue('fresh')
    const update = vi.fn()
    const stop = refreshRunState({
      read,
      update,
      fail: vi.fn(),
      interval: 1000,
      wakeTarget: target,
      isActive: () => visible,
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).not.toHaveBeenCalled()
    visible = true
    target.dispatchEvent(new Event('lumi-window-activity'))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    visible = false
    target.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(1)
    visible = true
    target.dispatchEvent(new Event('lumi-window-activity'))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    stop()
  })
  it('retains a final snapshot without polling until a visible wakeup', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const read = vi.fn().mockResolvedValue(task('done', 'final', 'completed'))
    const stop = refreshRunState({
      read,
      update: vi.fn(),
      fail: vi.fn(),
      interval: 500,
      wakeTarget: target,
      shouldPoll: (t: ToolTask) => t.status === 'running',
    })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(read).toHaveBeenCalledTimes(1)
    target.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    stop()
  })
  it('does not resume when a pending read completes after hiding', async () => {
    vi.useFakeTimers()
    let visible = true
    const pending = deferred<string>()
    const read = vi.fn().mockReturnValue(pending.promise)
    const target = new EventTarget()
    const stop = refreshRunState({
      read,
      update: vi.fn(),
      fail: vi.fn(),
      interval: 500,
      wakeTarget: target,
      isActive: () => visible,
    })
    visible = false
    target.dispatchEvent(new Event('lumi-window-activity'))
    pending.resolve('final')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(1)
    stop()
  })
})
