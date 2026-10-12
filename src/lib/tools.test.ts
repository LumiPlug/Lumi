// SPDX-License-Identifier: MPL-2.0
import { expect, it, vi } from 'vitest'
import { toolAddedTime } from './tools'

it('shows the persisted tool creation date in the local timezone, including day rollover', () => {
  vi.stubEnv('TZ', 'Asia/Shanghai')
  try {
    expect(toolAddedTime('2026-10-10T17:03:00Z')).toEqual({
      dateTime: '2026-10-10T17:03:00.000Z',
      text: '添加于 2026-10-11 01:03',
    })
  } finally {
    vi.unstubAllEnvs()
  }
})

it('keeps missing or malformed tool dates unknown instead of rendering invalid time elements', () => {
  for (const value of ['', 'invalid', '1970-01-01T00:00:00Z', '1969-12-31T23:59:59Z'])
    expect(toolAddedTime(value)).toEqual({ dateTime: null, text: '添加时间未知' })
})
