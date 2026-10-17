// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  StackedBars,
  MetricCard,
  MetricPair,
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
      model: '示例模型',
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
          label="导航会话表格示例"
          rows={[{ key: 'sample', name: '示例会话', total: '40.5K' }]}
          rowKey={(row) => row.key}
          rowName={(row) => row.name}
          columns={[
            { key: 'name', label: '会话名称', render: (row) => row.name },
            {
              key: 'total',
              label: '总计',
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
              label="返回示例会话列表"
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
              示例会话
            </h2>
          </header>
          <DataPanel
            className="usage-records-panel usage-records-preview"
            title={`用量记录（${records.length}条）`}
            actions={
              <div className="usage-log-actions">
                <div ref={calendarAnchor}>
                  <Segmented
                    label="示例会话时间范围"
                    value=""
                    onValueChange={() => setCalendarOpen((value) => !value)}
                    items={[
                      {
                        value: 'custom',
                        accessibleLabel: `选择示例时间范围 ${range.start} – ${range.end}`,
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
                  总计 {compactTokens(records.reduce((sum, row) => sum + row.total, 0))} Token
                </Badge>
              </div>
            }
          >
            <UsageRecordTable
              records={records}
              label="合成会话记录"
              empty={<DataText muted>所选日期暂无合成记录。</DataText>}
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
  const toast = useToast()
  async function copyPreview(text: string, kind: string) {
    try {
      const copied = await copyText(text)
      toast(copied ? `已复制${kind}。` : '复制失败，请重试。', copied ? 'success' : 'error')
    } catch {
      toast('复制失败，请重试。', 'error')
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
          '\u001b[32m✓ 服务已启动 🚀\u001b[0m',
          '中文与 Emoji：👩🏽‍💻 🧑‍🚀 ❤️ 🇨🇳',
          '\u001b[1;31m红色加粗\u001b[0m · \u001b[4;36m青色下划线\u001b[0m · \u001b[43;30m黄色背景\u001b[0m',
          '\u001b[38;5;208m256 色\u001b[0m · \u001b[38;2;180;130;250mRGB 真彩色\u001b[0m',
          '\u001b]8;;https://example.com\u0007日志中的链接文字\u001b]8;;\u0007',
        ]
      : []),
    ...Array.from({ length: logLines }, (_, index) => `运行输出 ${index + 1}`),
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
      name: '参数表示例',
      command: 'printf "%s\\n" "$PROJECT"',
    })
    definition.tools[0]!.fields = [
      {
        key: 'PROJECT',
        schema: {
          type: 'string',
          title: '项目名称',
          default: 'gushan',
          description: '输出的项目名称',
        },
        required: true,
        aiVisible: true,
        value: null,
        binding: { location: 'argument', key: 'PROJECT' },
      },
      {
        key: 'COUNT',
        schema: { type: 'integer', title: '显示次数', default: 3, description: '输出内容的次数' },
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
            UI组件
          </h1>
          <p>共用组件与真实交互 · 仅开发环境</p>
        </div>
        <Button onClick={back}>返回设置</Button>
      </header>
      <div className="ui-components-summary">
        <p>36px 控件 · 4px 圆角 · 琥珀选中 · 重阴影预览 · outline 底部光晕</p>
        <Segmented
          label="组件预览主题"
          value={theme}
          onValueChange={onThemeChange}
          items={[
            { value: 'dark', label: '深色' },
            { value: 'light', label: '浅色' },
          ]}
        />
      </div>
      <DemoRow
        title="用量仪表盘"
        description="合成示例 · 共用统计卡、彩色排行和可展开语义表格；业务传入实际数据。"
      >
        <div style={{ display: 'grid', gap: 16, width: '100%' }}>
          <MetricCard
            label="总 Token 吞吐"
            value="40.5K"
            exact="40,500"
            tone="accent"
            highlight
            badge={<Badge tone="success">+8.2%</Badge>}
            footer={
              <>
                <DataText muted>输入 32.4K</DataText>
                <DataText tone="protocol">输出 8.1K</DataText>
              </>
            }
          />
          <div ref={calendarAnchor}>
            <Button onClick={() => setCalendarOpen(true)}>日期范围日历示例</Button>
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
          <MetricCard label="双数值统计示例">
            <MetricPair
              first={{ label: '输入 Token', value: '32.4K' }}
              second={{ label: '输出 Token', value: '8.1K' }}
            />
          </MetricCard>
          <MetricCard label="设备占比示例" badge={<Badge>2</Badge>}>
            <DistributionRing
              key={previewRingRevision}
              label="合成软件占比"
              items={[
                { key: 'a', label: '软件 A', value: 70, tone: 'accent' },
                { key: 'b', label: '软件 B', value: 30, tone: 'protocol' },
              ]}
            />
          </MetricCard>
          <Button onClick={() => setPreviewRingRevision((value) => value + 1)}>重播圆环动效</Button>
          <Segmented
            appearance="enclosed"
            label="仪表盘分组筛选示例"
            value={choice}
            onValueChange={setChoice}
            items={[
              { value: 'all', label: '全部' },
              { value: 'terminal', label: '终端' },
            ]}
          />
          <Segmented
            appearance="chips"
            label="仪表盘模型筛选示例"
            value={choice}
            onValueChange={setChoice}
            items={[
              { value: 'all', label: '全部模型' },
              { value: 'terminal', label: '示例模型' },
            ]}
          />
          <DataPanel title="软件排行">
            <RankingList
              label="软件排行示例"
              rows={[
                { key: 'sample', label: '示例软件', value: '40.5K', share: 0.68, tone: 'accent' },
                { key: 'zero', label: '零数据软件', value: '0', share: 0, tone: 'protocol' },
              ]}
            />
          </DataPanel>
          <ExpandableTable
            fixedHeight
            label="会话表格示例"
            rows={[{ key: 'sample', name: '示例会话', total: '40,500' }]}
            rowKey={(row) => row.key}
            rowName={(row) => row.name}
            columns={[
              { key: 'name', label: '会话名称', render: (row) => row.name },
              {
                key: 'tokens',
                label: '总 Token',
                align: 'end',
                render: (row) => <DataText mono>{row.total}</DataText>,
              },
            ]}
            renderExpanded={() => <p>合成记录 · Enter / 空格或点击行展开。</p>}
          />
          <Pagination
            page={previewUsagePage}
            total={1234}
            pageSize={10}
            onPageChange={setPreviewUsagePage}
          />
          <StackedBars
            appearance="dashboard"
            title="每日用量"
            series={[{ key: 'sample', label: '示例软件', tone: 'accent' }]}
            days={[
              { date: '2026-10-15', values: { sample: 12000 } },
              { date: '2026-10-16', values: { sample: 40500 } },
            ]}
            showHint={false}
            onSelect={() => setChartDetail(true)}
          />
        </div>
      </DemoRow>
      <DemoRow
        title="会话二级页面"
        description="合成示例 · 点击行或具名箭头进入详情；支持 Enter / 空格与返回列表，沿用共用表格视觉。"
      >
        <SessionNavigationPreview />
      </DemoRow>
      <DemoRow
        title="会话汇总展开"
        description="合成示例 · 复用 Card 与 Button text，汇总名称和总 Token，Enter/空格或点击展开。"
      >
        <Card style={{ width: '100%' }}>
          <UsageSessionHeading
            session={{
              key: 'example',
              session: 'synthetic-hash',
              sessionName: '示例会话',
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
            <p>合成记录内容 · 完整会话汇总不受记录分页影响。</p>
          </div>
        </Card>
      </DemoRow>
      <DemoRow
        title="刷新图标与零用量"
        description="合成示例 · 扫描时旋转、禁止重复提交；减少动态效果时保持静止。空日期显示 0。"
      >
        <IconButton
          label="刷新示例"
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
          label="带 Logo 的软件筛选示例"
          value={choice}
          onValueChange={setChoice}
          items={[
            { value: 'all', label: '全部' },
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
                  软件示例
                </span>
              ),
            },
          ]}
        />
        <div style={{ width: '100%' }}>
          <StackedBars
            series={[{ key: 'a', label: '软件 A' }]}
            days={[{ date: '2026-10-16', values: { a: 0 } }]}
            onSelect={() => setChartDetail(true)}
            showHint={false}
          />
        </div>
      </DemoRow>
      <DemoRow
        title="日堆叠图与明细抽屉"
        description="合成示例 · 图例切换、键盘日期筛选、共用 Modal 侧边布局。"
      >
        <div style={{ width: '100%' }}>
          <StackedBars
            series={[
              { key: 'a', label: '软件 A' },
              { key: 'b', label: '软件 B' },
            ]}
            days={[
              { date: '2026-10-10', values: { a: 100, b: 60 } },
              { date: '2026-10-11', values: { a: 80, b: null } },
            ]}
            onSelect={() => setChartDetail(true)}
          />
        </div>
        {chartDetail && (
          <Modal title="合成用量明细" placement="side" onClose={() => setChartDetail(false)}>
            <p>仅展示元数据的侧边抽屉，沿用焦点管理、Escape 关闭和减少动态效果。</p>
          </Modal>
        )}
      </DemoRow>
      <Tabs
        label="组件分类"
        value={panel}
        onValueChange={setPanel}
        items={[
          { value: 'cards', label: '卡片方案', id: 'ui-tab-cards', panelId: 'ui-panel-cards' },
          {
            value: 'controls',
            label: '交互控件',
            id: 'ui-tab-controls',
            panelId: 'ui-panel-controls',
          },
          { value: 'forms', label: '表单输入', id: 'ui-tab-forms', panelId: 'ui-panel-forms' },
          {
            value: 'feedback',
            label: '浮层反馈',
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
              title="滑块开关"
              description="开启、关闭与禁用状态；支持标签点击、Tab 焦点和空格切换。"
            >
              <Switch
                label="必填"
                checked={switchOn}
                onChange={(event) => setSwitchOn(event.target.checked)}
              />
              <Switch label="禁用（开启）" checked disabled />
              <Switch label="禁用（关闭）" checked={false} disabled />
            </DemoRow>
            <DemoRow
              title="列表顶栏"
              description="分类 Tab 在左，搜索与筛选操作在同一行最右侧；保留阴影留白，窄窗口自然换行。"
            >
              <div className="ui-list-toolbar" style={{ width: '100%' }}>
                <div className="ui-list-toolbar-heading">
                  <Tabs
                    className="ui-list-toolbar-tabs"
                    label="列表顶栏分类预览"
                    value={listCategory}
                    onValueChange={setListCategory}
                    items={[
                      { value: 'all', label: '全部', count: 12 },
                      { value: 'terminal', label: 'TERMINAL', count: 4 },
                      { value: 'http', label: 'HTTP', count: 4 },
                      { value: 'mcp', label: 'MCP', count: 4 },
                      { value: 'archived', label: '已归档', count: 2 },
                    ]}
                  />
                  <Button disabled>新增</Button>
                </div>
                <div className="ui-list-toolbar-filters">
                  <Input
                    className="ui-list-toolbar-search"
                    aria-label="列表顶栏搜索预览"
                    placeholder="搜索…"
                    value={listQuery}
                    onChange={(event) => setListQuery(event.target.value)}
                  />
                  <Select aria-label="列表顶栏状态预览" defaultValue="all">
                    <option value="all">全部状态</option>
                    <option value="ready">已启用</option>
                  </Select>
                </div>
              </div>
            </DemoRow>
            <DemoRow
              title="知识阅读"
              description="目录默认只展开第一级，可手动展开子目录；图谱、关系清单、Markdown、分支与来源引用。"
            >
              <div style={{ width: '100%', display: 'grid', gap: 16 }}>
                <TreeView
                  items={[
                    { id: 'overview', parentId: null, title: '项目概览', order: 0 },
                    { id: 'module', parentId: 'overview', title: '模块设计', order: 0 },
                    { id: 'contract', parentId: 'module', title: '接口契约', order: 0 },
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
                        summary: '本地 AI 工具',
                        documentId: 'overview',
                        citationIds: [],
                      },
                      {
                        id: 'module',
                        label: 'MCP 网关',
                        kind: 'module',
                        summary: '统一工具契约',
                        documentId: 'module',
                        citationIds: [],
                      },
                      {
                        id: 'independent',
                        label: '独立文档',
                        kind: 'concept',
                        summary: '无直接关联的节点',
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
                  title="项目概览"
                  markdown={
                    '# 跨越多个模块的长标题会自然换行\n\n阅读正文使用 14px 字号与 22px 行高。\n\n## 架构\n\n通过 **MCP** 暴露工具。\n\n### Core 模块\n\n- 持久化\n- 授权\n\n#### 连接\n\n连接状态影响本机操作。\n\n##### 请求\n\n请求经过共享协议。\n\n###### 响应\n\n保留原始结果。\n\n| 模块 | 职责 |\n| --- | --- |\n| Core | 持久化与授权 |'
                  }
                />
                <Field label="项目分支">
                  <Select defaultValue="main">
                    <option value="main">main</option>
                    <option value="feature/knowledge">feature/knowledge</option>
                  </Select>
                </Field>
                <Field label="内容 SHA256">
                  <Input readOnly value={'a'.repeat(64)} />
                </Field>
              </div>
            </DemoRow>
            <DemoRow title="按钮" description="默认重阴影，悬停轻微浮起；按下回落并减弱阴影。">
              <Button
                variant="primary"
                icon={<Icon name="plus" />}
                onClick={() => toast('主按钮已触发', 'success')}
              >
                主要操作
              </Button>
              <Button onClick={() => toast('次按钮已触发', 'info')}>次要操作</Button>
              <Button variant="ghost" onClick={() => toast('轻按钮已触发', 'info')}>
                轻量操作
              </Button>
              <Button variant="text" onClick={() => toast('文字操作已触发', 'info')}>
                文字操作
              </Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                危险操作
              </Button>
            </DemoRow>
            <DemoRow
              title="阶段式内容"
              description="当前黄圆、已执行绿圆、失败红圆；运行中黄圈内环旋转，减少动态效果时静止。"
            >
              <div style={{ width: '100%', display: 'grid', gap: 24 }}>
                <StageSection
                  title="配置"
                  state="past"
                  expanded={stageOpen}
                  onExpandedChange={setStageOpen}
                  summary="用户主目录（默认）"
                >
                  工作目录：用户主目录（默认）
                </StageSection>
                <StageSection title="运行" state="current" status="running">
                  <Segmented
                    label="输出预览类型"
                    value={outputType}
                    onValueChange={setOutputType}
                    items={[
                      { value: 'terminal', label: '终端' },
                      { value: 'remote', label: 'HTTP / MCP' },
                    ]}
                  />
                  <LogViewer
                    title={outputType === 'terminal' ? undefined : '日志'}
                    size={outputType === 'terminal' ? 'combined' : 'default'}
                    format={outputType === 'terminal' ? 'terminal' : 'text'}
                    overlayAction={
                      outputType === 'terminal' ? (
                        <IconButton
                          label="复制日志"
                          iconSize="small"
                          onClick={() => void copyPreview(terminalOutputText(previewLog), '日志')}
                        >
                          <Copy />
                        </IconButton>
                      ) : undefined
                    }
                    headerAction={
                      outputType !== 'terminal' ? (
                        <IconButton
                          label="复制日志"
                          onClick={() => void copyPreview(terminalOutputText(previewLog), '日志')}
                        >
                          <Copy />
                        </IconButton>
                      ) : undefined
                    }
                    text={previewLog}
                  />
                  {outputType !== 'terminal' && (
                    <LogViewer
                      label="运行结果"
                      variant="result"
                      numbered={false}
                      autoScroll={false}
                      text={Array.from({ length: 30 }, (_, i) => `结果正文 ${i + 1}`).join('\n')}
                      overlayAction={
                        <IconButton
                          iconSize="small"
                          label="复制结果"
                          onClick={() =>
                            void copyPreview(
                              Array.from({ length: 30 }, (_, i) => `结果正文 ${i + 1}`).join('\n'),
                              '结果',
                            )
                          }
                        >
                          <Copy />
                        </IconButton>
                      }
                    />
                  )}
                  <Button variant="text" onClick={() => setLogLines((count) => count + 1)}>
                    追加日志
                  </Button>
                </StageSection>
                <StageSection title="当前节点" state="current" />
                <StageSection title="失败节点" state="current" status="failed" />
              </div>
            </DemoRow>
            <DemoRow
              title="独立窗口容器"
              description="标题栏与正文同背景，输出填满剩余高度；上滚暂停跟随，追加日志后可回到最新。"
            >
              <WindowPanel
                title="运行窗口预览"
                preview
                nativeTitlebar
                bodyLayout="fill"
                header={
                  <header className="ui-modal-heading">
                    <h2>运行窗口预览</h2>
                    <Badge tone="accent">运行中</Badge>
                  </header>
                }
                actions={
                  <>
                    <Button variant="secondary" onClick={() => setLogLines((value) => value + 10)}>
                      追加日志
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => toast('预览：任务结束后关闭窗口。', 'success')}
                    >
                      结束运行
                    </Button>
                  </>
                }
              >
                <div className="ui-demo-window-output">
                  <Tabs
                    label="窗口输出预览"
                    value={windowOutput}
                    onValueChange={setWindowOutput}
                    items={[
                      {
                        value: 'log',
                        label: '日志',
                        id: 'preview-window-log',
                        panelId: 'preview-window-output',
                      },
                      {
                        value: 'result',
                        label: '结果',
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
                      title={windowOutput === 'log' ? '日志' : '结果'}
                      label={windowOutput === 'log' ? '窗口日志预览' : '窗口结果预览'}
                      format={windowOutput === 'log' ? 'terminal' : 'text'}
                      variant={windowOutput === 'log' ? 'log' : 'result'}
                      numbered={windowOutput === 'log'}
                      autoScroll={windowOutput === 'log'}
                      size="fill"
                      text={
                        windowOutput === 'log'
                          ? previewLog
                          : '{\n  "message": "请求成功",\n  "source": "localhost"\n}'
                      }
                      headerAction={
                        <IconButton
                          label="复制窗口输出"
                          onClick={() =>
                            void copyPreview(
                              windowOutput === 'log'
                                ? terminalOutputText(previewLog)
                                : '{"message":"请求成功","source":"localhost"}',
                              '输出',
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
            <DemoRow title="按钮状态" description="加载保留宽度并阻止重复提交，禁用取消交互效果。">
              <Button disabled>不可用</Button>
              <Button
                variant="primary"
                loading={loading}
                onClick={() => {
                  setLoading(true)
                  timer.current = setTimeout(() => {
                    setLoading(false)
                    toast('示例操作完成', 'success')
                  }, 1200)
                }}
              >
                体验加载状态
              </Button>
              <Button loading loadingLabel="保存中…">
                保存示例配置
              </Button>
            </DemoRow>
            <DemoRow
              title="外观选择"
              description="鼠标点击只显示选中边框；Tab 导航保留焦点，选中且聚焦时用光晕区分。"
            >
              <ThemePicker value={theme} onValueChange={onThemeChange} />
            </DemoRow>
            <DemoRow
              title="选择卡片"
              description="鼠标选择、键盘焦点使用同一边界，边框不叠加；选中且聚焦时增加光晕。"
            >
              <ChoiceCard
                label="全部工具"
                description="显示所有类型"
                selected={choice === 'all'}
                onClick={() => setChoice('all')}
              />
              <ChoiceCard
                label="本机命令"
                description="仅显示 Terminal"
                selected={choice === 'terminal'}
                onClick={() => setChoice('terminal')}
              />
            </DemoRow>
            <DemoRow
              title="侧栏导航"
              description="选中项无线框，左侧竖线向右投射柔边光束；浅色模式使用琥珀图标与通透金橙灯光，点击区仍为 44px。"
            >
              {[
                { value: 'workbench', label: '工作台导航示例', icon: <Home size={20} /> },
                { value: 'tools', label: '工具导航示例', icon: <Wrench size={20} /> },
                { value: 'settings', label: '设置导航示例', icon: <Settings size={20} /> },
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
              title="图标操作"
              description="默认灰色轮廓；悬停或键盘聚焦显示对应颜色与完整底部光晕。"
            >
              <IconButton
                label="运行示例"
                tone="success"
                glow
                onClick={() => toast('运行图标已触发', 'success')}
              >
                <Icon name="play" />
              </IconButton>
              <IconButton
                label="设置示例"
                tone="accent"
                glow
                onClick={() => toast('设置图标已触发', 'info')}
              >
                <Icon name="settings" />
              </IconButton>
              <IconButton label="禁用的运行示例" tone="success" glow disabled>
                <Icon name="play" />
              </IconButton>
            </DemoRow>
            <DemoRow
              title="分段选择"
              description="与 Tab 共用选中效果；支持方向键、Home 和 End，跳过禁用项。"
            >
              <Segmented
                label="工具类型示例"
                value={choice}
                onValueChange={setChoice}
                items={[
                  { value: 'all', label: '全部', count: 3 },
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
                setError('请输入名称')
                input.current?.focus()
                toast('请填写名称后再保存。', 'error')
                return
              }
              setError('')
              toast('示例配置已通过校验', 'success')
            }}
            className="ui-demo-form"
          >
            <Field
              label="名称"
              inline
              hint="名称用于识别配置。留空保存可体验校验反馈。"
              error={error}
            >
              <Input
                ref={input}
                placeholder="输入示例名称"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError('')
                }}
              />
            </Field>
            <Field label="请求方式" inline>
              <Select value={method} onChange={(event) => setMethod(event.target.value)}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
              </Select>
            </Field>
            <Field label="用途说明" description="多行文本至少显示五行，剩余字数悬浮在右下角。">
              <Textarea
                showCount
                value={description}
                maxLength={1000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="单行输入提示" inline>
              <InputHint
                label="单行输入"
                hint="问号在输入框右侧居中；悬停、点击或键盘聚焦阅读，Escape 关闭。"
              >
                <Input defaultValue="右侧问号不遮挡输入内容" />
              </InputHint>
            </Field>
            <Field label="多行输入提示" inline>
              <InputHint
                label="多行输入"
                multiline
                hint="问号在输入框右上角。长提示会换行，气泡通过 portal 显示，不被表单滚动区域裁掉。"
              >
                <Textarea rows={3} defaultValue={'第一行输入内容\n第二行输入内容'} />
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
                { name: 'first', upstreamName: '示例工具一' },
                { name: 'second', upstreamName: '示例工具二' },
              ]}
              operation={previewOperation}
              onOperationChange={setPreviewOperation}
            />
            <RunParameters
              label="运行参数（三工具共用）"
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
            <Field label="只读信息" inline>
              <Input value="由业务提供的只读值" readOnly />
            </Field>
            <Field
              label="工作目录"
              inline
              controlWidth="wide"
              hint="宽输入区与末尾展示共用实现，编辑时可使用 Home/End 查看完整路径。"
              action={
                <Button type="button" onClick={() => toast('目录选择按钮预览', 'info')}>
                  选择文件夹
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
              label="参数类型预览"
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
                label={previewParameterType === 'terminal' ? '外部参数' : '请求参数'}
                hint="组标题与基本配置字段标题使用同一字号和行高。"
                action={
                  <Button type="button" onClick={() => setPreviewParameters((value) => value + 1)}>
                    添加参数
                  </Button>
                }
              >
                {Array.from({ length: previewParameters }, (_, index) => (
                  <FieldRow
                    key={index}
                    label={`外部参数预览 ${index + 1}`}
                    fields={[
                      <Field
                        key="name"
                        label={previewParameterType === 'terminal' ? '变量名' : '参数名'}
                      >
                        <Input defaultValue={`PROJECT_${index + 1}`} />
                      </Field>,
                      <Field key="default" label="默认值">
                        <Input defaultValue="gushan" />
                      </Field>,
                      <Field key="description" label="输入说明">
                        <Input defaultValue="供自己和 AI 理解参数" />
                      </Field>,
                    ]}
                    options={
                      <>
                        <Checkbox label="必填" />
                        <Checkbox label="使用默认值" defaultChecked />
                      </>
                    }
                    action={
                      <Button
                        type="button"
                        onClick={() => setPreviewParameters((value) => Math.max(0, value - 1))}
                      >
                        删除
                      </Button>
                    }
                  />
                ))}
              </FieldGroup>
            )}
            <FieldGroup
              label="请求头 / MCP Header"
              action={
                <Checkbox
                  label="显示固定值"
                  checked={previewHeaderVisible}
                  onChange={(event) => setPreviewHeaderVisible(event.target.checked)}
                />
              }
            >
              <FieldRow
                size="compact"
                label="请求头预览"
                fields={[
                  <Input key="name" aria-label="请求头名称预览" defaultValue="X-Example" />,
                  <Input
                    key="value"
                    aria-label="请求头固定值预览"
                    type={previewHeaderVisible ? 'text' : 'password'}
                    defaultValue="example-value"
                  />,
                ]}
                action={
                  <Button type="button" onClick={() => toast('删除请求头操作预览', 'info')}>
                    删除
                  </Button>
                }
              />
            </FieldGroup>
            <Field label="禁用输入" inline>
              <Input placeholder="暂不可修改" disabled />
            </Field>
            <Checkbox
              label="启用示例配置"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <div className="ui-demo-form-actions">
              <Button type="submit" variant="primary">
                校验并保存示例
              </Button>
            </div>
          </form>
        )}
        {panel === 'feedback' && (
          <>
            <DemoRow title="说明提示" description="鼠标悬停、键盘聚焦或点击图标阅读，Escape 关闭。">
              <span className="ui-demo-hint">
                配置说明
                <Tooltip label="配置">
                  提示跟随当前主题，并在弹窗内保持可见；移动到提示上可继续阅读。
                </Tooltip>
              </span>
            </DemoRow>
            <DemoRow
              title="弹窗与确认"
              description="原生焦点约束、关闭后恢复焦点；二次确认默认聚焦取消。"
            >
              <Button ref={trigger} onClick={() => setModal(true)}>
                打开独立弹窗
              </Button>
              <Button onClick={() => setConfirm(true)}>打开二次确认</Button>
            </DemoRow>
            <DemoRow title="顶部气泡" description="复用现有气泡；成功与提醒 4 秒，错误 8 秒。">
              <Button onClick={() => toast('示例保存成功', 'success')}>成功</Button>
              <Button onClick={() => toast('这是一条示例提醒', 'info')}>提醒</Button>
              <Button variant="danger" onClick={() => toast('示例操作失败，请重试。', 'error')}>
                错误
              </Button>
            </DemoRow>
            <DemoRow
              title="标签与容器"
              description="浅色卡片使用独立纯白表面，输入框使用浅灰；悬停或聚焦沿用重阴影，标签色彩对应具体语义。"
            >
              <Card interactive tabIndex={0} className="ui-demo-card">
                <strong>示例工具</strong>
                <p>卡片与输入框底色独立，主按钮使用橙琥珀配深色文字。</p>
                <Field label="输入框底色示例">
                  <Input placeholder="浅灰输入区域" />
                </Field>
                <Button variant="primary" onClick={() => toast('主色按钮示例已触发', 'success')}>
                  主色按钮示例
                </Button>
                <div className="ui-demo-badges">
                  <Badge>默认</Badge>
                  <Badge tone="accent">待审阅</Badge>
                  <Badge tone="success">已连接</Badge>
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
                  <Badge tone="danger">失败</Badge>
                </div>
              </Card>
            </DemoRow>
          </>
        )}
      </div>
      {modal && (
        <Modal
          title="组件弹窗预览"
          returnFocus={trigger.current}
          onClose={() => setModal(false)}
          actions={
            <>
              <Button onClick={() => toast('弹窗内反馈保持在窗口顶部', 'success')}>显示气泡</Button>
              <Button variant="primary" onClick={() => setConfirm(true)}>
                保存示例
              </Button>
            </>
          }
        >
          <p>此弹窗使用与设置页相同的 Modal。可打开二次确认，验证嵌套焦点与气泡层级。</p>
          <Field label="示例选项" hint="业务传入文案，组件负责交互。">
            <Input defaultValue="本次预览不写入业务配置" />
          </Field>
        </Modal>
      )}
      {confirm && (
        <ConfirmationDialog
          title="确认示例操作？"
          confirmLabel="确认"
          cancel={() => setConfirm(false)}
          confirm={() => {
            setConfirm(false)
            toast('示例操作已确认', 'success')
          }}
        >
          <p>这是组件交互示例，不会修改工具或服务。</p>
        </ConfirmationDialog>
      )}
    </SurfaceEffects>
  )
}
