// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest'
import { BROWSER_TOOLS } from './tools'
import { validateBrowserArguments } from './protocol'

it('exports and validates each common action without accepting arbitrary browser commands', () => {
  const examples = {
    activate_tab: { sessionId: 's' },
    close_tab: { sessionId: 's' },
    go_back: { sessionId: 's' },
    go_forward: { sessionId: 's' },
    hover: { sessionId: 's', ref: 'r' },
    press_key: { sessionId: 's', ref: 'r', key: 'Tab', shift: true },
    select_option: { sessionId: 's', ref: 'r', values: ['a'] },
    set_checked: { sessionId: 's', ref: 'r', checked: false },
  }
  for (const [tool, args] of Object.entries(examples)) {
    expect(BROWSER_TOOLS.some((t) => t.name === `Lumi.browser_${tool}`)).toBe(true)
    expect(() => validateBrowserArguments(tool, args)).not.toThrow()
    expect(() => validateBrowserArguments(tool, { ...args, arbitrary: true })).toThrow()
  }
  for (const [tool, args] of [
    ['press_key', { sessionId: 's', ref: 'r', key: 'Meta+L' }],
    ['set_checked', { sessionId: 's', ref: 'r', checked: 'false' }],
    ['select_option', { sessionId: 's', ref: 'r', values: [] }],
    ['hover', { sessionId: 's' }],
    ['open_tab', { url: 'https://example.test', active: 1 }],
    ['click', { sessionId: 's', ref: 'r', clickCount: 3 }],
  ] as const)
    expect(() => validateBrowserArguments(tool, args)).toThrow()
})
