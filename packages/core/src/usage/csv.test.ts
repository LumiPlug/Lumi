// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest'
import { sessionsCsv } from './csv'
it('quotes text and formulas while retaining real zeros and leaving unknown counters blank', () => {
  const csv = sessionsCsv([
    {
      key: 'codex:hash',
      software: 'codex',
      session: 'hash',
      sessionName: '=HYPERLINK("bad"),title',
      latestTime: '2026-10-16T00:00:00Z',
      total: 0,
      input: 0,
      output: 0,
      cacheRead: null,
      cacheWrite: null,
      count: 1,
    },
  ])
  expect(csv).toContain('"\'=HYPERLINK(""bad""),title"')
  expect(csv).toContain(',0,0,,,0,1,0\r\n')
  expect(csv).not.toContain('null')
})
