// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import { dispatchDevelopmentUiAction } from './dev-ui'
import type { DevelopmentUiAudit, DevelopmentUiPreset } from './dev-ui-types'
const id = '2ab20dbb-eda9-438b-9722-e10fa12ad907'
const preset = (): DevelopmentUiPreset => ({
  enabled: true,
  action: 'terminal.start',
  capabilityId: id,
})
const button = (disabled = false) => ({
  tagName: 'BUTTON',
  isConnected: true,
  disabled,
  click: vi.fn(),
})
describe('development UI one-shot preset', () => {
  it('defaults off and rejects unknown or out-of-scope actions before claiming', async () => {
    const control = button(),
      claim = vi.fn<(event: DevelopmentUiAudit) => Promise<void>>(async () => {})
    expect(
      await dispatchDevelopmentUiAction(null, id, control as unknown as HTMLButtonElement, claim),
    ).toBe('disabled')
    expect(
      await dispatchDevelopmentUiAction(
        { ...preset(), enabled: false },
        id,
        control as unknown as HTMLButtonElement,
        claim,
      ),
    ).toBe('disabled')
    for (const invalid of [
      { ...preset(), action: 'eval' },
      { ...preset(), capabilityId: '../other' },
      { ...preset(), capabilityId: 'f06cb86e-b41c-418e-9034-c92325d76732' },
    ])
      expect(
        await dispatchDevelopmentUiAction(
          invalid,
          id,
          control as unknown as HTMLButtonElement,
          claim,
        ),
      ).toBe('rejected')
    expect(claim).not.toHaveBeenCalled()
    expect(control.click).not.toHaveBeenCalled()
  })
  it('cannot trigger disabled, detached or missing buttons and can wait for readiness', async () => {
    const control = button(true),
      settings = preset(),
      claim = vi.fn<(event: DevelopmentUiAudit) => Promise<void>>(async () => {})
    expect(
      await dispatchDevelopmentUiAction(
        settings,
        id,
        control as unknown as HTMLButtonElement,
        claim,
      ),
    ).toBe('not-ready')
    expect(await dispatchDevelopmentUiAction(settings, id, null, claim)).toBe('not-ready')
    control.disabled = false
    control.isConnected = false
    expect(
      await dispatchDevelopmentUiAction(
        settings,
        id,
        control as unknown as HTMLButtonElement,
        claim,
      ),
    ).toBe('not-ready')
    control.isConnected = true
    expect(
      await dispatchDevelopmentUiAction(
        settings,
        id,
        control as unknown as HTMLButtonElement,
        claim,
      ),
    ).toBe('clicked')
    expect(control.click).toHaveBeenCalledTimes(1)
  })
  it('coalesces concurrent triggers and never repeats a consumed startup preset', async () => {
    const control = button(),
      settings = preset(),
      claim = vi.fn<(event: DevelopmentUiAudit) => Promise<void>>(async () => {})
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        dispatchDevelopmentUiAction(settings, id, control as unknown as HTMLButtonElement, claim),
      ),
    )
    expect(results.filter((result) => result === 'clicked')).toHaveLength(1)
    expect(results.filter((result) => result === 'duplicate')).toHaveLength(2)
    expect(control.click).toHaveBeenCalledTimes(1)
    expect(claim.mock.calls.map(([event]) => event.phase)).toEqual(['dispatch', 'clicked'])
  })
  it('fails closed on a rejected host claim or a button disabled while waiting', async () => {
    const control = button(),
      settings = preset()
    await expect(
      dispatchDevelopmentUiAction(
        settings,
        id,
        control as unknown as HTMLButtonElement,
        async () => {
          throw new Error('development_ui_disabled')
        },
      ),
    ).rejects.toThrow()
    expect(control.click).not.toHaveBeenCalled()
    expect(
      await dispatchDevelopmentUiAction(
        settings,
        id,
        control as unknown as HTMLButtonElement,
        async () => {},
      ),
    ).toBe('duplicate')
    const another = button()
    expect(
      await dispatchDevelopmentUiAction(
        preset(),
        id,
        another as unknown as HTMLButtonElement,
        async () => {
          another.disabled = true
        },
      ),
    ).toBe('not-ready')
    expect(another.click).not.toHaveBeenCalled()
  })
})
