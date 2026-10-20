// SPDX-License-Identifier: MPL-2.0
import { afterEach, expect, it } from 'vitest'
import type { UsageReport, UsageScanStatus } from '@lumiplug/shared'
import { applyLocale } from '../i18n'
import { observeScan, scanDescription, scanFeedback, scanLabels } from './usage-scan'

afterEach(() => applyLocale('zh-CN'))
const status: UsageScanStatus = {
  id: 1,
  state: 'scanning',
  startedAt: '2026-10-19T00:00:00Z',
  finishedAt: null,
  updatedAt: null,
  revision: 0,
  providersDone: 0,
  providersTotal: 1,
  currentSoftware: 'qoder',
  sources: [],
}

it('limits automatic ledger refresh to one intermediate commit and one terminal update', () => {
  let previous = observeScan(null, status).next
  let count = 0
  for (let revision = 0; revision < 50; revision++) {
    const observed = observeScan(previous, { ...status, revision })
    previous = observed.next
    count += Number(observed.refresh)
  }
  expect(count).toBe(1)
  const terminal = observeScan(previous, { ...status, state: 'partial', revision: 49 })
  expect(terminal.refresh).toBe(true)
  expect(observeScan(terminal.next, { ...status, state: 'partial', revision: 49 }).refresh).toBe(
    false,
  )
})

it('translates live labels, coverage and operation feedback without recreating scan data', () => {
  const complete = { ...status, state: 'complete' as const }
  const report = { scan: complete, sources: [], matched: 0 } as unknown as UsageReport
  expect(scanLabels.scanning).toBe('扫描中')
  expect(scanFeedback(report)).toMatchObject({
    tone: 'info',
    message: expect.stringContaining('当前筛选无记录'),
  })
  applyLocale('en')
  expect(scanLabels.scanning).toBe('Scanning')
  expect(scanDescription(complete, 'all')).toContain('not necessarily all history')
  expect(scanFeedback(report)).toMatchObject({
    tone: 'info',
    message: expect.stringContaining('No records match'),
  })
  expect(complete.state).toBe('complete')
})

it('does not describe partial coverage as a successful complete scan', () => {
  applyLocale('en')
  const report = {
    scan: { ...status, state: 'partial', sources: [] },
    sources: [],
    matched: 3,
  } as unknown as UsageReport
  expect(scanFeedback(report).tone).toBe('info')
  expect(scanFeedback(report).message).toContain('partial coverage')
})
