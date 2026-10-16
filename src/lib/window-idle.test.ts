// SPDX-License-Identifier: MPL-2.0
import { afterEach, expect, it, vi } from 'vitest'
import { MAIN_WINDOW_IDLE_MS, watchIdleMainWindow } from './window-idle'
afterEach(() => vi.useRealTimers())
it('waits for continuous inactivity and never releases a restored or disposed window', async () => {
  vi.useFakeTimers()
  const target = new EventTarget()
  let active = true
  const release = vi.fn()
  const dispose = watchIdleMainWindow({
    target,
    isActive: () => active,
    canRelease: () => true,
    release,
  })
  active = false
  target.dispatchEvent(new Event('lumi-window-activity'))
  await vi.advanceTimersByTimeAsync(MAIN_WINDOW_IDLE_MS - 1)
  expect(release).not.toHaveBeenCalled()
  active = true
  target.dispatchEvent(new Event('lumi-window-activity'))
  await vi.advanceTimersByTimeAsync(MAIN_WINDOW_IDLE_MS)
  expect(release).not.toHaveBeenCalled()
  active = false
  target.dispatchEvent(new Event('lumi-window-activity'))
  await vi.advanceTimersByTimeAsync(MAIN_WINDOW_IDLE_MS + 100)
  expect(release).toHaveBeenCalledTimes(1)
  target.dispatchEvent(new Event('lumi-window-activity'))
  dispose()
  await vi.advanceTimersByTimeAsync(MAIN_WINDOW_IDLE_MS + 100)
  expect(release).toHaveBeenCalledTimes(1)
})
it('rechecks transient state when the idle deadline arrives', async () => {
  vi.useFakeTimers()
  const target = new EventTarget()
  let retained = false
  const release = vi.fn()
  const dispose = watchIdleMainWindow({
    target,
    isActive: () => false,
    canRelease: () => !retained,
    release,
  })
  retained = true
  await vi.advanceTimersByTimeAsync(MAIN_WINDOW_IDLE_MS + 100)
  expect(release).not.toHaveBeenCalled()
  dispose()
})
