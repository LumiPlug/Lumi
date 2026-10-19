// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { UsageRecord, UsageReport, UsageSession } from '@lumiplug/shared'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button, Card, DataText } from './ui'
import { usageRequest } from '../lib/tauri'
import { tokenNumber } from '../lib/usage'
import { useToast } from './ToastProvider'
import { UsageRecordTable } from './UsageRecordCard'

export type UsageSessionSummary = { total: number | null; count: number }

export function UsageSessionHeading({
  session,
  expanded,
  panelId,
  onToggle,
}: {
  session: UsageSession
  expanded: boolean
  panelId: string
  onToggle: () => void
}) {
  useLocale()

  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <Button
      variant="text"
      className="usage-session-trigger"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <span className="usage-session-heading">
        <Chevron size={18} aria-hidden="true" />
        <span className="usage-session-name">{session.sessionName?.trim() || session.session}</span>
        <strong>{tokenNumber(session.total)} Token</strong>
      </span>
    </Button>
  )
}

export default function UsageSessionCard({
  session,
  filter,
  revision,
}: {
  session: UsageSession
  filter: Record<string, unknown>
  revision: number
}) {
  useLocale()

  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  return (
    <Card>
      <UsageSessionHeading
        session={session}
        expanded={expanded}
        panelId={panelId}
        onToggle={() => setExpanded((open) => !open)}
      />
      <div id={panelId} hidden={!expanded}>
        {expanded && <UsageSessionRecords session={session} filter={filter} revision={revision} />}
      </div>
    </Card>
  )
}

export function UsageSessionRecords({
  session,
  filter,
  revision,
  onSummary,
}: {
  session: UsageSession
  filter: Record<string, unknown>
  revision: number
  onSummary?: (summary: UsageSessionSummary | null) => void
}) {
  useLocale()

  const toast = useToast()
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const query = useMemo(
    () => ({ ...filter, software: session.software, session: session.session }),
    [filter, session.software, session.session],
  )
  const request = useMemo(() => ({ query, revision, retry }), [query, revision, retry])
  const current = useRef(request)
  current.current = request
  const paging = useRef(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setMore(false)
    setRecords([])
    onSummary?.(null)
    void usageRequest<UsageReport>('query', query)
      .then((value) => {
        if (cancelled) return
        setRecords(value.records)
        setMore(value.truncated)
        onSummary?.({ total: value.totals.total, count: value.matched })
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        toast(t('会话记录读取失败，请重试。'), 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, revision, retry, toast, onSummary])
  async function loadMore() {
    if (loading || paging.current) return
    paging.current = true
    setLoading(true)
    try {
      const value = await usageRequest<UsageReport>('query', { ...query, offset: records.length })
      if (current.current !== request) return
      setRecords((rows) => [...rows, ...value.records])
      setMore(value.truncated)
    } catch {
      if (current.current === request) toast(t('会话记录读取失败，请重试。'), 'error')
    } finally {
      paging.current = false
      if (current.current === request) setLoading(false)
    }
  }
  return (
    <div className="usage-session-records" aria-busy={loading || undefined}>
      <UsageRecordTable
        key={JSON.stringify(query)}
        records={records}
        busy={loading}
        empty={
          loading ? (
            <span role="status">
              <DataText muted>{t('正在读取…')}</DataText>
            </span>
          ) : failed ? (
            <Button onClick={() => setRetry((value) => value + 1)}>{t('重试读取')}</Button>
          ) : (
            <span role="status">
              <DataText muted>{t('当前筛选范围内暂无会话记录。')}</DataText>
            </span>
          )
        }
      />
      {more && (
        <div>
          <Button loading={loading} onClick={() => void loadMore()}>
            {t('加载更多会话记录')}
          </Button>
        </div>
      )}
    </div>
  )
}
