// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  StackedBars,
  MetricCard,
  MetricPair,
  AnimatedNumber,
  ProviderGlyph,
  DistributionRing,
  DateRangeCalendar,
  Pagination,
  DataPanel,
  DataText,
  RankingList,
  ExpandableTable,
  Badge,
  Button,
  Card,
  Checkbox,
  Switch,
  Field,
  FieldGroup,
  FieldRow,
  IconButton,
  Input,
  InputHint,
  Modal,
  NavigationButton,
  WindowPanel,
  Segmented,
  Select,
  Tabs,
  Textarea,
  Tooltip,
  ThemePicker,
  ChoiceCard,
  SurfaceEffects,
  StageSection,
  LogViewer,
  TreeView,
  GraphView,
  DocumentViewer,
} from './ui'
import { copyText } from '../lib/clipboard'
import { UsageSessionHeading } from './UsageSessionCard'
import './usage.css'
import { terminalOutputText } from '../lib/terminal-output'
import { ArrowLeft, CalendarDays, Copy, Home, RefreshCw, Settings, Wrench } from 'lucide-react'
import { UsageRecordTable } from './UsageRecordCard'
import { compactTokens } from '../lib/usage-dashboard'
import { usageLogos } from '../assets/clients/logos'
import { RunParameters } from './RunParameters'
import RunConfigurationFields from './RunConfigurationFields'
import { multilineRunField } from '../lib/tool-run'
import ConfirmationDialog from './ConfirmationDialog'
import { useToast } from './ToastProvider'
import './ui-components.css'
import ResourceCardDesignPreview from './ResourceCardDesignPreview'
import { TerminalParameters } from './TerminalParameters'
import { createCapabilityDefinition } from '@lumiplug/shared'

type Panel = 'controls' | 'forms' | 'feedback' | 'cards'
function Icon({ name }: { name: 'play' | 'settings' | 'plus' }) {
  useLocale()

  const paths = {
    play: 'm8 5 11 7-11 7V5Z',
    plus: 'M12 5v14M5 12h14',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3 2-2-2-3-3 1-2-1-1-3h-2l-1 3-2 1-3-1-2 3 2 2v2l-2 2 2 3 3-1 2 1 1 3h2l1-3 2-1 3 1 2-3-2-2v-2Z',
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
function DemoRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  useLocale()

  return (
    <section className="ui-demo-row">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="ui-demo-controls">{children}</div>
    </section>
  )
}

function SessionNavigationPreview() {
  useLocale()

  const [open, setOpen] = useState(false)
  const [range, setRange] = useState({ start: '2026-10-16', end: '2026-10-17' })
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarAnchor = useRef<HTMLDivElement>(null)
  const closeCalendar = useCallback(() => setCalendarOpen(false), [])
  const records = ['2026-10-16', '2026-10-17']
    .filter((day) => day >= range.start && day <= range.end)
    .map((day) => ({
      id: day,
      software: 'codex' as const,
      time: `${day}T10:00:00`,
      model: t('示例模型'),
      session: 'synthetic',
      total: 20250,
      input: 16200,
      output: 4050,
      cacheRead: 12150,
      cacheWrite: null,
      inputIncludesCache: true,
      quality: 'reported' as const,
    }))
  const heading = useRef<HTMLHeadingElement>(null)
  const table = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true })
  }, [open])
  return (
    <div className="usage-page">
      <div ref={table} hidden={open}>
        <ExpandableTable
          label={t('导航会话表格示例')}
          rows={[{ key: 'sample', name: t('示例会话'), total: '40.5K' }]}
          rowKey={(row) => row.key}
          rowName={(row) => row.name}
          columns={[
            { key: 'name', label: t('会话名称'), render: (row) => row.name },
            {
              key: 'total',
              label: t('总计'),
              align: 'end',
              render: (row) => <DataText mono>{row.total}</DataText>,
            },
          ]}
          onRowOpen={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="usage-page">
          <header className="usage-detail-header">
            <IconButton
              label={t('返回示例会话列表')}
              onClick={() => {
                setOpen(false)
                requestAnimationFrame(() =>
                  table.current?.querySelector('button')?.focus({ preventScroll: true }),
                )
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </IconButton>
            <h2 ref={heading} tabIndex={-1} className="ui-detail-heading">
              {t('示例会话')}
            </h2>
          </header>
          <DataPanel
            className="usage-records-panel usage-records-preview"
            title={t('用量记录（{v0}条）', { v0: records.length })}
            actions={
              <div className="usage-log-actions">
                <div ref={calendarAnchor}>
                  <Segmented
                    label={t('示例会话时间范围')}
                    value=""
                    onValueChange={() => setCalendarOpen((value) => !value)}
                    items={[
                      {
                        value: 'custom',
                        accessibleLabel: t('选择示例时间范围 {v0} – {v1}', {
                          v0: range.start,
                          v1: range.end,
                        }),
                        label: (
                          <span className="ui-choice-content">
                            <CalendarDays size={16} aria-hidden="true" />
                            {range.start} – {range.end}
                          </span>
                        ),
                      },
                    ]}
                  />
                  {calendarOpen && (
                    <DateRangeCalendar
                      anchorRef={calendarAnchor}
                      start={range.start}
                      end={range.end}
                      onClose={closeCalendar}
                      onApply={(start, end) => {
                        setRange({ start, end })
                        setCalendarOpen(false)
                      }}
                    />
                  )}
                </div>
                <Badge>
                  {t('总计 ')}
                  {compactTokens(records.reduce((sum, row) => sum + row.total, 0))} Token
                </Badge>
              </div>
            }
          >
            <UsageRecordTable
              records={records}
              label={t('合成会话记录')}
              empty={<DataText muted>{t('所选日期暂无合成记录。')}</DataText>}
            />
          </DataPanel>
        </div>
      )}
    </div>
  )
}
export default function UiComponentsPage({
  theme,
  onThemeChange,
  back,
}: {
  theme: 'dark' | 'light'
  onThemeChange: (value: 'dark' | 'light') => void
  back: () => void
}) {
  useLocale()

  const toast = useToast()
  async function copyPreview(text: string, kind: string) {
    try {
      const copied = await copyText(text)
      toast(
        copied ? t('已复制{v0}。', { v0: kind }) : t('复制失败，请重试。'),
        copied ? 'success' : 'error',
      )
    } catch {
      toast(t('复制失败，请重试。'), 'error')
    }
  }
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  const [chartDetail, setChartDetail] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const [logLines, setLogLines] = useState(40)
  const [outputType, setOutputType] = useState('terminal')
  const [windowOutput, setWindowOutput] = useState('log')
  const previewLog = [
    ...(outputType === 'terminal'
      ? [
          t('\u001b[32m✓ 服务已启动 🚀\u001b[0m'),
          t('中文与 Emoji：👩🏽‍💻 🧑‍🚀 ❤️ 🇨🇳'),
          t(
            '\u001b[1;31m红色加粗\u001b[0m · \u001b[4;36m青色下划线\u001b[0m · \u001b[43;30m黄色背景\u001b[0m',
          ),
          t('\u001b[38;5;208m256 色\u001b[0m · \u001b[38;2;180;130;250mRGB 真彩色\u001b[0m'),
          t('\u001b]8;;https://example.com\u0007日志中的链接文字\u001b]8;;\u0007'),
        ]
      : []),
    ...Array.from({ length: logLines }, (_, index) => t('运行输出 {v0}', { v0: index + 1 })),
  ].join('\n')
  const [knowledgeSelection, setKnowledgeSelection] = useState<string | null>('overview')
  const [panel, setPanel] = useState<Panel>('controls')
  const [choice, setChoice] = useState('all')
  const [navigationChoice, setNavigationChoice] = useState('workbench')
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [method, setMethod] = useState('GET')
  const [previewOperation, setPreviewOperation] = useState('')
  const [previewParameters, setPreviewParameters] = useState(1)
  const [previewTerminal, setPreviewTerminal] = useState(() => {
    const definition = createCapabilityDefinition({
      kind: 'terminal',
      name: t('参数表示例'),
      command: 'printf "%s\\n" "$PROJECT"',
    })
    definition.tools[0]!.fields = [
      {
        key: 'PROJECT',
        schema: {
          type: 'string',
          title: t('项目名称'),
          default: 'gushan',
          description: t('输出的项目名称'),
        },
        required: true,
        aiVisible: true,
        value: null,
        binding: { location: 'argument', key: 'PROJECT' },
      },
      {
        key: 'COUNT',
        schema: {
          type: 'integer',
          title: t('显示次数'),
          default: 3,
          description: t('输出内容的次数'),
        },
        required: false,
        aiVisible: true,
        value: null,
        binding: { location: 'argument', key: 'COUNT' },
      },
    ]
    return definition
  })
  const [previewParameterType, setPreviewParameterType] = useState('terminal')
  const [previewHeaderVisible, setPreviewHeaderVisible] = useState(false)
  const [previewPath, setPreviewPath] = useState(
    '/Users/zj/Documents/projects/long-directory-name/workspaces/terminal-tools/development/services/gushan_server',
  )
  const [sessionOpen, setSessionOpen] = useState(false)
  const [previewUsagePage, setPreviewUsagePage] = useState(1)
  const calendarAnchor = useRef<HTMLDivElement>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const closeCalendar = useCallback(() => setCalendarOpen(false), [])
  const [calendarRange, setCalendarRange] = useState({ start: '2026-10-01', end: '2026-10-17' })
  const [previewRingRevision, setPreviewRingRevision] = useState(0)
  const [previewDataChanged, setPreviewDataChanged] = useState(false)
  const [checked, setChecked] = useState(false)
  const [switchOn, setSwitchOn] = useState(true)
  const [listCategory, setListCategory] = useState('all')
  const [listQuery, setListQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [modal, setModal] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <SurfaceEffects depth="heavy" className="ui-components-page">
      <header className="ui-components-header">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {t('UI组件')}
          </h1>
          <p>{t('共用组件与真实交互 · 仅开发环境')}</p>
        </div>
        <Button onClick={back}>{t('返回设置')}</Button>
      </header>
      <div className="ui-components-summary">
        <p>{t('36px 控件 · 4px 圆角 · 琥珀选中 · 重阴影预览 · outline 底部光晕')}</p>
        <Segmented
          label={t('组件预览主题')}
          value={theme}
          onValueChange={onThemeChange}
          items={[
            { value: 'dark', label: t('深色') },
            { value: 'light', label: t('浅色') },
          ]}
        />
      </div>
      <DemoRow
        title={t('用量仪表盘')}
        description={t(
          '合成示例 · 更新数据可核对数字、趋势与排行动画；快速重复点击验证中断接续，减少动态效果时直接落位。',
        )}
      >
        <div style={{ display: 'grid', gap: 16, width: '100%' }}>
          <Button onClick={() => setPreviewDataChanged((value) => !value)}>
            {t('更新合成数据')}
          </Button>
          <MetricCard
            label={t('总 Token 吞吐')}
            value="40.5K"
            exact="40,500"
            tone="accent"
            highlight
            badge={<Badge tone="success">+8.2%</Badge>}
            footer={
              <>
                <DataText muted>{t('输入 32.4K')}</DataText>
                <DataText tone="protocol">{t('输出 8.1K')}</DataText>
              </>
            }
          />
          <div ref={calendarAnchor}>
            <Button onClick={() => setCalendarOpen(true)}>{t('日期范围日历示例')}</Button>
            {calendarOpen && (
              <DateRangeCalendar
                anchorRef={calendarAnchor}
                start={calendarRange.start}
                end={calendarRange.end}
                onClose={closeCalendar}
                onApply={(start, end) => {
                  setCalendarRange({ start, end })
                  setCalendarOpen(false)
                }}
              />
            )}
          </div>
          <Card>
            <div className="usage-toolbar">
              {['gemini', 'copilot', 'opencode', 'amp', 'warp', 'vercel-gateway'].map((id) => (
                <span className="ui-choice-content" key={id}>
                  <ProviderGlyph id={id} size={18} />
                  {id}
                </span>
              ))}
            </div>
          </Card>
          <MetricCard label={t('双数值统计示例')}>
            <MetricPair
              first={{
                label: t('输入 Token'),
                value: <AnimatedNumber value={previewDataChanged ? 64800 : 32400} />,
              }}
              second={{
                label: t('输出 Token'),
                value: <AnimatedNumber value={previewDataChanged ? 20250 : 8100} />,
              }}
            />
          </MetricCard>
          <MetricCard label={t('设备占比示例')} badge={<Badge>2</Badge>}>
            <DistributionRing
              key={previewRingRevision}
              label={t('合成软件占比')}
              items={[
                { key: 'a', label: t('软件 A'), value: 70, tone: 'accent' },
                { key: 'b', label: t('软件 B'), value: 30, tone: 'protocol' },
              ]}
            />
          </MetricCard>
          <Button onClick={() => setPreviewRingRevision((value) => value + 1)}>
            {t('重播圆环动效')}
          </Button>
          <Segmented
            appearance="enclosed"
            label={t('仪表盘分组筛选示例')}
            value={choice}
            onValueChange={setChoice}
            items={[
              { value: 'all', label: t('全部') },
              { value: 'terminal', label: t('终端') },
            ]}
          />
          <Segmented
            appearance="chips"
            label={t('仪表盘模型筛选示例')}
            value={choice}
            onValueChange={setChoice}
            items={[
              { value: 'all', label: t('全部模型') },
              { value: 'terminal', label: t('示例模型') },
            ]}
          />
          <DataPanel title={t('软件排行')}>
            <RankingList
              animate
              label={t('软件排行示例')}
              rows={[
                {
                  key: 'sample',
                  label: t('示例软件'),
                  value: previewDataChanged ? '85.05K' : '40.5K',
                  numericValue: previewDataChanged ? 85050 : 40500,
                  formatValue: (value) =>
                    value === null
                      ? t('未知')
                      : new Intl.NumberFormat('en', {
                          notation: 'compact',
                          maximumFractionDigits: 2,
                        }).format(value),
                  share: previewDataChanged ? 0.92 : 0.68,
                  tone: 'accent',
                },
                { key: 'zero', label: t('零数据软件'), value: '0', share: 0, tone: 'protocol' },
              ]}
            />
          </DataPanel>
          <DataPanel title={t('模型明细')}>
            <RankingList
              animate
              label={t('模型明细示例')}
              rows={[
                {
                  key: 'model-a',
                  label: t('示例模型 A'),
                  value: previewDataChanged ? '34.02K' : '30.38K',
                  numericValue: previewDataChanged ? 34020 : 30375,
                  formatValue: (value) =>
                    value === null
                      ? t('未知')
                      : new Intl.NumberFormat('en', {
                          notation: 'compact',
                          maximumFractionDigits: 2,
                        }).format(value),
                  share: previewDataChanged ? 0.4 : 0.75,
                  tone: 'accent',
                },
                {
                  key: 'model-b',
                  label: t('示例模型 B'),
                  value: previewDataChanged ? '51.03K' : '10.13K',
                  numericValue: previewDataChanged ? 51030 : 10125,
                  formatValue: (value) =>
                    value === null
                      ? t('未知')
                      : new Intl.NumberFormat('en', {
                          notation: 'compact',
                          maximumFractionDigits: 2,
                        }).format(value),
                  share: previewDataChanged ? 0.6 : 0.25,
                  tone: 'protocol',
                },
              ]}
            />
          </DataPanel>
          <ExpandableTable
            fixedHeight
            label={t('会话表格示例')}
            rows={[{ key: 'sample', name: t('示例会话'), total: '40,500' }]}
            rowKey={(row) => row.key}
            rowName={(row) => row.name}
            columns={[
              { key: 'name', label: t('会话名称'), render: (row) => row.name },
              {
                key: 'tokens',
                label: t('总 Token'),
                align: 'end',
                render: (row) => <DataText mono>{row.total}</DataText>,
              },
            ]}
            renderExpanded={() => <p>{t('合成记录 · Enter / 空格或点击行展开。')}</p>}
          />
          <Pagination
            page={previewUsagePage}
            total={1234}
            pageSize={10}
            onPageChange={setPreviewUsagePage}
          />
          <StackedBars
            animate
            appearance="dashboard"
            title={t('每日用量')}
            series={[{ key: 'sample', label: t('示例软件'), tone: 'accent' }]}
            days={[
              { date: '2026-10-15', values: { sample: previewDataChanged ? 52000 : 12000 } },
              { date: '2026-10-16', values: { sample: previewDataChanged ? 31000 : 40500 } },
            ]}
            showHint={false}
            onSelect={() => setChartDetail(true)}
          />
        </div>
      </DemoRow>
      <DemoRow
        title={t('会话二级页面')}
        description={t(
          '合成示例 · 点击行或具名箭头进入详情；支持 Enter / 空格与返回列表，沿用共用表格视觉。',
        )}
      >
        <SessionNavigationPreview />
      </DemoRow>
      <DemoRow
        title={t('会话汇总展开')}
        description={t(
          '合成示例 · 复用 Card 与 Button text，汇总名称和总 Token，Enter/空格或点击展开。',
        )}
      >
        <Card style={{ width: '100%' }}>
          <UsageSessionHeading
            session={{
              key: 'example',
              session: 'synthetic-hash',
              sessionName: t('示例会话'),
              software: 'codex',
              latestTime: '2026-10-16T00:00:00Z',
              total: 40500,
              input: 32400,
              output: 8100,
              cacheRead: 12150,
              cacheWrite: null,
              count: 405,
            }}
            expanded={sessionOpen}
            panelId="preview-session-records"
            onToggle={() => setSessionOpen((value) => !value)}
          />
          <div id="preview-session-records" hidden={!sessionOpen}>
            <p>{t('合成记录内容 · 完整会话汇总不受记录分页影响。')}</p>
          </div>
        </Card>
      </DemoRow>
      <DemoRow
        title={t('刷新图标与零用量')}
        description={t(
          '合成示例 · 扫描时旋转、禁止重复提交；减少动态效果时保持静止。空日期显示 0。',
        )}
      >
        <IconButton
          label={t('刷新示例')}
          loadingAnimation="spin"
          loading={loading}
          onClick={() => {
            setLoading(true)
            timer.current = setTimeout(() => setLoading(false), 1500)
          }}
        >
          <RefreshCw aria-hidden="true" />
        </IconButton>
        <Segmented
          label={t('带 Logo 的软件筛选示例')}
          value={choice}
          onValueChange={setChoice}
          items={[
            { value: 'all', label: t('全部') },
            {
              value: 'terminal',
              label: (
                <span className="ui-choice-content">
                  <svg
                    className="ui-choice-icon"
                    viewBox={usageLogos.codex.viewBox}
                    aria-hidden="true"
                  >
                    {usageLogos.codex.paths.map((attrs, index) => (
                      <path key={index} {...attrs} />
                    ))}
                  </svg>
                  {t('软件示例')}
                </span>
              ),
            },
          ]}
        />
        <div style={{ width: '100%' }}>
          <StackedBars
            series={[{ key: 'a', label: t('软件 A') }]}
            days={[{ date: '2026-10-16', values: { a: 0 } }]}
            onSelect={() => setChartDetail(true)}
            showHint={false}
          />
        </div>
      </DemoRow>
      <DemoRow
        title={t('日堆叠图与明细抽屉')}
        description={t('合成示例 · 图例切换、键盘日期筛选、共用 Modal 侧边布局。')}
      >
        <div style={{ width: '100%' }}>
          <StackedBars
            series={[
              { key: 'a', label: t('软件 A') },
              { key: 'b', label: t('软件 B') },
            ]}
            days={[
              { date: '2026-10-10', values: { a: 100, b: 60 } },
              { date: '2026-10-11', values: { a: 80, b: null } },
            ]}
            onSelect={() => setChartDetail(true)}
          />
        </div>
        {chartDetail && (
          <Modal title={t('合成用量明细')} placement="side" onClose={() => setChartDetail(false)}>
            <p>{t('仅展示元数据的侧边抽屉，沿用焦点管理、Escape 关闭和减少动态效果。')}</p>
          </Modal>
        )}
      </DemoRow>
      <Tabs
        label={t('组件分类')}
        value={panel}
        onValueChange={setPanel}
        items={[
          { value: 'cards', label: t('卡片方案'), id: 'ui-tab-cards', panelId: 'ui-panel-cards' },
          {
            value: 'controls',
            label: t('交互控件'),
            id: 'ui-tab-controls',
            panelId: 'ui-panel-controls',
          },
          { value: 'forms', label: t('表单输入'), id: 'ui-tab-forms', panelId: 'ui-panel-forms' },
          {
            value: 'feedback',
            label: t('浮层反馈'),
            id: 'ui-tab-feedback',
            panelId: 'ui-panel-feedback',
          },
        ]}
      />
      <div
        id={`ui-panel-${panel}`}
        role="tabpanel"
        aria-labelledby={`ui-tab-${panel}`}
        tabIndex={0}
        className="ui-components-panel"
      >
        {panel === 'cards' && <ResourceCardDesignPreview />}
        {panel === 'controls' && (
          <>
            <DemoRow
              title={t('滑块开关')}
              description={t('开启、关闭与禁用状态；支持标签点击、Tab 焦点和空格切换。')}
            >
              <Switch
                label={t('必填')}
                checked={switchOn}
                onChange={(event) => setSwitchOn(event.target.checked)}
              />
              <Switch label={t('禁用（开启）')} checked disabled />
              <Switch label={t('禁用（关闭）')} checked={false} disabled />
            </DemoRow>
            <DemoRow
              title={t('列表顶栏')}
              description={t(
                '分类 Tab 在左，搜索与筛选操作在同一行最右侧；保留阴影留白，窄窗口自然换行。',
              )}
            >
              <div className="ui-list-toolbar" style={{ width: '100%' }}>
                <div className="ui-list-toolbar-heading">
                  <Tabs
                    className="ui-list-toolbar-tabs"
                    label={t('列表顶栏分类预览')}
                    value={listCategory}
                    onValueChange={setListCategory}
                    items={[
                      { value: 'all', label: t('全部'), count: 12 },
                      { value: 'terminal', label: 'TERMINAL', count: 4 },
                      { value: 'http', label: 'HTTP', count: 4 },
                      { value: 'mcp', label: 'MCP', count: 4 },
                      { value: 'archived', label: t('已归档'), count: 2 },
                    ]}
                  />
                  <Button disabled>{t('新增')}</Button>
                </div>
                <div className="ui-list-toolbar-filters">
                  <Input
                    className="ui-list-toolbar-search"
                    aria-label={t('列表顶栏搜索预览')}
                    placeholder={t('搜索…')}
                    value={listQuery}
                    onChange={(event) => setListQuery(event.target.value)}
                  />
                  <Select aria-label={t('列表顶栏状态预览')} defaultValue="all">
                    <option value="all">{t('全部状态')}</option>
                    <option value="ready">{t('已启用')}</option>
                  </Select>
                </div>
              </div>
            </DemoRow>
            <DemoRow
              title={t('知识阅读')}
              description={t(
                '目录默认只展开第一级，可手动展开子目录；图谱、关系清单、Markdown、分支与来源引用。',
              )}
            >
              <div style={{ width: '100%', display: 'grid', gap: 16 }}>
                <TreeView
                  items={[
                    { id: 'overview', parentId: null, title: t('项目概览'), order: 0 },
                    { id: 'module', parentId: 'overview', title: t('模块设计'), order: 0 },
                    { id: 'contract', parentId: 'module', title: t('接口契约'), order: 0 },
                  ]}
                  selectedId={knowledgeSelection}
                  onSelect={setKnowledgeSelection}
                />
                <div style={{ height: 380 }}>
                  <GraphView
                    nodes={[
                      {
                        id: 'overview',
                        label: 'Lumi',
                        kind: 'project',
                        summary: t('本地 AI 工具'),
                        documentId: 'overview',
                        citationIds: [],
                      },
                      {
                        id: 'module',
                        label: t('MCP 网关'),
                        kind: 'module',
                        summary: t('统一工具契约'),
                        documentId: 'module',
                        citationIds: [],
                      },
                      {
                        id: 'independent',
                        label: t('独立文档'),
                        kind: 'concept',
                        summary: t('无直接关联的节点'),
                        documentId: null,
                        citationIds: [],
                      },
                    ]}
                    edges={[
                      {
                        id: 'relation',
                        from: 'overview',
                        to: 'module',
                        type: 'contains',
                        evidenceKind: 'raw',
                        citationIds: [],
                      },
                    ]}
                    selectedId={knowledgeSelection}
                    onSelect={setKnowledgeSelection}
                  />
                </div>
                <DocumentViewer
                  title={t('项目概览')}
                  markdown={t(
                    '# 跨越多个模块的长标题会自然换行\n\n阅读正文使用 14px 字号与 22px 行高。\n\n## 架构\n\n通过 **MCP** 暴露工具。\n\n### Core 模块\n\n- 持久化\n- 授权\n\n#### 连接\n\n连接状态影响本机操作。\n\n##### 请求\n\n请求经过共享协议。\n\n###### 响应\n\n保留原始结果。\n\n| 模块 | 职责 |\n| --- | --- |\n| Core | 持久化与授权 |',
                  )}
                />
                <Field label={t('项目分支')}>
                  <Select defaultValue="main">
                    <option value="main">main</option>
                    <option value="feature/knowledge">feature/knowledge</option>
                  </Select>
                </Field>
                <Field label={t('内容 SHA256')}>
                  <Input readOnly value={'a'.repeat(64)} />
                </Field>
              </div>
            </DemoRow>
            <DemoRow
              title={t('按钮')}
              description={t('默认重阴影，悬停轻微浮起；按下回落并减弱阴影。')}
            >
              <Button
                variant="primary"
                icon={<Icon name="plus" />}
                onClick={() => toast(t('主按钮已触发'), 'success')}
              >
                {t('主要操作')}
              </Button>
              <Button onClick={() => toast(t('次按钮已触发'), 'info')}>{t('次要操作')}</Button>
              <Button variant="ghost" onClick={() => toast(t('轻按钮已触发'), 'info')}>
                {t('轻量操作')}
              </Button>
              <Button variant="text" onClick={() => toast(t('文字操作已触发'), 'info')}>
                {t('文字操作')}
              </Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                {t('危险操作')}
              </Button>
            </DemoRow>
            <DemoRow
              title={t('阶段式内容')}
              description={t(
                '当前黄圆、已执行绿圆、失败红圆；运行中黄圈内环旋转，减少动态效果时静止。',
              )}
            >
              <div style={{ width: '100%', display: 'grid', gap: 24 }}>
                <StageSection
                  title={t('配置')}
                  state="past"
                  expanded={stageOpen}
                  onExpandedChange={setStageOpen}
                  summary={t('用户主目录（默认）')}
                >
                  {t('工作目录：用户主目录（默认）')}
                </StageSection>
                <StageSection title={t('运行')} state="current" status="running">
                  <Segmented
                    label={t('输出预览类型')}
                    value={outputType}
                    onValueChange={setOutputType}
                    items={[
                      { value: 'terminal', label: t('终端') },
                      { value: 'remote', label: 'HTTP / MCP' },
                    ]}
                  />
                  <LogViewer
                    title={outputType === 'terminal' ? undefined : t('日志')}
                    size={outputType === 'terminal' ? 'combined' : 'default'}
                    format={outputType === 'terminal' ? 'terminal' : 'text'}
                    overlayAction={
                      outputType === 'terminal' ? (
                        <IconButton
                          label={t('复制日志')}
                          iconSize="small"
                          onClick={() =>
                            void copyPreview(terminalOutputText(previewLog), t('日志'))
                          }
                        >
                          <Copy />
                        </IconButton>
                      ) : undefined
                    }
                    headerAction={
                      outputType !== 'terminal' ? (
                        <IconButton
                          label={t('复制日志')}
                          onClick={() =>
                            void copyPreview(terminalOutputText(previewLog), t('日志'))
                          }
                        >
                          <Copy />
                        </IconButton>
                      ) : undefined
                    }
                    text={previewLog}
                  />
                  {outputType !== 'terminal' && (
                    <LogViewer
                      label={t('运行结果')}
                      variant="result"
                      numbered={false}
                      autoScroll={false}
                      text={Array.from({ length: 30 }, (_, i) =>
                        t('结果正文 {v0}', { v0: i + 1 }),
                      ).join('\n')}
                      overlayAction={
                        <IconButton
                          iconSize="small"
                          label={t('复制结果')}
                          onClick={() =>
                            void copyPreview(
                              Array.from({ length: 30 }, (_, i) =>
                                t('结果正文 {v0}', { v0: i + 1 }),
                              ).join('\n'),
                              t('结果'),
                            )
                          }
                        >
                          <Copy />
                        </IconButton>
                      }
                    />
                  )}
                  <Button variant="text" onClick={() => setLogLines((count) => count + 1)}>
                    {t('追加日志')}
                  </Button>
                </StageSection>
                <StageSection title={t('当前节点')} state="current" />
                <StageSection title={t('失败节点')} state="current" status="failed" />
              </div>
            </DemoRow>
            <DemoRow
              title={t('独立窗口容器')}
              description={t(
                '标题栏与正文同背景，输出填满剩余高度；上滚暂停跟随，追加日志后可回到最新。',
              )}
            >
              <WindowPanel
                title={t('运行窗口预览')}
                preview
                nativeTitlebar
                bodyLayout="fill"
                header={
                  <header className="ui-modal-heading">
                    <h2>{t('运行窗口预览')}</h2>
                    <Badge tone="accent">{t('运行中')}</Badge>
                  </header>
                }
                actions={
                  <>
                    <Button variant="secondary" onClick={() => setLogLines((value) => value + 10)}>
                      {t('追加日志')}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => toast(t('预览：任务结束后关闭窗口。'), 'success')}
                    >
                      {t('结束运行')}
                    </Button>
                  </>
                }
              >
                <div className="ui-demo-window-output">
                  <Tabs
                    label={t('窗口输出预览')}
                    value={windowOutput}
                    onValueChange={setWindowOutput}
                    items={[
                      {
                        value: 'log',
                        label: t('日志'),
                        id: 'preview-window-log',
                        panelId: 'preview-window-output',
                      },
                      {
                        value: 'result',
                        label: t('结果'),
                        id: 'preview-window-result',
                        panelId: 'preview-window-output',
                      },
                    ]}
                  />
                  <div
                    id="preview-window-output"
                    role="tabpanel"
                    aria-labelledby={`preview-window-${windowOutput}`}
                    className="ui-demo-window-viewport"
                  >
                    <LogViewer
                      key={windowOutput}
                      title={windowOutput === 'log' ? t('日志') : t('结果')}
                      label={windowOutput === 'log' ? t('窗口日志预览') : t('窗口结果预览')}
                      format={windowOutput === 'log' ? 'terminal' : 'text'}
                      variant={windowOutput === 'log' ? 'log' : 'result'}
                      numbered={windowOutput === 'log'}
                      autoScroll={windowOutput === 'log'}
                      size="fill"
                      text={
                        windowOutput === 'log'
                          ? previewLog
                          : t('{\n  "message": "请求成功",\n  "source": "localhost"\n}')
                      }
                      headerAction={
                        <IconButton
                          label={t('复制窗口输出')}
                          onClick={() =>
                            void copyPreview(
                              windowOutput === 'log'
                                ? terminalOutputText(previewLog)
                                : t('{"message":"请求成功","source":"localhost"}'),
                              t('输出'),
                            )
                          }
                        >
                          <Copy />
                        </IconButton>
                      }
                    />
                  </div>
                </div>
              </WindowPanel>
            </DemoRow>
            <DemoRow
              title={t('按钮状态')}
              description={t('加载保留宽度并阻止重复提交，禁用取消交互效果。')}
            >
              <Button disabled>{t('不可用')}</Button>
              <Button
                variant="primary"
                loading={loading}
                onClick={() => {
                  setLoading(true)
                  timer.current = setTimeout(() => {
                    setLoading(false)
                    toast(t('示例操作完成'), 'success')
                  }, 1200)
                }}
              >
                {t('体验加载状态')}
              </Button>
              <Button loading loadingLabel={t('保存中…')}>
                {t('保存示例配置')}
              </Button>
            </DemoRow>
            <DemoRow
              title={t('外观选择')}
              description={t('鼠标点击只显示选中边框；Tab 导航保留焦点，选中且聚焦时用光晕区分。')}
            >
              <ThemePicker value={theme} onValueChange={onThemeChange} />
            </DemoRow>
            <DemoRow
              title={t('选择卡片')}
              description={t('鼠标选择、键盘焦点使用同一边界，边框不叠加；选中且聚焦时增加光晕。')}
            >
              <ChoiceCard
                label={t('全部工具')}
                description={t('显示所有类型')}
                selected={choice === 'all'}
                onClick={() => setChoice('all')}
              />
              <ChoiceCard
                label={t('本机命令')}
                description={t('仅显示 Terminal')}
                selected={choice === 'terminal'}
                onClick={() => setChoice('terminal')}
              />
            </DemoRow>
            <DemoRow
              title={t('侧栏导航')}
              description={t(
                '选中项无线框，左侧竖线向右投射柔边光束；浅色模式使用琥珀图标与通透金橙灯光，点击区仍为 44px。',
              )}
            >
              {[
                { value: 'workbench', label: t('工作台导航示例'), icon: <Home size={20} /> },
                { value: 'tools', label: t('工具导航示例'), icon: <Wrench size={20} /> },
                { value: 'settings', label: t('设置导航示例'), icon: <Settings size={20} /> },
              ].map((item) => (
                <NavigationButton
                  key={item.value}
                  label={item.label}
                  icon={item.icon}
                  current={navigationChoice === item.value}
                  onClick={() => setNavigationChoice(item.value)}
                />
              ))}
            </DemoRow>
            <DemoRow
              title={t('图标操作')}
              description={t('默认灰色轮廓；悬停或键盘聚焦显示对应颜色与完整底部光晕。')}
            >
              <IconButton
                label={t('运行示例')}
                tone="success"
                glow
                onClick={() => toast(t('运行图标已触发'), 'success')}
              >
                <Icon name="play" />
              </IconButton>
              <IconButton
                label={t('设置示例')}
                tone="accent"
                glow
                onClick={() => toast(t('设置图标已触发'), 'info')}
              >
                <Icon name="settings" />
              </IconButton>
              <IconButton label={t('禁用的运行示例')} tone="success" glow disabled>
                <Icon name="play" />
              </IconButton>
            </DemoRow>
            <DemoRow
              title={t('分段选择')}
              description={t('与 Tab 共用选中效果；支持方向键、Home 和 End，跳过禁用项。')}
            >
              <Segmented
                label={t('工具类型示例')}
                value={choice}
                onValueChange={setChoice}
                items={[
                  { value: 'all', label: t('全部'), count: 3 },
                  { value: 'terminal', label: 'TERMINAL', count: 2 },
                  { value: 'http', label: 'HTTP', count: 1 },
                  { value: 'mcp', label: 'MCP', disabled: true },
                ]}
              />
            </DemoRow>
          </>
        )}
        {panel === 'forms' && (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) {
                setError(t('请输入名称'))
                input.current?.focus()
                toast(t('请填写名称后再保存。'), 'error')
                return
              }
              setError('')
              toast(t('示例配置已通过校验'), 'success')
            }}
            className="ui-demo-form"
          >
            <Field
              label={t('名称')}
              inline
              hint={t('名称用于识别配置。留空保存可体验校验反馈。')}
              error={error}
            >
              <Input
                ref={input}
                placeholder={t('输入示例名称')}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError('')
                }}
              />
            </Field>
            <Field label={t('请求方式')} inline>
              <Select value={method} onChange={(event) => setMethod(event.target.value)}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
              </Select>
            </Field>
            <Field
              label={t('用途说明')}
              description={t('多行文本至少显示五行，剩余字数悬浮在右下角。')}
            >
              <Textarea
                showCount
                value={description}
                maxLength={1000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label={t('单行输入提示')} inline>
              <InputHint
                label={t('单行输入')}
                hint={t('问号在输入框右侧居中；悬停、点击或键盘聚焦阅读，Escape 关闭。')}
              >
                <Input defaultValue={t('右侧问号不遮挡输入内容')} />
              </InputHint>
            </Field>
            <Field label={t('多行输入提示')} inline>
              <InputHint
                label={t('多行输入')}
                multiline
                hint={t(
                  '问号在输入框右上角。长提示会换行，气泡通过 portal 显示，不被表单滚动区域裁掉。',
                )}
              >
                <Textarea rows={3} defaultValue={t('第一行输入内容\n第二行输入内容')} />
              </InputHint>
            </Field>
            <RunConfigurationFields
              section="connection"
              settings={{
                type: 'http',
                method: 'GET',
                url: 'https://example.test/endpoint?token=masked',
                timeoutMs: 30000,
                fixedHeaders: {},
              }}
              disabled={false}
              change={() => {}}
            />
            <RunConfigurationFields
              section="connection"
              settings={{
                type: 'mcp',
                transport: 'stdio',
                command: 'node',
                url: null,
                args: [],
                environment: {},
              }}
              disabled={false}
              change={() => {}}
              operations={[
                { name: 'first', upstreamName: t('示例工具一') },
                { name: 'second', upstreamName: t('示例工具二') },
              ]}
              operation={previewOperation}
              onOperationChange={setPreviewOperation}
            />
            <RunParameters
              label={t('运行参数（三工具共用）')}
              fields={previewTerminal.tools[0]!.fields}
              renderValue={(field, descriptionId, id) =>
                multilineRunField(field) ? (
                  <Textarea
                    id={id}
                    aria-describedby={descriptionId}
                    readOnly
                    rows={3}
                    value={String(field.schema.default ?? '')}
                  />
                ) : (
                  <Input
                    id={id}
                    aria-describedby={descriptionId}
                    readOnly
                    type={field.aiVisible ? 'text' : 'password'}
                    value={String(field.schema.default ?? field.value ?? '')}
                  />
                )
              }
            />
            <Field label={t('只读信息')} inline>
              <Input value={t('由业务提供的只读值')} readOnly />
            </Field>
            <Field
              label={t('工作目录')}
              inline
              controlWidth="wide"
              hint={t('宽输入区与末尾展示共用实现，编辑时可使用 Home/End 查看完整路径。')}
              action={
                <Button type="button" onClick={() => toast(t('目录选择按钮预览'), 'info')}>
                  {t('选择文件夹')}
                </Button>
              }
            >
              <Input
                value={previewPath}
                revealEnd
                onChange={(event) => setPreviewPath(event.target.value)}
              />
            </Field>
            <Segmented
              label={t('参数类型预览')}
              value={previewParameterType}
              onValueChange={setPreviewParameterType}
              items={[
                { value: 'terminal', label: 'Terminal' },
                { value: 'http', label: 'HTTP' },
              ]}
            />
            {previewParameterType === 'terminal' ? (
              <TerminalParameters
                fields={previewTerminal.tools[0]!.fields}
                change={(fields) =>
                  setPreviewTerminal((current) => ({
                    ...current,
                    tools: current.tools.map((tool) => ({ ...tool, fields })),
                  }))
                }
              />
            ) : (
              <FieldGroup
                label={previewParameterType === 'terminal' ? t('外部参数') : t('请求参数')}
                hint={t('组标题与基本配置字段标题使用同一字号和行高。')}
                action={
                  <Button type="button" onClick={() => setPreviewParameters((value) => value + 1)}>
                    {t('添加参数')}
                  </Button>
                }
              >
                {Array.from({ length: previewParameters }, (_, index) => (
                  <FieldRow
                    key={index}
                    label={t('外部参数预览 {v0}', { v0: index + 1 })}
                    fields={[
                      <Field
                        key="name"
                        label={previewParameterType === 'terminal' ? t('变量名') : t('参数名')}
                      >
                        <Input defaultValue={`PROJECT_${index + 1}`} />
                      </Field>,
                      <Field key="default" label={t('默认值')}>
                        <Input defaultValue="gushan" />
                      </Field>,
                      <Field key="description" label={t('输入说明')}>
                        <Input defaultValue={t('供自己和 AI 理解参数')} />
                      </Field>,
                    ]}
                    options={
                      <>
                        <Checkbox label={t('必填')} />
                        <Checkbox label={t('使用默认值')} defaultChecked />
                      </>
                    }
                    action={
                      <Button
                        type="button"
                        onClick={() => setPreviewParameters((value) => Math.max(0, value - 1))}
                      >
                        {t('删除')}
                      </Button>
                    }
                  />
                ))}
              </FieldGroup>
            )}
            <FieldGroup
              label={t('请求头 / MCP Header')}
              action={
                <Checkbox
                  label={t('显示固定值')}
                  checked={previewHeaderVisible}
                  onChange={(event) => setPreviewHeaderVisible(event.target.checked)}
                />
              }
            >
              <FieldRow
                size="compact"
                label={t('请求头预览')}
                fields={[
                  <Input key="name" aria-label={t('请求头名称预览')} defaultValue="X-Example" />,
                  <Input
                    key="value"
                    aria-label={t('请求头固定值预览')}
                    type={previewHeaderVisible ? 'text' : 'password'}
                    defaultValue="example-value"
                  />,
                ]}
                action={
                  <Button type="button" onClick={() => toast(t('删除请求头操作预览'), 'info')}>
                    {t('删除')}
                  </Button>
                }
              />
            </FieldGroup>
            <Field label={t('禁用输入')} inline>
              <Input placeholder={t('暂不可修改')} disabled />
            </Field>
            <Checkbox
              label={t('启用示例配置')}
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <div className="ui-demo-form-actions">
              <Button type="submit" variant="primary">
                {t('校验并保存示例')}
              </Button>
            </div>
          </form>
        )}
        {panel === 'feedback' && (
          <>
            <DemoRow
              title={t('说明提示')}
              description={t('鼠标悬停、键盘聚焦或点击图标阅读，Escape 关闭。')}
            >
              <span className="ui-demo-hint">
                {t('配置说明')}
                <Tooltip label={t('配置')}>
                  {t('提示跟随当前主题，并在弹窗内保持可见；移动到提示上可继续阅读。')}
                </Tooltip>
              </span>
            </DemoRow>
            <DemoRow
              title={t('弹窗与确认')}
              description={t('原生焦点约束、关闭后恢复焦点；二次确认默认聚焦取消。')}
            >
              <Button ref={trigger} onClick={() => setModal(true)}>
                {t('打开独立弹窗')}
              </Button>
              <Button onClick={() => setConfirm(true)}>{t('打开二次确认')}</Button>
            </DemoRow>
            <DemoRow
              title={t('顶部气泡')}
              description={t('复用现有气泡；成功与提醒 4 秒，错误 8 秒。')}
            >
              <Button onClick={() => toast(t('示例保存成功'), 'success')}>{t('成功')}</Button>
              <Button onClick={() => toast(t('这是一条示例提醒'), 'info')}>{t('提醒')}</Button>
              <Button variant="danger" onClick={() => toast(t('示例操作失败，请重试。'), 'error')}>
                {t('错误')}
              </Button>
            </DemoRow>
            <DemoRow
              title={t('标签与容器')}
              description={t(
                '浅色卡片使用独立纯白表面，输入框使用浅灰；悬停或聚焦沿用重阴影，标签色彩对应具体语义。',
              )}
            >
              <Card interactive tabIndex={0} className="ui-demo-card">
                <strong>{t('示例工具')}</strong>
                <p>{t('卡片与输入框底色独立，主按钮使用橙琥珀配深色文字。')}</p>
                <Field label={t('输入框底色示例')}>
                  <Input placeholder={t('浅灰输入区域')} />
                </Field>
                <Button variant="primary" onClick={() => toast(t('主色按钮示例已触发'), 'success')}>
                  {t('主色按钮示例')}
                </Button>
                <div className="ui-demo-badges">
                  <Badge>{t('默认')}</Badge>
                  <Badge tone="accent">{t('待审阅')}</Badge>
                  <Badge tone="success">{t('已连接')}</Badge>
                  <Badge tone="protocol" data-tool-kind="terminal">
                    TERMINAL
                  </Badge>
                  <Badge tone="protocol" data-tool-kind="http">
                    HTTP
                  </Badge>
                  <Badge tone="protocol" data-tool-kind="mcp">
                    MCP
                  </Badge>
                  <Badge data-source="codex">Codex</Badge>
                  <Badge data-source="gemini">Gemini CLI</Badge>
                  <Badge tone="danger">{t('失败')}</Badge>
                </div>
              </Card>
            </DemoRow>
          </>
        )}
      </div>
      {modal && (
        <Modal
          title={t('组件弹窗预览')}
          returnFocus={trigger.current}
          onClose={() => setModal(false)}
          actions={
            <>
              <Button onClick={() => toast(t('弹窗内反馈保持在窗口顶部'), 'success')}>
                {t('显示气泡')}
              </Button>
              <Button variant="primary" onClick={() => setConfirm(true)}>
                {t('保存示例')}
              </Button>
            </>
          }
        >
          <p>{t('此弹窗使用与设置页相同的 Modal。可打开二次确认，验证嵌套焦点与气泡层级。')}</p>
          <Field label={t('示例选项')} hint={t('业务传入文案，组件负责交互。')}>
            <Input defaultValue={t('本次预览不写入业务配置')} />
          </Field>
        </Modal>
      )}
      {confirm && (
        <ConfirmationDialog
          title={t('确认示例操作？')}
          confirmLabel={t('确认')}
          cancel={() => setConfirm(false)}
          confirm={() => {
            setConfirm(false)
            toast(t('示例操作已确认'), 'success')
          }}
        >
          <p>{t('这是组件交互示例，不会修改工具或服务。')}</p>
        </ConfirmationDialog>
      )}
    </SurfaceEffects>
  )
}
