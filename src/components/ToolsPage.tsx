// SPDX-License-Identifier: MPL-2.0
import { t, useLocale, getLocale } from '../i18n'
import { useRetainWindowState } from '../lib/window-retention'
import {
  Button,
  Input,
  Select,
  IconButton,
  Tabs,
  ChoiceCard,
  SurfaceButton,
  Card,
  Badge,
} from './ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { flushSync } from 'react-dom'
import {
  createCapabilityDefinition,
  validateCapabilityDefinition,
  validResponseFilter,
} from '@lumiplug/shared'
import type {
  CapabilityDefinition,
  CapabilitySummary,
  CapabilityTool,
  RunnerType,
  ToolTask,
} from '@lumiplug/shared'
import { toolsRequest, toolErrorMessage, toolAddedTime } from '../lib/tools'
import { useToast } from './ToastProvider'
import SimpleToolConfig, { ToolIdentity } from './SimpleToolConfig'
import ToolDialog from './ToolDialog'
import ConfirmationDialog from './ConfirmationDialog'
import { TaskResult, taskStatusLabel } from './ToolRunPanel'
import { openToolRunWindow } from '../lib/tool-run-window'
import { completeTaskSnapshot, refreshRunState } from '../lib/run-task-refresh'
import './tools.css'
type Tab = 'basic' | 'config' | 'history'
const detailTabs: { id: Tab; label: string }[] = [
  {
    id: 'basic',
    get label() {
      return t('基本配置')
    },
  },
  {
    id: 'config',
    get label() {
      return t('工具配置')
    },
  },
  {
    id: 'history',
    get label() {
      return t('运行记录')
    },
  },
]
function DetailSurface({
  modal,
  close,
  children,
  busy,
}: {
  busy: boolean
  modal: boolean
  close: () => void
  children: React.ReactNode
}) {
  useLocale()

  return modal ? (
    <ToolDialog close={close} busy={busy}>
      {children}
    </ToolDialog>
  ) : (
    <>{children}</>
  )
}

const statusLabel = (d: Pick<CapabilityDefinition, 'status' | 'enabled' | 'archived'>) =>
  d.archived
    ? t('已归档')
    : d.status === 'draft'
      ? t('草稿')
      : d.status === 'disabled'
        ? t('已停用')
        : d.enabled
          ? t('已启用')
          : t('未启用')
export default function ToolsPage({
  active,
  coreReady,
  registerLeave,
  openSettings,
}: {
  active: boolean
  coreReady: boolean
  registerLeave: (guard: (leave: () => void) => void) => void
  openSettings: () => void
}) {
  useLocale()

  const showToast = useToast()
  const [items, setItems] = useState<CapabilitySummary[]>([])
  const [selected, setSelected] = useState<CapabilityDefinition | null>(null)
  const [draft, setDraft] = useState<CapabilityDefinition | null>(null)
  const [creating, setCreating] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const kindDrafts = useRef(new Map<RunnerType, CapabilityDefinition>())
  const [editing, setEditing] = useState(false)
  const [rawDirty, setRawDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('basic')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stale, setStale] = useState(false)
  const [review, setReview] = useState(false)
  const [saveConfirm, setSaveConfirm] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [tasks, setTasks] = useState<ToolTask[]>([])
  const [taskStale, setTaskStale] = useState(false)
  const [historyTask, setHistoryTask] = useState<string | null>(null)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [conflict, setConflict] = useState(false)
  const sequence = useRef(0)
  const busyRef = useRef(false)
  const initialDraft = useRef('')
  const detailsRef = useRef<HTMLElement>(null)
  useRetainWindowState(
    !!selected ||
      editing ||
      creating ||
      busy ||
      loading ||
      !!search ||
      type !== 'all' ||
      status !== 'all',
  )
  const dirty =
    editing &&
    (rawDirty ||
      JSON.stringify(draft) !== (creating ? initialDraft.current : JSON.stringify(selected)))
  useEffect(() => {
    if (!editing) setRawDirty(false)
  }, [editing])
  const guard = useCallback(
    (action: () => void) => {
      if (busyRef.current) return
      if (dirty) setPending(() => action)
      else action()
    },
    [dirty],
  )
  const closeDetail = useCallback(() => {
    ++sequence.current
    setSelected(null)
    setDraft(null)
    setCreating(false)
    setEditing(false)
    setLoading(false)
    setReview(false)
    setSaveConfirm(false)
    setPending(null)
    setRawDirty(false)
    requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }))
  }, [])
  useEffect(
    () =>
      registerLeave((leave) =>
        guard(() => {
          closeDetail()
          leave()
        }),
      ),
    [guard, registerLeave, closeDetail],
  )
  const refresh = useCallback(
    async (quiet = true) => {
      if (!coreReady) return
      try {
        setItems(await toolsRequest<CapabilitySummary[]>('list'))
        setStale(false)
      } catch {
        setStale(true)
        if (!quiet) throw new Error('core_unavailable')
      }
    },
    [coreReady],
  )
  useEffect(() => {
    if (!active || !coreReady) return
    return refreshRunState({
      wakeTarget: window,
      interval: 2000,
      read: () => refresh(),
      update: () => {},
      fail: () => {},
    })
  }, [active, coreReady, refresh])
  useEffect(() => {
    if (!active || !coreReady || !selected) return
    return refreshRunState({
      interval: 1000,
      shouldPoll: (tasks) => tasks.some((task) => ['running', 'stopping'].includes(task.status)),
      wakeTarget: window,
      read: async () => {
        const next = await toolsRequest<ToolTask[]>('tasks', { id: selected.id })
        const full = historyTask ? await toolsRequest<ToolTask>('task', { id: historyTask }) : null
        return completeTaskSnapshot(next, full, selected.id)
      },
      update: (next) => {
        setTasks(next)
        setTaskStale(false)
      },
      fail: () => setTaskStale(true),
    })
  }, [active, coreReady, selected, historyTask])
  useEffect(() => {
    if (!loading && selected && !creating)
      detailsRef.current
        ?.querySelector<HTMLElement>('#tool-detail-title')
        ?.focus({ preventScroll: true })
  }, [selected?.id, loading, creating])
  async function select(id: string, intent: 'config' | 'run' | 'review' = 'config') {
    if (intent === 'run') {
      await openRun(id, items.find((item) => item.id === id)?.name ?? t('工具运行'))
      return
    }
    if (!selected)
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    const request = ++sequence.current
    setLoading(true)
    setReview(false)
    setConflict(false)
    setHistoryTask(null)
    setTasks([])
    try {
      const def = await toolsRequest<CapabilityDefinition>('get', { id })
      if (request !== sequence.current) return
      setSelected(def)
      setDraft(structuredClone(def))
      setEditing(!def.archived)
      setRawDirty(false)
      setCreating(false)
      setTab(intent === 'review' ? 'config' : 'basic')
      setReview(intent === 'review' && !def.archived)
      detailsRef.current?.focus({ preventScroll: true })
    } catch (error) {
      showToast(toolErrorMessage(error), 'error')
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    const item = items.find((i) => i.id === selected?.id)
    if (item && selected && item.updatedAt !== selected.updatedAt && !busyRef.current) {
      if (dirty) setConflict(true)
      else void select(item.id)
    }
    // Keep edits private until save; poll never overwrites local input.
  }, [items])
  function newTool() {
    ++sequence.current
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCreating(true)
    setEditing(true)
    setSelected(null)
    setDraft(null)
    setTab('basic')
    setReview(false)
    setConflict(false)
    setTasks([])
    setPending(null)
    kindDrafts.current.clear()
    setWizardStep(0)
    choose('terminal', false)
  }
  function choose(kind: RunnerType, preserve = true) {
    if (preserve && draft) kindDrafts.current.set(draft.runner.type, structuredClone(draft))
    setCreating(true)
    setEditing(true)
    const def = createCapabilityDefinition(
      kind === 'http' ? { kind, name: 'newTool', url: '' } : { kind, name: 'newTool' },
    )
    def.namespace = `tool_${def.id.replaceAll('-', '').slice(0, 12)}`
    def.name = preserve ? (draft?.name ?? '') : ''
    def.description = preserve ? (draft?.description ?? '') : ''
    def.tools.forEach((t) => {
      t.description = ''
      if (kind === 'http') {
        t.fields = []
        t.outputSchema = {
          type: 'object',
          properties: { status: { type: 'integer' }, body: { type: 'string' } },
          additionalProperties: false,
        }
      }
    })
    if (def.runner.settings.type === 'http') def.runner.settings.responseMode = 'text'
    if (def.runner.settings.type === 'mcp') def.runner.settings.transport = 'streamable-http'
    if (def.runner.settings.type === 'terminal') {
      def.runner.settings.cwd = ''
      def.runner.settings.command = ''
      def.tools[0]!.fields = []
      def.tools.push({
        ...structuredClone(def.tools[0]!),
        name: 'start',
        description: t('启动后台命令，持续运行直到停止或应用退出。'),
        outputSchema: {
          type: 'object',
          properties: { taskId: { type: 'string' }, status: { type: 'string' } },
          required: ['taskId', 'status'],
          additionalProperties: false,
        },
      })
    }
    const cached = preserve ? kindDrafts.current.get(kind) : undefined
    const next = cached ? { ...cached, name: def.name, description: def.description } : def
    if (!preserve) initialDraft.current = JSON.stringify(next)
    setRawDirty(false)
    setDraft(next)
  }
  async function action<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
    if (busyRef.current || !coreReady) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await work()
      if (success) showToast(success, 'success')
      setStale(false)
      return result
    } catch (error) {
      showToast(toolErrorMessage(error), 'error')
      if (String(error).includes('tool_version_conflict')) setConflict(true)
      return undefined
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function invalid(message: string, path = 'name') {
    const fields = Array.from(
      detailsRef.current?.querySelectorAll<HTMLElement>('[data-validation]') ?? [],
    )
    const closestField = fields
      .filter((field) => {
        const prefix = field.dataset.validation!
        return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)
      })
      .sort((a, b) => b.dataset.validation!.length - a.dataset.validation!.length)[0]
    const input =
      closestField ??
      detailsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      detailsRef.current?.querySelector<HTMLElement>('[data-validation="name"]')
    const panel = input?.closest<HTMLElement>('[data-config-tab]')?.dataset.configTab
    if (!creating && (panel === 'basic' || panel === 'config')) flushSync(() => setTab(panel))
    let ancestor = input?.parentElement
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      ancestor = ancestor.parentElement
    }
    input?.setAttribute('aria-invalid', 'true')
    if (!input?.getAttribute('aria-describedby'))
      input?.setAttribute('aria-describedby', 'tool-validation-error')
    input?.focus()
    showToast(message, 'error')
  }
  function changeDraft(next: CapabilityDefinition) {
    detailsRef.current
      ?.querySelectorAll('[aria-describedby="tool-validation-error"]')
      .forEach((field) => {
        field.removeAttribute('aria-invalid')
        field.removeAttribute('aria-describedby')
      })
    setDraft(next)
    setReview(false)
  }
  function validDraft() {
    if (!draft) return false
    if (detailsRef.current?.querySelector('[aria-invalid="true"]')) {
      invalid(t('请先修正标记的输入或 JSON。'), '')
      return false
    }
    const settings = draft.runner.settings
    if (settings.type === 'terminal' && !settings.command?.trim()) {
      invalid(t('请填写 Shell 命令。'), 'runner.settings.command')
      return false
    }
    if (
      settings.type === 'http' &&
      settings.responseFilter !== undefined &&
      !validResponseFilter(settings.responseFilter)
    ) {
      invalid(
        t('返回规则的叶值须为有效正则，数组须包含一个元素模板。'),
        'runner.settings.responseFilter',
      )
      return false
    }
    if (
      settings.type === 'http' &&
      ['GET', 'DELETE'].includes(settings.method) &&
      ((settings.body && Object.keys(settings.body).length) ||
        draft.tools.some((t) => t.fields.some((f) => f.binding?.location === 'body')))
    ) {
      invalid(t('GET 和 DELETE 请使用 Query 查询参数。'), 'runner.settings.method')
      return false
    }
    if (settings.type === 'terminal') {
      const bad =
        draft.tools[0]?.fields.findIndex(
          (f) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(f.key) || f.key === 'LUMIPLUG_SESSION_TOKEN',
        ) ?? -1
      if (bad >= 0) {
        invalid(
          t('变量名须以字母开头，仅包含字母、数字、下划线，不能使用保留名称。'),
          `tools[0].fields[${bad}].key`,
        )
        return false
      }
    }
    const validation = validateCapabilityDefinition(draft)
    if (!validation.valid) {
      invalid(
        t('请检查标记字段：名称不能为空，公开标识和参数须符合格式。'),
        validation.issues[0]?.path,
      )
      return false
    }
    return true
  }
  function nextStep() {
    if (!draft?.name.trim() || draft.name.length > 64 || /\p{Cc}/u.test(draft.name)) {
      invalid(t('请填写工具名称。'))
      return
    }
    setWizardStep(1)
    detailsRef.current
      ?.querySelector<HTMLElement>('#tool-dialog-title')
      ?.focus({ preventScroll: true })
    detailsRef.current?.querySelector('.tools-detail-scroll')?.scrollTo({ top: 0 })
  }
  async function save(confirmed = false) {
    if (!creating && !dirty) return
    if (!draft || !validDraft()) return
    const settings = draft.runner.settings
    if (
      settings.type === 'http' ||
      (settings.type === 'mcp' && settings.transport === 'streamable-http')
    ) {
      try {
        const url = new URL(settings.url ?? '')
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error()
      } catch {
        invalid(t('请填写有效的 HTTP 或 HTTPS 地址。'), 'runner.settings.url')
        return
      }
    }
    if (!confirmed) {
      setSaveConfirm(true)
      return
    }
    const result = await action(
      () =>
        toolsRequest<CapabilityDefinition>('save', {
          definition: draft,
          expectedVersion: selected?.version ?? 0,
        }),
      t('已保存为草稿，审阅并启用后可调用'),
    )
    if (result) {
      setSaveConfirm(false)
      setSelected(result)
      setDraft(structuredClone(result))
      setEditing(!result.archived)
      setRawDirty(false)
      setCreating(false)
      setConflict(false)
      setReview(false)
      await refresh()
    }
  }
  async function discover() {
    if (!draft) return
    const result = await action(
      () => toolsRequest<CapabilityTool[]>('discover', { definition: draft }),
      t('已读取真实操作，请保存草稿后审阅并启用'),
    )
    if (result) setDraft({ ...draft, tools: result })
  }
  async function enable() {
    if (!selected) return
    const result = await action(
      () =>
        toolsRequest<CapabilityDefinition>('enable', {
          id: selected.id,
          expectedVersion: selected.version,
          expectedUpdatedAt: selected.updatedAt,
        }),
      t('已授权并启用；AI 客户端可刷新工具目录'),
    )
    if (result) {
      setSelected(result)
      setDraft(structuredClone(result))
      setReview(false)
      setTab('config')
      await refresh()
    }
  }
  async function archive() {
    if (!selected) return
    const result = await action(
      () =>
        toolsRequest<CapabilityDefinition>(selected.archived ? 'restore' : 'archive', {
          id: selected.id,
          expectedVersion: selected.version,
          expectedUpdatedAt: selected.updatedAt,
        }),
      selected.archived
        ? t('已恢复为草稿，请审阅并启用')
        : t('已归档，配置和执行记录已保留；已有任务可单独停止'),
    )
    if (result) {
      setSelected(result)
      setDraft(structuredClone(result))
      setEditing(!result.archived && tab !== 'history')
      setReview(false)
      await refresh()
    }
  }
  function requestReview() {
    setEditing(!selected?.archived)
    setTab('config')
    setReview(true)
  }
  async function openRun(id: string, title: string, taskId?: string) {
    await action(() => openToolRunWindow(id, title, taskId))
  }
  async function taskAction(kind: 'stop' | 'restart', id: string) {
    const result = await action(
      () => toolsRequest<ToolTask>(kind, { id }),
      kind === 'stop' ? t('已请求停止任务') : t('已提交新的运行任务'),
    )
    if (result) {
      setTasks((current) => [result, ...current.filter((t) => t.id !== result.id)])
      if (kind === 'restart') {
        setHistoryTask(result.id)
        setTab('history')
      }
    }
    return result
  }
  const unarchived = items.filter((item) => !item.archived)
  const archived = items.filter((item) => item.archived)
  const collection = type === 'archived' ? archived : unarchived
  const typeCounts = {
    all: unarchived.length,
    terminal: unarchived.filter((item) => item.runnerType === 'terminal').length,
    http: unarchived.filter((item) => item.runnerType === 'http').length,
    mcp: unarchived.filter((item) => item.runnerType === 'mcp').length,
    archived: archived.length,
  }
  const typeLabel = (kind: string) =>
    kind === 'all' ? t('全部') : kind === 'archived' ? t('已归档') : kind.toUpperCase()
  const visible = collection.filter(
    (i) =>
      (type === 'all' || type === 'archived' || type === i.runnerType) &&
      (type === 'archived' || status === 'all' || status === i.status) &&
      `${i.name} ${i.description} ${i.namespace}`.toLowerCase().includes(search.toLowerCase()),
  )
  const def = editing ? draft : selected
  const detailOpen = creating || selected !== null || loading
  const history = tasks.find((t) => t.id === historyTask)
  return (
    <section className="tools-page" hidden={!active}>
      <h1 className="sr-only">{t('工具')}</h1>
      <div className="tools-overview" hidden={detailOpen && !creating}>
        <header className="tools-toolbar ui-list-toolbar">
          <div className="tools-toolbar-heading ui-list-toolbar-heading">
            <Tabs
              className="tools-type-tabs ui-list-toolbar-tabs"
              label={t('工具类型')}
              value={type}
              onValueChange={setType}
              items={(['all', 'terminal', 'http', 'mcp', 'archived'] as const).map((kind) => ({
                value: kind,
                label: typeLabel(kind),
                id: `tools-type-${kind}`,
                count: typeCounts[kind],
                panelId: 'tools-list-panel',
                accessibleLabel: t('{v0}，{v1} 个工具', {
                  v0: typeLabel(kind),
                  v1: typeCounts[kind],
                }),
              }))}
            />
            <Button
              variant="primary"
              type="button"
              className="primary-button"
              disabled={!coreReady || busy}
              onClick={() => guard(newTool)}
            >
              {t('新增工具')}
            </Button>
          </div>
          <div className="tools-filters ui-list-toolbar-filters">
            <Input
              className="ui-list-toolbar-search"
              aria-label={t('搜索工具')}
              placeholder={t('搜索工具…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label={t('授权状态')}
              disabled={type === 'archived'}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">{t('全部状态')}</option>
              <option value="draft">{t('草稿')}</option>
              <option value="ready">{t('已启用')}</option>
              <option value="disabled">{t('已停用')}</option>
            </Select>
            <IconButton
              type="button"
              className="tool-button tools-refresh"
              label={t('刷新工具')}
              title={t('刷新工具')}
              disabled={!coreReady || busy}
              onClick={() => void action(() => refresh(false), t('工具列表已刷新'))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M20 7v5h-5M4 17v-5h5M19 12a7 7 0 0 0-12-5L4 10m1 2a7 7 0 0 0 12 5l3-3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </IconButton>
          </div>
        </header>
        {(!coreReady || stale) && (
          <Card density="compact" className="tools-service">
            <span>
              {coreReady
                ? t('内容可能未更新，请刷新重试。')
                : t('服务未连接，连接后可保存、授权和运行。')}
            </span>
            <Button type="button" className="tool-button" onClick={() => guard(openSettings)}>
              {t('到设置查看服务')}
            </Button>
          </Card>
        )}
        <div
          id="tools-list-panel"
          className="tools-list"
          role="tabpanel"
          aria-labelledby={`tools-type-${type}`}
        >
          <div className="tools-grid">
            {visible.map((item) => {
              const added = toolAddedTime(item.createdAt)
              const dateId = `tool-added-time-${item.id}`
              return (
                <Card
                  key={item.id}
                  role="article"
                  density="compact"
                  interactive
                  className="tool-card"
                >
                  <SurfaceButton
                    type="button"
                    className="tools-card-open"
                    aria-label={t('查看 {v0}，{v1}，{v2} 个操作', {
                      v0: item.name,
                      v1: statusLabel(item),
                      v2: item.toolCount,
                    })}
                    aria-describedby={dateId}
                    disabled={!coreReady || busy}
                    onClick={() => guard(() => void select(item.id))}
                  />
                  <div className="tools-row-title">
                    <strong title={item.name}>{item.name}</strong>
                    <Badge
                      tone={
                        item.archived
                          ? 'neutral'
                          : item.enabled
                            ? 'success'
                            : item.status === 'draft'
                              ? 'accent'
                              : 'neutral'
                      }
                    >
                      {statusLabel(item)}
                    </Badge>
                    <IconButton
                      glow
                      tone={item.archived ? 'neutral' : item.enabled ? 'success' : 'accent'}
                      type="button"
                      className={`tool-button tools-card-action action-${item.archived ? 'view' : item.enabled ? 'run' : 'review'}`}
                      disabled={!coreReady || busy}
                      label={`${item.archived ? t('查看') : item.enabled ? t('运行') : t('审阅')} ${item.name}（${statusLabel(item)}）`}
                      title={`${item.archived ? t('查看') : item.enabled ? t('运行') : t('审阅')} ${item.name}（${statusLabel(item)}）`}
                      onClick={() =>
                        guard(
                          () =>
                            void select(
                              item.id,
                              item.enabled ? 'run' : item.archived ? 'config' : 'review',
                            ),
                        )
                      }
                    >
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
                        {item.archived ? (
                          <>
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        ) : item.enabled ? (
                          <path d="m8 5 11 7-11 7V5Z" />
                        ) : (
                          <>
                            <path d="M9.5 3h5l.6 2.6 1.2.7 2.6-.8 2.5 4.3-2 1.8v1.4l2 1.8-2.5 4.3-2.6-.8-1.2.7-.6 2.6h-5l-.6-2.6-1.2-.7-2.6.8-2.5-4.3 2-1.8v-1.4l-2-1.8 2.5-4.3 2.6.8 1.2-.7L9.5 3Z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        )}
                      </svg>
                    </IconButton>
                  </div>
                  <p className="ui-resource-description tools-row-description">
                    {item.description || t('点击配置，让自己和 AI 一起使用')}
                  </p>
                  <div className="ui-resource-meta tools-card-identity">
                    <Badge className="tool-kind-tag" data-tool-kind={item.runnerType}>
                      {item.runnerType.toUpperCase()}
                    </Badge>
                    <span id={dateId} title={t('Lumi 工具创建时间（本机时区）')}>
                      {added.dateTime ? (
                        <time dateTime={added.dateTime}>{added.text}</time>
                      ) : (
                        added.text
                      )}
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
          {!visible.length && (
            <div className="tools-empty">
              <strong>{items.length ? t('没有匹配的工具') : t('还没有工具')}</strong>
              <p>
                {items.length ? t('修改搜索或筛选条件。') : t('创建一个工具，供自己和 AI 使用。')}
              </p>
              {items.length > 0 && (
                <Button
                  type="button"
                  className="tool-button"
                  onClick={() => {
                    setSearch('')
                    setType('all')
                    setStatus('all')
                  }}
                >
                  {t('清除筛选')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {active && detailOpen && (
        <DetailSurface modal={creating} busy={busy} close={() => guard(closeDetail)}>
          <section
            className={`tools-detail${creating ? '' : ' tools-subpage'}`}
            ref={detailsRef}
            tabIndex={-1}
            aria-label={t('工具详情')}
          >
            <div className="tools-detail-header">
              {!creating && (
                <IconButton
                  type="button"
                  disabled={busy}
                  onClick={() => guard(closeDetail)}
                  label={t('返回工具列表')}
                  title={t('返回工具列表')}
                >
                  <ArrowLeft size={18} />
                </IconButton>
              )}
              <div className="tools-detail-heading">
                <h2 id={creating ? 'tool-dialog-title' : 'tool-detail-title'} tabIndex={-1}>
                  {creating
                    ? wizardStep === 0
                      ? t('新增工具')
                      : t('配置 {v0}', { v0: draft?.runner.type.toUpperCase() })
                    : (selected?.name ?? t('加载详情…'))}
                </h2>
                {creating && (
                  <p className="tool-help">
                    {wizardStep === 0 ? t('1 / 2 · 名称与类型') : t('2 / 2 · 工具配置')}
                  </p>
                )}
                {selected && (
                  <p className="tool-help">
                    {selected.namespace} · {statusLabel(selected)} · v{selected.version} ·{' '}
                    {selected.source === 'ai'
                      ? t('AI 草稿')
                      : selected.source === 'import'
                        ? t('导入')
                        : t('本机创建')}
                  </p>
                )}
              </div>
              {selected && (
                <div className="tools-detail-actions">
                  <Button
                    variant={
                      !selected.archived && !dirty && selected.enabled ? 'primary' : 'secondary'
                    }
                    type="button"
                    className="primary-button"
                    disabled={
                      busy || !coreReady || !selected.enabled || dirty || !!selected.archived
                    }
                    onClick={() => void openRun(selected.id, selected.name)}
                  >
                    {t('运行')}
                  </Button>
                  <Button
                    variant={!selected.archived && dirty ? 'primary' : 'secondary'}
                    type="submit"
                    form="tool-config-form"
                    className="primary-button"
                    loading={busy}
                    disabled={
                      busy || !coreReady || !dirty || !!selected.archived || tab === 'history'
                    }
                    aria-busy={busy}
                    data-busy={busy}
                    aria-label={busy ? t('处理中…') : t('保存')}
                  >
                    {t('保存')}
                  </Button>
                  {!selected.enabled && !selected.archived && (
                    <Button
                      variant={!dirty ? 'primary' : 'secondary'}
                      type="button"
                      className="tool-button"
                      disabled={busy || !coreReady || dirty}
                      onClick={requestReview}
                    >
                      {t('启用')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="tool-button"
                    disabled={busy || !coreReady || dirty}
                    onClick={() => void archive()}
                  >
                    {selected.archived ? t('恢复') : t('归档')}
                  </Button>
                </div>
              )}
              {creating && (
                <IconButton
                  type="button"
                  className="tool-button tools-close"
                  label={t('关闭工具弹窗')}
                  disabled={busy}
                  onClick={() => guard(closeDetail)}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="m6 6 12 12M6 18 18 6" />
                  </svg>
                </IconButton>
              )}
            </div>
            {!creating && selected && (
              <Tabs
                className="tools-tabs"
                label={t('工具详情页面')}
                value={tab}
                items={detailTabs.map(({ id, label }) => ({
                  value: id,
                  label,
                  id: `tool-tab-${id}`,
                  panelId: `tool-panel-${id}`,
                }))}
                onValueChange={(t) => {
                  if (t === tab) return
                  if (t !== 'history') {
                    setEditing(!selected.archived)
                    setReview(false)
                    setTab(t)
                    return
                  }
                  guard(() => {
                    setEditing(false)
                    setDraft(selected)
                    setReview(false)
                    setTab(t)
                  })
                }}
              />
            )}
            <div className="tools-detail-scroll" aria-busy={busy || loading}>
              {loading ? (
                <p className="tool-help">{t('正在读取配置…')}</p>
              ) : (
                <>
                  {def && (
                    <form
                      id="tool-config-form"
                      hidden={tab === 'history'}
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (creating && wizardStep === 0) nextStep()
                        else void save()
                      }}
                    >
                      <span id="tool-validation-error" className="sr-only">
                        {t('请检查标记字段，名称不能为空，JSON 须符合格式。')}
                      </span>
                      {conflict && (
                        <Card density="compact" className="tools-conflict">
                          <p>{t('配置已在其他入口更新，当前输入已保留。')}</p>
                          <Button
                            type="button"
                            className="tool-button"
                            onClick={() => guard(() => void select(selected!.id))}
                          >
                            {t('查看最新版本')}
                          </Button>
                        </Card>
                      )}
                      {creating && (
                        <div hidden={wizardStep !== 0}>
                          <ToolIdentity definition={def} disabled={busy} change={changeDraft}>
                            {creating && wizardStep === 0 && (
                              <div className="tools-create-type">
                                <h3>{t('选择连接方式')}</h3>
                                <div className="tools-kind-options">
                                  {(['terminal', 'http', 'mcp'] as RunnerType[]).map((kind) => (
                                    <ChoiceCard
                                      key={kind}
                                      label={kind.toUpperCase()}
                                      description={
                                        kind === 'terminal'
                                          ? t('运行本机命令')
                                          : kind === 'http'
                                            ? t('请求接口')
                                            : t('连接上游工具服务')
                                      }
                                      selected={draft?.runner.type === kind}
                                      disabled={busy}
                                      onClick={() => {
                                        if (draft && draft.runner.type !== kind) {
                                          if (rawDirty) guard(() => choose(kind))
                                          else choose(kind)
                                        } else if (!draft) choose(kind)
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </ToolIdentity>
                        </div>
                      )}
                      {!creating && (
                        <div
                          id="tool-panel-basic"
                          role="tabpanel"
                          aria-labelledby="tool-tab-basic"
                          data-config-tab="basic"
                          hidden={tab !== 'basic'}
                        >
                          <ToolIdentity
                            key={`${def.id}:${def.version}:${editing}`}
                            definition={def}
                            disabled={!editing || busy}
                            change={changeDraft}
                          />
                        </div>
                      )}
                      <div
                        id={creating ? undefined : 'tool-panel-config'}
                        role={creating ? undefined : 'tabpanel'}
                        aria-labelledby={creating ? undefined : 'tool-tab-config'}
                        data-config-tab="config"
                        hidden={creating ? wizardStep === 0 : tab !== 'config'}
                      >
                        <SimpleToolConfig
                          identity={false}
                          key={`${def.id}:${def.version}:${editing}`}
                          definition={def}
                          editable={editing}
                          busy={busy}
                          onRawChange={() => setRawDirty(true)}
                          change={changeDraft}
                          discover={() => void discover()}
                        />
                      </div>
                    </form>
                  )}
                  {selected && (
                    <div
                      id="tool-panel-history"
                      className="tools-history"
                      role="tabpanel"
                      aria-labelledby="tool-tab-history"
                      hidden={tab !== 'history'}
                    >
                      {taskStale && (
                        <p className="tool-help" role="status">
                          {t('运行记录更新中断，正在重新连接。')}
                        </p>
                      )}
                      {!tasks.length ? (
                        <div className="tools-empty">
                          <strong>{t('尚未运行')}</strong>
                          <p>{t('运行后可在这里查看状态、结果和日志。')}</p>
                          <Button
                            type="button"
                            className="tool-button"
                            disabled={
                              !selected.enabled || !!selected.archived || busy || !coreReady
                            }
                            onClick={() => void openRun(selected.id, selected.name)}
                          >
                            {t('打开运行')}
                          </Button>
                        </div>
                      ) : (
                        tasks.map((task) => (
                          <SurfaceButton
                            type="button"
                            className={`tools-history-row${historyTask === task.id ? ' is-selected' : ''}`}
                            key={task.id}
                            onClick={() => setHistoryTask(task.id)}
                          >
                            <strong>{task.operation}</strong>
                            <time>{new Date(task.startedAt).toLocaleString(getLocale())}</time>
                            <span>
                              {taskStatusLabel[task.status]} ·{' '}
                              {task.source === 'manual'
                                ? t('手动')
                                : task.source === 'ai'
                                  ? 'AI'
                                  : t('工作台')}{' '}
                              · v{task.version}
                            </span>
                          </SurfaceButton>
                        ))
                      )}
                      {history && (
                        <>
                          <div className="tool-actions">
                            <Button
                              disabled={busy || !coreReady}
                              onClick={() => void openRun(selected.id, selected.name, history.id)}
                            >
                              {t('独立窗口查看')}
                            </Button>
                          </div>
                          <TaskResult
                            history
                            key={history.id}
                            task={history}
                            canRestart={selected.enabled && !selected.archived}
                            busy={busy || !coreReady}
                            stop={() => void taskAction('stop', history.id)}
                            restart={() => void taskAction('restart', history.id)}
                          />
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {creating && editing && def && !loading && (
              <div className="tools-savebar">
                <Button
                  type="button"
                  className="tool-button"
                  disabled={busy}
                  onClick={() =>
                    guard(() => {
                      closeDetail()
                    })
                  }
                >
                  {t('取消')}
                </Button>
                {creating && wizardStep === 1 && (
                  <Button
                    type="button"
                    className="tool-button"
                    disabled={busy}
                    onClick={() => {
                      setWizardStep(0)
                      detailsRef.current?.querySelector<HTMLElement>('#tool-dialog-title')?.focus()
                    }}
                  >
                    {t('上一步')}
                  </Button>
                )}
                {(!creating || wizardStep === 1) && (
                  <Button
                    variant="primary"
                    type="submit"
                    form="tool-config-form"
                    className="primary-button"
                    loading={busy}
                    disabled={busy || !coreReady}
                    aria-label={busy ? t('处理中…') : t('保存为草稿')}
                    aria-busy={busy}
                    data-busy={busy}
                  >
                    {t('保存为草稿')}
                  </Button>
                )}
                {creating && wizardStep === 0 && (
                  <Button
                    variant="primary"
                    type="submit"
                    form="tool-config-form"
                    className="primary-button"
                    disabled={busy}
                  >
                    {t('下一步')}
                  </Button>
                )}
              </div>
            )}
          </section>
        </DetailSurface>
      )}
      {active && pending && (
        <ConfirmationDialog
          title={t('放弃未保存的修改？')}
          cancelLabel={t('继续编辑')}
          confirmLabel={t('放弃修改')}
          danger
          cancel={() => setPending(null)}
          confirm={() => {
            const next = pending
            setPending(null)
            setEditing(false)
            setCreating(false)
            setDraft(selected)
            next()
          }}
        >
          <p>{t('有未保存的修改，离开会丢弃这些输入。')}</p>
        </ConfirmationDialog>
      )}
      {active && saveConfirm && draft && (
        <ConfirmationDialog
          title={creating ? t('保存工具草稿？') : t('保存工具配置？')}
          confirmLabel={creating ? t('保存为草稿') : t('保存配置')}
          busy={busy}
          disabled={!coreReady}
          cancel={() => setSaveConfirm(false)}
          confirm={() => void save(true)}
        >
          <p>
            {t('保存「')}
            {draft.name}
            {t('」的当前配置。')}
          </p>
          <p>
            {selected?.enabled
              ? t('保存后将暂停此工具的新调用，需重新授权；已有任务继续运行。')
              : t('配置将保存为草稿，授权并启用后才可调用。')}
          </p>
        </ConfirmationDialog>
      )}
      {active && review && selected && (
        <ConfirmationDialog
          title={t('授权并启用工具？')}
          confirmLabel={t('授权并启用')}
          busy={busy}
          disabled={!coreReady || dirty}
          cancel={() => setReview(false)}
          confirm={() => void enable()}
        >
          <p>
            {selected.name} · {selected.description || t('未填写用途说明')}
          </p>
          <p>
            {t('请审阅连接配置、全部操作、公开参数和固定值。启用后，你和 AI 都能执行这些操作。')}
          </p>
          <p>
            {selected.runner.type === 'terminal'
              ? t('允许执行配置中的 Shell 命令；未指定目录时使用用户主目录。')
              : selected.runner.type === 'http'
                ? t('允许向已配置地址发送请求；请求可能修改目标服务的数据。')
                : t('允许调用上游服务的全部已发现操作；这些操作可能产生外部效果。')}
          </p>
          <p>{t('工具名及公开说明会提供给 AI。启用不会自动运行。')}</p>
        </ConfirmationDialog>
      )}
    </section>
  )
}
