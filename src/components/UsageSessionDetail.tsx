// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { UsageSession } from '@lumiplug/shared'
import { ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react'
import { Badge, DataPanel, DateRangeCalendar, IconButton, Segmented } from './ui'
import { usageCalendarDates, usageCustomRange, usageNames } from '../lib/usage'
import { compactTokens } from '../lib/usage-dashboard'
import { UsageSessionRecords } from './UsageSessionCard'
import type { UsageSessionSummary } from './UsageSessionCard'
import { useToast } from './ToastProvider'

export default function UsageSessionDetail({
  session,
  filter,
  revision,
  refreshing,
  coreReady,
  onRefresh,
  onBack,
}: {
  session: UsageSession
  filter: Record<string, unknown>
  revision: number
  refreshing: boolean
  coreReady: boolean
  onRefresh: () => void
  onBack: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const toast = useToast()
  const [customRange, setCustomRange] = useState<ReturnType<typeof usageCustomRange> | null>(null)
  const recordFilter = useMemo(
    () => (customRange ? { ...filter, ...customRange } : filter),
    [filter, customRange],
  )
  const dates = usageCalendarDates({
    start: String(recordFilter.start),
    end: String(recordFilter.end),
    timezone: String(recordFilter.timezone),
  })
  const rangeLabel = `${dates.start.replaceAll('-', '/')} – ${dates.end.replaceAll('-', '/')}`
  const [summary, setSummary] = useState<(UsageSessionSummary & { filter: object }) | null>(null)
  const receiveSummary = useCallback(
    (value: UsageSessionSummary | null) => {
      setSummary(value ? { ...value, filter: recordFilter } : null)
    },
    [recordFilter],
  )
  const total = summary?.filter === recordFilter ? summary.total : null
  const count = summary?.filter === recordFilter ? summary.count : null
  const calendarAnchor = useRef<HTMLDivElement>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const closeCalendar = useCallback(() => setCalendarOpen(false), [])
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  return (
    <section className="usage-page usage-session-detail" aria-labelledby={headingId}>
      <header className="usage-detail-header">
        <IconButton label="返回会话明细" title="返回" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </IconButton>
        <div className="usage-detail-title">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="ui-detail-heading">
            {session.sessionName?.trim() || session.session}
          </h2>
          <div className="ui-detail-meta">
            <span>{usageNames[session.software]}</span>
            <span>
              {(session.models ?? []).map((model) => model ?? '未知模型').join(' / ') || '未知模型'}
            </span>
          </div>
        </div>
        <IconButton
          label="刷新会话明细"
          loading={refreshing}
          loadingAnimation="spin"
          disabled={!coreReady}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />
        </IconButton>
      </header>
      <DataPanel
        className="usage-records-panel"
        title={count === null ? '用量记录' : `用量记录（${count.toLocaleString()}条）`}
        actions={
          <div className="usage-log-actions">
            <div ref={calendarAnchor}>
              <Segmented
                label="会话时间范围"
                value=""
                onValueChange={() => setCalendarOpen((open) => !open)}
                items={[
                  {
                    value: 'custom',
                    disabled: !coreReady,
                    accessibleLabel: `选择会话时间范围 ${rangeLabel}`,
                    label: (
                      <span className="ui-choice-content">
                        <CalendarDays size={16} aria-hidden="true" />
                        {rangeLabel}
                      </span>
                    ),
                  },
                ]}
              />
              {calendarOpen && (
                <DateRangeCalendar
                  anchorRef={calendarAnchor}
                  start={dates.start}
                  end={dates.end}
                  onClose={closeCalendar}
                  onApply={(start, end) => {
                    try {
                      setCustomRange(usageCustomRange(start, end, String(filter.timezone)))
                      setCalendarOpen(false)
                    } catch (error) {
                      toast(error instanceof Error ? error.message : '请选择有效日期。', 'error')
                    }
                  }}
                />
              )}
            </div>
            <Badge>总计 {compactTokens(total)} Token</Badge>
          </div>
        }
      >
        <UsageSessionRecords
          session={session}
          filter={recordFilter}
          revision={revision}
          onSummary={receiveSummary}
        />
      </DataPanel>
    </section>
  )
}
