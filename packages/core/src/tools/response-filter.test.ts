// SPDX-License-Identifier: MPL-2.0
import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
const state = vi.hoisted(() => ({ workers: [] as unknown[] }))
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    terminate = vi.fn(async () => 0)
    postMessage = vi.fn()
    constructor() {
      super()
      state.workers.push(this)
    }
  },
}))
import { filterResponse } from './response-filter'
const worker = () =>
  state.workers.at(-1) as EventEmitter & {
    terminate: ReturnType<typeof vi.fn>
    postMessage: ReturnType<typeof vi.fn>
  }
afterEach(() => {
  vi.useRealTimers()
  state.workers.length = 0
})
it('allows slow worker startup before applying the regex execution deadline', async () => {
  vi.useFakeTimers()
  const result = filterResponse({ text: 'hello' }, { text: '^hello$' })
  await vi.advanceTimersByTimeAsync(800)
  expect(worker().terminate).not.toHaveBeenCalled()
  worker().emit('message', { type: 'ready' })
  expect(worker().postMessage).toHaveBeenCalledWith({ type: 'run' })
  worker().emit('message', { type: 'result', value: { text: 'hello' } })
  expect(await result).toEqual({ text: 'hello' })
  expect(worker().terminate).toHaveBeenCalledOnce()
})
it('retains a 500 ms bound for pathological regex after readiness', async () => {
  vi.useFakeTimers()
  const result = filterResponse({}, {})
  const rejected = expect(result).rejects.toThrow('tool_response_filter_timeout')
  worker().emit('message', { type: 'ready' })
  await vi.advanceTimersByTimeAsync(501)
  await rejected
  expect(worker().terminate).toHaveBeenCalledOnce()
})
it('bounds startup itself and honors abort before readiness', async () => {
  vi.useFakeTimers()
  let result = filterResponse({}, {})
  const rejected = expect(result).rejects.toThrow('tool_response_filter_timeout')
  await vi.advanceTimersByTimeAsync(5001)
  await rejected
  const controller = new AbortController()
  result = filterResponse({}, {}, controller.signal)
  const aborted = expect(result).rejects.toThrow('tool_execution_failed')
  controller.abort()
  worker().emit('message', { type: 'ready' })
  await aborted
  expect(worker().postMessage).not.toHaveBeenCalled()
})
