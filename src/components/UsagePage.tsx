// SPDX-License-Identifier: MPL-2.0
import { allUsageSoftwareIds } from '@lumiplug/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  UsageSession,
  UsageSessionPage,
  UsageReport,
  UsageSoftware,
  UsageTotals,
} from '@lumiplug/shared'
import {
  Activity,
  CalendarDays,
  Download,
  Filter,
  Layers3,
  RefreshCw,
  Search,
  ScrollText,
  SlidersHorizontal,
} from 'lucide-react'
import {
  Badge,
  Button,
  DateRangeCalendar,
  Input,
  Tabs,
  MetricPair,
  AnimatedNumber,
  ProviderGlyph,
  DistributionRing,
  Pagination,
  Select,
  StackedBars,
  IconButton,
  MetricCard,
  DataPanel,
  DashboardToolbar,
  DataText,
  RankingList,
  ExpandableTable,
} from './ui'
import type { DataColumn, DataTone } from './ui'
import { useToast } from './ToastProvider'
import { exportUsageCsv, usageRequest } from '../lib/tauri'
import { localDate, tokenNumber, usageNames, usageRange } from '../lib/usage'
import {
  cacheRatio,
  dashboardTotals,
  detectedUsageSoftware,
  usageTrend,
  usageBucketRange,
  compactTokens,
  overallCacheRatio,
  percentLabel,
  previousUsageRange,
  tokenShare,
} from '../lib/usage-dashboard'
import { refreshRunState } from '../lib/run-task-refresh'
import { usageLogos } from '../assets/clients/logos'
import UsageSessionDetail from './UsageSessionDetail'
import './usage.css'
const tones = Object.fromEntries(
  allUsageSoftwareIds.map((name, index) => [
    name,
    (['accent', 'success', 'protocol', 'neutral'] as const)[index % 4],
  ]),
) as Record<UsageSoftware, DataTone>
const zero: UsageTotals = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 0 }
function ClientLogo({ software }: { software: UsageSoftware }) {
  if (!(software in usageLogos)) return <ProviderGlyph id={software} size={18} />
  const logo = usageLogos[software as keyof typeof usageLogos]
  return (
    <svg className="ui-choice-icon" viewBox={logo.viewBox} aria-hidden="true">
      {logo.paths.map((attrs, index) => (
        <path key={index} {...attrs} />
      ))}
    </svg>
  )
}
export default function UsagePage({ active, coreReady }: { active: boolean; coreReady: boolean }) {
  const toast = useToast()
  const [preset, setPreset] = useState('30'),
    [software, setSoftware] = useState<UsageSoftware | 'all'>('all'),
    [model, setModel] = useState('all')
  const [start, setStart] = useState(localDate(new Date())),
    [end, setEnd] = useState(localDate(new Date())),
    [day, setDay] = useState<string | null>(null)
  const [today, setToday] = useState(localDate(new Date()))
  const [report, setReport] = useState<UsageReport | null>(null),
    [base, setBase] = useState<UsageReport | null>(null),
    [previous, setPrevious] = useState<UsageReport | null>(null)
  const qoderIdentityWarningShown = useRef(false)
  const qoderIdentityWarning = 'Qoder 部分跨格式请求身份无法关联，已保留历史，统计可能包含重复。'
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0)
  const [rankTab, setRankTab] = useState('software'),
    [filtersOpen, setFiltersOpen] = useState(false),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('recent')
  const [rows, setRows] = useState<UsageSession[]>([]),
    [matched, setMatched] = useState(0),
    [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState(false)
  const [pageSelection, setPageSelection] = useState<{ filter: object | null; page: number }>({
    filter: null,
    page: 1,
  })
  const pageSize = 10
  const [selectedSession, setSelectedSession] = useState<{
    session: UsageSession
    filter: Record<string, unknown>
  } | null>(null)
  const pageRoot = useRef<HTMLDivElement>(null)
  const listPosition = useRef({ scrollTop: 0, trigger: null as HTMLButtonElement | null })
  const [exporting, setExporting] = useState(false),
    exportingRef = useRef(false)
  const calendarAnchor = useRef<HTMLDivElement>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const closeCalendar = useCallback(() => setCalendarOpen(false), [])
  const calendarToday =
    software === 'vercel-gateway' ? new Date().toISOString().slice(0, 10) : today
  const dateLabel = (date: Date) =>
    software === 'vercel-gateway' ? date.toISOString().slice(0, 10) : localDate(date)
  const range = useMemo(() => {
    try {
      const selected = usageRange(preset, start, end, null, new Date(`${calendarToday}T12:00:00`))
      return software === 'vercel-gateway'
        ? {
            start: `${localDate(new Date(selected.start))}T00:00:00.000Z`,
            end: `${localDate(new Date(selected.end))}T00:00:00.000Z`,
            timezone: 'UTC',
          }
        : selected
    } catch {
      return null
    }
  }, [preset, start, end, calendarToday, software])
  const payload = useMemo(
    () =>
      range
        ? {
            ...range,
            detectedOnly: true,
            ...(preset === '1' && software !== 'vercel-gateway' ? { granularity: 'hour' } : {}),
            ...(software === 'all' ? {} : { software }),
            ...(model === 'all' ? {} : { model: JSON.parse(model) as string | null }),
          }
        : null,
    [range, software, model, preset],
  )
  const detailPayload = useMemo(
    () =>
      payload
        ? { ...payload, ...(day ? usageBucketRange(payload, day) : {}), search: query, sort }
        : null,
    [payload, day, query, sort],
  )
  const filterKey = JSON.stringify(detailPayload)
  const page = pageSelection.filter === detailPayload ? pageSelection.page : 1
  const sessionRequest = useMemo(
    () =>
      detailPayload ? { ...detailPayload, offset: (page - 1) * pageSize, limit: pageSize } : null,
    [detailPayload, page],
  )
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (!active || !coreReady || !payload || !range) return
    setLoading(true)
    return refreshRunState({
      wakeTarget: window,
      interval: 60000,
      read: async () => {
        setToday(localDate(new Date()))
        const [selected, all, prior] = await Promise.all([
          usageRequest<UsageReport>('query', payload),
          software === 'all' && model === 'all'
            ? Promise.resolve(null)
            : usageRequest<UsageReport>('query', { ...range, detectedOnly: true }),
          usageRequest<UsageReport>('query', { ...payload, ...previousUsageRange(range) }).catch(
            () => null,
          ),
        ])
        return { selected, all: all ?? selected, prior }
      },
      update: (value) => {
        setReport(value.selected)
        setBase(value.all)
        setPrevious(value.prior)
        setLoading(false)
        const unverified = value.all.sources.some(
          (source) =>
            source.software === 'qoder' && source.problems?.includes('identity_unverified'),
        )
        if (unverified && !qoderIdentityWarningShown.current) toast(qoderIdentityWarning)
        qoderIdentityWarningShown.current = unverified
      },
      fail: () => {
        setLoading(false)
        toast('用量读取失败，请点击刷新重试。', 'error')
      },
    })
  }, [active, coreReady, payload, range, software, model, revision, toast])
  const loadedDetail = useRef(sessionRequest)
  useEffect(() => {
    if (!active || !coreReady || !sessionRequest) return
    let cancelled = false
    setDetailBusy(true)
    setDetailError(false)
    if (loadedDetail.current !== sessionRequest) {
      setRows([])
      loadedDetail.current = sessionRequest
    }
    void usageRequest<UsageSessionPage>('sessions', sessionRequest)
      .then((value) => {
        if (cancelled) return
        const last = Math.max(1, Math.ceil(value.matched / pageSize))
        setMatched(value.matched)
        if (page > last) {
          setPageSelection({ filter: detailPayload, page: last })
          return
        }
        setRows(value.sessions)
      })
      .catch(() => {
        if (!cancelled) {
          setDetailError(true)
          toast('会话明细读取失败，请重试。', 'error')
        }
      })
      .finally(() => {
        if (!cancelled) setDetailBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, coreReady, sessionRequest, detailPayload, revision, page, filterKey, toast])
  const scanning = useRef(false)
  const current = useRef({ payload })
  current.current = { payload }
  async function scan() {
    if (scanning.current || !payload || !coreReady) return
    scanning.current = true
    setBusy(true)
    try {
      const value = await usageRequest<UsageReport>('scan', payload)
      if (current.current.payload === payload) {
        setReport(value)
        setLoading(false)
      }
      setRevision((v) => v + 1)
      const unverified = value.sources.some(
        (source) => source.software === 'qoder' && source.problems?.includes('identity_unverified'),
      )
      qoderIdentityWarningShown.current = unverified
      if (unverified) toast(qoderIdentityWarning)
      else toast('已重新扫描用量并更新会话名称。', 'success')
    } catch {
      toast('用量扫描失败，请重试。', 'error')
    } finally {
      scanning.current = false
      setBusy(false)
    }
  }
  async function exportCsv() {
    if (!detailPayload || exportingRef.current || !coreReady) return
    exportingRef.current = true
    setExporting(true)
    try {
      const path = await exportUsageCsv(detailPayload)
      if (path) toast('已导出当前筛选下的全部会话。', 'success')
    } catch {
      toast('CSV 导出失败，请重试。', 'error')
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }
  const detected = detectedUsageSoftware(base ?? report)
  useEffect(() => {
    if (base && software !== 'all' && !detectedUsageSoftware(base).includes(software)) {
      setSoftware('all')
      setModel('all')
      setDay(null)
    }
    if (
      base &&
      model !== 'all' &&
      !base.models.some(
        (row) =>
          detectedUsageSoftware(base).includes(row.software) &&
          (software === 'all' || row.software === software) &&
          JSON.stringify(row.model) === model,
      )
    )
      setModel('all')
  }, [base, software, model])
  if (!active) return null
  const totals = dashboardTotals(report)
  const softwareOptions = detected
  const scopedSoftware = detected.filter((name) =>
    software === 'all' ? name !== 'vercel-gateway' : software === name,
  )
  const ranking = scopedSoftware
    .map((key) => ({ key, ...(report?.software.find((item) => item.key === key) ?? zero) }))
    .sort((a, b) => (a.total === null ? 1 : b.total === null ? -1 : b.total - a.total))
  const clients = ranking.filter((row) => row.count > 0).length
  const cache = overallCacheRatio(report?.software ?? [])
  const change =
    previous?.totals.total != null && previous.totals.total > 0 && totals.total !== null
      ? (totals.total - previous.totals.total) / previous.totals.total
      : null
  const models = (report?.models ?? [])
    .filter((row) => scopedSoftware.includes(row.software))
    .sort((a, b) => (a.total === null ? 1 : b.total === null ? -1 : b.total - a.total))
  const days = usageTrend(
    report,
    range,
    preset === '1' && software !== 'vercel-gateway',
    scopedSoftware,
  )
  const columns: DataColumn<UsageSession>[] = [
    {
      key: 'time',
      label: software === 'vercel-gateway' ? '汇总日期（UTC）' : '最近活动',
      render: (row) => (
        <div className="usage-cell-stack">
          <DataText mono>
            <time dateTime={row.latestTime}>
              {new Date(row.latestTime).toLocaleTimeString([], { hour12: false })}
            </time>
          </DataText>
          <DataText muted>{dateLabel(new Date(row.latestTime))}</DataText>
        </div>
      ),
    },
    {
      key: 'session',
      label: '会话 / 软件与模型',
      render: (row) => (
        <div className="usage-session-cell">
          <ClientLogo software={row.software} />
          <div className="usage-cell-stack">
            <strong className="usage-session-name">
              {row.sessionName?.trim() || row.session}{' '}
              {row.estimatedCount ? <Badge>含估算</Badge> : null}
            </strong>
            <DataText muted>
              {usageNames[row.software]} ·{' '}
              {(row.models ?? []).map((name) => name ?? '未知模型').join(' / ') || '未知模型'}
            </DataText>
          </div>
        </div>
      ),
    },
    {
      key: 'io',
      label: '输入 / 输出',
      render: (row) => (
        <span className="usage-token-pair">
          <DataText muted mono>
            {compactTokens(row.input)}
          </DataText>
          <DataText muted>/</DataText>
          <DataText tone="protocol" mono>
            {compactTokens(row.output)}
          </DataText>
        </span>
      ),
    },
    {
      key: 'cache',
      label: '缓存命中',
      render: (row) => (
        <Badge tone="success">
          {percentLabel(cacheRatio(row))} ({compactTokens(row.cacheRead)})
        </Badge>
      ),
    },
    {
      key: 'total',
      label: '总计',
      align: 'end',
      render: (row) => (
        <strong>
          <DataText mono>{compactTokens(row.total)}</DataText>
        </strong>
      ),
    },
  ]
  const rangeLabel = range
    ? `${dateLabel(new Date(range.start)).replaceAll('-', '/')} – ${dateLabel(new Date(new Date(range.end).getTime() - 1)).replaceAll('-', '/')}`
    : '选择日期'
  return (
    <div ref={pageRoot} className={`usage-page${selectedSession ? ' usage-page--detail' : ''}`}>
      {selectedSession && (
        <UsageSessionDetail
          session={
            detailPayload === selectedSession.filter
              ? (rows.find((row) => row.key === selectedSession.session.key) ??
                selectedSession.session)
              : selectedSession.session
          }
          filter={selectedSession.filter}
          revision={revision}
          refreshing={busy}
          coreReady={coreReady}
          onRefresh={() => void scan()}
          onBack={() => {
            setSelectedSession(null)
            requestAnimationFrame(() => {
              const workspace = pageRoot.current?.closest('.workspace-content')
              if (workspace) workspace.scrollTop = listPosition.current.scrollTop
              listPosition.current.trigger?.focus({ preventScroll: true })
            })
          }}
        />
      )}
      <div hidden={!!selectedSession}>
        <div className="usage-page">
          <DashboardToolbar bare>
            <div className="usage-software-tabs">
              <Tabs
                className="ui-list-toolbar-tabs"
                label="软件筛选"
                value={software}
                onValueChange={(value) => {
                  setSoftware(value)
                  setModel('all')
                  setDay(null)
                }}
                items={[
                  { value: 'all' as const, label: '全部' },
                  ...softwareOptions.map((value) => ({
                    value,
                    label: (
                      <span className="ui-choice-content">
                        <ClientLogo software={value} />
                        {usageNames[value]}
                      </span>
                    ),
                  })),
                ]}
              />
            </div>
            <div className="usage-date-actions" ref={calendarAnchor}>
              <Tabs
                label="时间范围"
                value={preset}
                onValueChange={(v) => {
                  if (v === 'custom') {
                    setCalendarOpen((open) => !open)
                    return
                  }
                  setPreset(v)
                  setDay(null)
                  setCalendarOpen(false)
                }}
                items={[
                  { value: '1', label: '今日' },
                  { value: '7', label: '近 7 天' },
                  { value: '30', label: '近 30 天' },
                  {
                    value: 'custom',
                    label: (
                      <span className="ui-choice-content">
                        <CalendarDays size={16} aria-hidden="true" />
                        {rangeLabel}
                      </span>
                    ),
                    accessibleLabel: `自定义日期 ${rangeLabel}`,
                  },
                ]}
              />
              <IconButton
                label="导出 CSV"
                title="导出当前筛选会话的 CSV"
                disabled={!coreReady || !detailPayload}
                loading={exporting}
                onClick={() => void exportCsv()}
              >
                <Download aria-hidden="true" />
              </IconButton>
              <IconButton
                label="刷新用量"
                title="重新扫描本地用量和会话名称"
                disabled={!coreReady || !payload}
                loading={busy}
                loadingAnimation="spin"
                onClick={() => void scan()}
              >
                <RefreshCw aria-hidden="true" />
              </IconButton>
            </div>
            {calendarOpen && (
              <DateRangeCalendar
                anchorRef={calendarAnchor}
                start={
                  preset === 'custom'
                    ? start
                    : range?.start
                      ? dateLabel(new Date(range.start))
                      : start
                }
                end={preset === 'custom' ? end : calendarToday}
                onClose={closeCalendar}
                onApply={(first, last) => {
                  try {
                    usageRange('custom', first, last, null)
                    setStart(first)
                    setEnd(last)
                    setPreset('custom')
                    setDay(null)
                    setCalendarOpen(false)
                  } catch (error) {
                    toast((error as Error).message, 'error')
                  }
                }}
              />
            )}
          </DashboardToolbar>
          <div className="usage-metrics" aria-busy={loading || undefined}>
            <MetricCard
              label="总 Token 吞吐"
              tone="accent"
              badge={
                <>
                  {' '}
                  {totals.estimatedCount ? <Badge>含估算</Badge> : null}
                  {change !== null ? (
                    <Badge tone={change > 0 ? 'accent' : 'success'} title="与上一等长日期区间相比">
                      {change >= 0 ? '+' : ''}
                      {(change * 100).toFixed(1)}%
                    </Badge>
                  ) : null}
                </>
              }
            >
              <MetricPair
                first={{
                  label: '输入 Token',
                  value: <AnimatedNumber value={totals.input} format={compactTokens} />,
                  exact: tokenNumber(totals.input),
                  tone: 'accent',
                }}
                second={{
                  label: '输出 Token',
                  value: <AnimatedNumber value={totals.output} format={compactTokens} />,
                  exact: tokenNumber(totals.output),
                  tone: 'protocol',
                }}
              />
            </MetricCard>
            <MetricCard
              label="Prompt 缓存复用"
              tone="success"
              badge={<Badge tone="success">命中率 {percentLabel(cache)}</Badge>}
            >
              <MetricPair
                first={{
                  label: '缓存读取 Token',
                  value: <AnimatedNumber value={totals.cacheRead} format={compactTokens} />,
                  exact: tokenNumber(totals.cacheRead),
                  tone: 'success',
                }}
                second={{
                  label: '缓存写入 Token',
                  value: <AnimatedNumber value={totals.cacheWrite} format={compactTokens} />,
                  exact: tokenNumber(totals.cacheWrite),
                  tone: 'success',
                }}
              />
            </MetricCard>
            <MetricCard
              label="活跃设备"
              tone="protocol"
              badge={
                <Badge aria-label={`${clients} 款软件有记录`}>
                  <AnimatedNumber value={clients} />
                </Badge>
              }
            >
              <DistributionRing
                label="设备 Token 占比"
                items={scopedSoftware.map((key) => ({
                  key,
                  label: usageNames[key],
                  value:
                    report?.software.find((row) => row.key === key)?.total ??
                    (report?.software.some((row) => row.key === key) ? null : 0),
                  tone: tones[key],
                }))}
              />
            </MetricCard>
          </div>
          <div className="usage-analysis-grid">
            <DataPanel className="usage-chart-panel">
              <StackedBars
                animate
                appearance="dashboard"
                title={software === 'vercel-gateway' ? '用量趋势（按日 · UTC）' : '用量趋势'}
                label={preset === '1' && software !== 'vercel-gateway' ? '每小时用量' : '每日用量'}
                series={scopedSoftware.map((key) => ({
                  key,
                  label: usageNames[key],
                  tone: tones[key],
                }))}
                days={days}
                showHint={false}
                onSelect={(date) => setDay(date)}
              />
            </DataPanel>
            <DataPanel
              className="usage-ranking-panel"
              actions={
                <>
                  <Tabs
                    label="排行类型"
                    value={rankTab}
                    onValueChange={setRankTab}
                    items={[
                      {
                        value: 'software',
                        label: (
                          <span className="ui-choice-content">
                            <SlidersHorizontal size={16} aria-hidden="true" />
                            软件排行
                          </span>
                        ),
                      },
                      {
                        value: 'models',
                        label: (
                          <span className="ui-choice-content">
                            <Layers3 size={16} aria-hidden="true" />
                            模型明细
                          </span>
                        ),
                      },
                    ]}
                  />
                  <DataText muted>按总量降序</DataText>
                </>
              }
            >
              <div className="usage-ranking-scroll">
                <RankingList
                  animate
                  compact
                  label={rankTab === 'software' ? '软件排行' : '模型明细'}
                  rows={
                    rankTab === 'software'
                      ? ranking.map((row) => ({
                          key: row.key,
                          label: usageNames[row.key],
                          icon: <ClientLogo software={row.key} />,
                          value: `${row.estimatedCount ? '≈ ' : ''}${compactTokens(row.total)}`,
                          numericValue: row.total,
                          formatValue: (value) =>
                            `${row.estimatedCount ? '≈ ' : ''}${compactTokens(value)}`,
                          share: tokenShare(row.total, totals.total),
                          tone: tones[row.key],
                        }))
                      : models.length
                        ? models.map((row) => ({
                            key: row.key,
                            label: row.model ?? '未知模型',
                            icon: <ClientLogo software={row.software} />,
                            value: `${row.estimatedCount ? '≈ ' : ''}${compactTokens(row.total)}`,
                            numericValue: row.total,
                            formatValue: (value) =>
                              `${row.estimatedCount ? '≈ ' : ''}${compactTokens(value)}`,
                            share: tokenShare(row.total, totals.total),
                            tone: tones[row.software],
                          }))
                        : [
                            {
                              key: 'empty',
                              label: '暂无模型',
                              value: '0',
                              share: 0,
                              tone: 'neutral',
                            },
                          ]
                  }
                />
              </div>
            </DataPanel>
          </div>
          <DataPanel
            title={
              <>
                {software === 'vercel-gateway' ? '网关日汇总' : '会话明细'}{' '}
                <Badge>
                  共 {matched.toLocaleString()} 个{software === 'vercel-gateway' ? '汇总' : '会话'}
                </Badge>
              </>
            }
            icon={<ScrollText />}
            actions={
              <div className="usage-log-actions">
                <label className="usage-search">
                  <span className="sr-only">搜索会话</span>
                  <Search size={16} aria-hidden="true" />
                  <Input
                    type="search"
                    placeholder="搜索会话名称 / 编号 / 模型…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <Select
                  aria-label="会话排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recent">最近互动优先</option>
                  <option value="tokens">总 Token 降序</option>
                </Select>
                <Button aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
                  <Filter size={16} aria-hidden="true" />
                  筛选
                  {model !== 'all' || day ? <Badge tone="accent">已应用</Badge> : null}
                </Button>
              </div>
            }
          >
            {filtersOpen && (
              <div className="usage-toolbar usage-session-filters">
                <Select
                  aria-label="模型筛选"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  <option value="all">全部模型</option>
                  {[
                    ...new Set(
                      (base?.models ?? [])
                        .filter((row) => scopedSoftware.includes(row.software))
                        .map((row) => row.model),
                    ),
                  ].map((name) => (
                    <option key={JSON.stringify(name)} value={JSON.stringify(name)}>
                      {name ?? '未知模型'}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {model !== 'all' && (
              <div className="usage-toolbar usage-session-filters">
                <Badge>{(JSON.parse(model) as string | null) ?? '未知模型'}</Badge>
                <Button variant="text" onClick={() => setModel('all')}>
                  清除模型筛选
                </Button>
              </div>
            )}
            {day && (
              <div className="usage-toolbar usage-session-filters">
                <Badge tone="accent">
                  <Activity size={12} aria-hidden="true" />
                  {day.includes('T')
                    ? new Date(day).toLocaleString([], {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : day}
                </Badge>
                <Button variant="text" onClick={() => setDay(null)}>
                  清除时间筛选
                </Button>
              </div>
            )}
            <ExpandableTable
              key={JSON.stringify(sessionRequest)}
              fixedHeight
              label="会话用量明细"
              rows={rows}
              columns={columns}
              rowKey={(row) => row.key}
              rowName={(row) => row.sessionName?.trim() || row.session}
              busy={detailBusy}
              empty={
                detailError ? (
                  <Button onClick={() => setRevision((v) => v + 1)}>重试读取</Button>
                ) : (
                  '暂无会话 · 0 Token'
                )
              }
              onRowOpen={(session) => {
                if (!detailPayload) return
                const root = pageRoot.current
                const row = Array.from(
                  root?.querySelectorAll<HTMLTableRowElement>('[data-row-key]') ?? [],
                ).find((element) => element.dataset.rowKey === session.key)
                listPosition.current = {
                  scrollTop: root?.closest('.workspace-content')?.scrollTop ?? 0,
                  trigger: row?.querySelector('button') ?? null,
                }
                setCalendarOpen(false)
                setSelectedSession({ session, filter: detailPayload })
                root?.closest('.workspace-content')?.scrollTo({ top: 0 })
              }}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={matched}
              busy={detailBusy || !coreReady || !detailPayload}
              onPageChange={(next) => setPageSelection({ filter: detailPayload, page: next })}
            />
          </DataPanel>
        </div>
      </div>
    </div>
  )
}
