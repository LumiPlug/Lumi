// SPDX-License-Identifier: MPL-2.0
import { translateKnown, t, useLocale, getLocale } from '../i18n'
import {
  Button,
  Select,
  Textarea,
  Input,
  Field,
  FieldTitle,
  Modal,
  Tabs,
  Badge,
  IconButton,
  LogViewer,
  TerminalText,
  WindowPanel,
  StageSection,
} from './ui'
import { ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { remoteResultPanels, runHttpStatus, displayRunResult } from '../lib/run-remote-result'
import type { ReactNode } from 'react'
import RunConfigurationFields from './RunConfigurationFields'
import { RunParameters } from './RunParameters'
import { availableRunOperations, initialRunOperation } from '../lib/run-operation'
import { TerminalWorkingDirectory } from './TerminalWorkingDirectory'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  CapabilityDefinition,
  CapabilityField,
  JsonObject,
  ToolTask,
  ToolRunPreparation,
  ToolRunOverrides,
  ToolTaskInputSnapshot,
} from '@lumiplug/shared'
import { TOOL_ERRORS } from '@lumiplug/shared'
import { useToast } from './ToastProvider'
import {
  needsRunInput,
  multilineRunField,
  formatRunValue,
  prepareManualInputs,
  runFieldValue,
  runLogText,
  runConfigurationPreview,
} from '../lib/tool-run'
import type { RunValues } from '../lib/tool-run'
import { toolsRequest, toolErrorMessage } from '../lib/tools'
import { copyText } from '../lib/clipboard'
import { refreshRunState } from '../lib/run-task-refresh'
import { terminalOutputText } from '../lib/terminal-output'

export const taskStatusLabel: Record<ToolTask['status'], string> = {
  get running() {
    return t('运行中')
  },
  get stopping() {
    return t('正在停止')
  },
  get completed() {
    return t('已完成')
  },
  get failed() {
    return t('失败')
  },
  get cancelled() {
    return t('已取消')
  },
  get timed_out() {
    return t('超时')
  },
  get interrupted() {
    return t('已中断')
  },
}
const taskActive = (task: ToolTask) => ['running', 'stopping'].includes(task.status)
function resultText(result: ToolTask['result']): string {
  if (typeof result === 'string') return result
  if (result && !Array.isArray(result) && typeof result === 'object') {
    if (Object.keys(result).length === 1 && typeof result.text === 'string') return result.text
    if (
      Object.keys(result).length === 2 &&
      typeof result.body === 'string' &&
      typeof result.status === 'number'
    )
      return result.body
  }
  return JSON.stringify(result, null, 2)
}
function resultPresentation(result: ToolTask['result']) {
  const text = resultText(result)
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object')
      return { text: JSON.stringify(parsed, null, 2), structured: true }
  } catch {
    /* Plain text remains ordinary body content. */
  }
  return { text, structured: false }
}
function TaskActions({
  task,
  stop,
  restart,
  busy,
  canRestart = true,
  modify,
  close,
  unavailable = false,
}: {
  task: ToolTask
  stop: () => void
  restart: () => void
  busy: boolean
  canRestart?: boolean
  modify?: () => void
  close?: () => void
  unavailable?: boolean
}) {
  useLocale()

  return (
    <>
      {taskActive(task) ? (
        <Button
          variant="danger"
          className="tool-run-footer-leading"
          disabled={busy || unavailable || task.status === 'stopping'}
          onClick={(event) => {
            if (event.detail < 2) stop()
          }}
        >
          {task.status === 'stopping' ? t('正在停止…') : t('停止')}
        </Button>
      ) : (
        <>
          {modify && (
            <Button
              variant="ghost"
              className="tool-run-footer-leading"
              disabled={busy}
              onClick={modify}
            >
              {t('修改参数')}
            </Button>
          )}
          <Button
            disabled={
              busy ||
              unavailable ||
              !canRestart ||
              task.canRestart === false ||
              task.cancellationUncertain
            }
            onClick={restart}
          >
            {t('再次运行')}
          </Button>
        </>
      )}
      {close && (
        <Button
          variant={taskActive(task) ? 'secondary' : 'primary'}
          disabled={busy}
          onClick={close}
        >
          {t('关闭')}
        </Button>
      )}
    </>
  )
}
export function TaskResult({
  task,
  stop,
  restart,
  busy,
  canRestart = true,
  modify,
  history = false,
  actions = true,
  stale = false,
  staged = false,
}: {
  staged?: boolean
  task: ToolTask
  stop: () => void
  restart: () => void
  busy: boolean
  canRestart?: boolean
  modify?: () => void
  history?: boolean
  actions?: boolean
  stale?: boolean
}) {
  useLocale()

  const active = taskActive(task)
  const showToast = useToast()
  const [clock, setClock] = useState(Date.now())
  const [follow, setFollow] = useState(true)
  const [showEvents, setShowEvents] = useState(!active && task.status !== 'completed')
  const [stream, setStream] = useState(
    task.status !== 'completed' && task.stderr ? 'stderr' : 'stdout',
  )
  const [copying, setCopying] = useState(false)
  const log = useRef<HTMLPreElement>(null)
  const outputId = useId()
  const errorId = useId()
  const logPanelId = useId()
  const summary = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    return refreshRunState({
      wakeTarget: window,
      interval: 1000,
      read: async () => Date.now(),
      update: setClock,
      fail: () => {},
    })
  }, [active, task.id])
  useEffect(() => {
    if (!active && task.status !== 'completed') {
      setShowEvents(true)
      if (task.stderr) setStream('stderr')
    }
  }, [active, task.status, task.stderr])
  useLayoutEffect(() => {
    if (!history && !staged) summary.current?.focus({ preventScroll: true })
  }, [task.id, history, staged])
  const seconds = Math.max(
    0,
    Math.floor(
      ((task.finishedAt ? Date.parse(task.finishedAt) : clock) - Date.parse(task.startedAt)) / 1000,
    ),
  )
  const eventText = (task.events ?? [])
    .map((event) => `${new Date(event.at).toLocaleTimeString(getLocale())}  ${event.message}`)
    .join('\n')
  const terminal = task.runnerType === 'terminal'
  const text = terminal ? (stream === 'stderr' ? task.stderr : task.stdout) : eventText
  const logVisible = terminal || (!staged && (active || showEvents))
  useLayoutEffect(() => {
    if (!staged && follow && logVisible && log.current)
      log.current.scrollTop = log.current.scrollHeight
  }, [text, follow, logVisible, stream, staged])
  const resultObject =
    task.result && !Array.isArray(task.result) && typeof task.result === 'object'
      ? task.result
      : null
  const presentation = resultPresentation(task.result)
  const output = terminal ? text : task.result === null ? '' : presentation.text
  const structured = !terminal && presentation.structured
  async function copyResult() {
    if (copying) return
    setCopying(true)
    try {
      const copied = await copyText(terminal ? terminalOutputText(output) : output)
      showToast(copied ? t('已复制结果。') : t('复制失败，请重试。'), copied ? 'success' : 'error')
    } finally {
      setCopying(false)
    }
  }
  return (
    <section className="tool-result">
      <div className="tool-result-summary" ref={summary} tabIndex={-1}>
        <div className="tool-result-heading">
          {!staged && (
            <Badge
              tone={
                task.status === 'completed'
                  ? 'success'
                  : ['failed', 'timed_out', 'interrupted'].includes(task.status)
                    ? 'danger'
                    : 'neutral'
              }
            >
              <span role="status" aria-live="polite">
                {task.cancellationUncertain ? t('结果未知') : taskStatusLabel[task.status]}
              </span>
            </Badge>
          )}
          <span className="tool-help">
            {seconds} {t(' 秒')}
            {terminal && resultObject?.exitCode !== undefined
              ? t(' · 退出码 {v0}', { v0: resultObject.exitCode ?? t('未知') })
              : ''}
            {task.runnerType === 'http' && typeof resultObject?.status === 'number'
              ? ` · HTTP ${resultObject.status}`
              : ''}
          </span>
        </div>
        {active && task.events?.length ? (
          <p className="tool-help" role="status">
            {task.events.at(-1)?.message}
          </p>
        ) : null}
        {stale && (
          <p className="tool-help" role="status">
            {t('状态更新中断，正在重新连接。当前显示最后一次收到的状态。')}
          </p>
        )}
        {history && (
          <p className="tool-help">
            {new Date(task.startedAt).toLocaleString(getLocale())} ·{' '}
            {task.source === 'manual' ? t('手动') : task.source === 'ai' ? 'AI' : t('工作台')} · v
            {task.version}
          </p>
        )}
        {task.cancellationUncertain && (
          <p className="tool-help">
            {t('已停止等待，服务端执行结果未知。再次执行前，请确认上次操作的结果。')}
          </p>
        )}
        {task.error && (
          <p>
            {(TOOL_ERRORS[task.error]
              ? translateKnown(TOOL_ERRORS[task.error] ?? '')
              : undefined) ?? t('运行未成功，请查看执行过程。')}
          </p>
        )}
      </div>
      <div
        className={`tool-result-content${terminal || active ? ' tool-result-content--stream' : ''}`}
      >
        {!terminal && !active && (
          <>
            <div className="tool-result-heading">
              {!staged && <h3>{t('运行结果')}</h3>}
              {output && (
                <Button
                  variant="text"
                  className={staged ? 'tool-result-copy' : undefined}
                  loading={copying}
                  onClick={() => void copyResult()}
                >
                  {t('复制结果')}
                </Button>
              )}
            </div>
            {task.result === null ? (
              <p className="tool-help">{t('未返回结果。')}</p>
            ) : output === '' ? (
              <p className="tool-help">{t('返回内容为空。')}</p>
            ) : structured ? (
              <pre aria-label={t('运行结果')}>{output}</pre>
            ) : (
              <p className="tool-run-text" aria-label={t('运行结果')}>
                {output}
              </p>
            )}
          </>
        )}
        {logVisible && (
          <>
            <div className="tool-result-heading">
              <h3>{terminal ? (active ? t('运行日志') : t('输出结果')) : t('执行过程')}</h3>
              <div className="tool-actions">
                {!follow && (terminal || active) && (
                  <Button variant="ghost" onClick={() => setFollow(true)}>
                    {t('回到最新')}
                  </Button>
                )}
                {terminal && !active && text && (
                  <Button variant="text" loading={copying} onClick={() => void copyResult()}>
                    {t('复制结果')}
                  </Button>
                )}
              </div>
            </div>
            {terminal && task.stderr && (
              <Tabs
                label={t('运行输出')}
                value={stream}
                onValueChange={(value) => {
                  setStream(value)
                  setFollow(true)
                }}
                items={[
                  { value: 'stdout', label: t('输出'), id: outputId, panelId: logPanelId },
                  { value: 'stderr', label: t('错误输出'), id: errorId, panelId: logPanelId },
                ]}
              />
            )}
            {text || active ? (
              <pre
                ref={log}
                className="tool-run-log"
                tabIndex={0}
                id={logPanelId}
                role={terminal && task.stderr ? 'tabpanel' : 'region'}
                aria-labelledby={
                  terminal && task.stderr ? (stream === 'stderr' ? errorId : outputId) : undefined
                }
                aria-label={
                  terminal && task.stderr ? undefined : terminal ? t('命令输出') : t('执行过程')
                }
                onScroll={(event) => {
                  const el = event.currentTarget
                  if (terminal || active)
                    setFollow(el.scrollHeight - el.clientHeight - el.scrollTop < 24)
                }}
              >
                {text ? (
                  terminal ? (
                    <TerminalText text={text} />
                  ) : (
                    text
                  )
                ) : terminal ? (
                  t('等待输出…')
                ) : (
                  t('等待执行事件…')
                )}
              </pre>
            ) : (
              <p className="tool-help">{t('没有输出。')}</p>
            )}
          </>
        )}
        {!staged && !terminal && !active && !!task.events?.length && (
          <Button
            variant="ghost"
            aria-expanded={showEvents}
            onClick={() => setShowEvents(!showEvents)}
          >
            {showEvents ? t('收起执行过程') : t('查看执行过程')}
          </Button>
        )}
      </div>
      {task.truncated && <p className="tool-help">{t('输出已达到预览上限，后续内容被截断。')}</p>}
      {active && (
        <p className="tool-help">{t('关闭弹窗后任务继续运行，可在此工具的运行记录中查看。')}</p>
      )}
      {history && (
        <code className="tool-task-id">
          {t('任务 ')}
          {task.id}
        </code>
      )}
      {actions && (
        <div className="tool-actions">
          <TaskActions
            task={task}
            stop={stop}
            restart={restart}
            busy={busy}
            canRestart={canRestart}
            modify={modify}
          />
        </div>
      )}
    </section>
  )
}

export function ToolRunHeader({
  title,
  description,
  status,
  tone = 'neutral',
  titleId,
}: {
  title: string
  description?: string
  status?: string
  tone?: 'neutral' | 'accent' | 'success' | 'danger'
  titleId?: string
}) {
  useLocale()

  return (
    <header className="ui-modal-heading tool-run-heading">
      <div className="tool-run-title">
        <h2
          id={titleId}
          data-modal-title={titleId ? true : undefined}
          tabIndex={titleId ? -1 : undefined}
        >
          {title}
        </h2>
        {description && <p className="tool-help">{description}</p>}
      </div>
      <div className="tool-run-header-actions">
        {status && (
          <Badge tone={tone}>
            <span role="status" aria-live="polite">
              {status}
            </span>
          </Badge>
        )}
      </div>
    </header>
  )
}

/** Both current runs and restored tasks retain the same two-node hierarchy. */
export function ToolRunStages({
  preparing = false,
  task,
  configuration,
  children,
}: {
  preparing?: boolean
  task?: ToolTask | null
  configuration: ReactNode
  children?: ReactNode
}) {
  useLocale()

  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (preparing) setExpanded(false)
  }, [preparing])
  return (
    <div
      className={`tool-run-node-flow${preparing ? '' : ' tool-run-node-flow--executing'}${!preparing && expanded ? ' tool-run-node-flow--expanded' : ''}`}
    >
      <StageSection
        title={t('配置')}
        state={preparing ? 'current' : 'past'}
        statusLabel={preparing ? '' : t('已配置')}
        expanded={expanded}
        onExpandedChange={setExpanded}
      >
        {configuration}
      </StageSection>
      <StageSection
        title={t('执行')}
        state={preparing ? 'pending' : 'current'}
        status={
          preparing || !task
            ? 'pending'
            : taskActive(task)
              ? 'running'
              : task.status === 'completed' && !task.cancellationUncertain
                ? 'completed'
                : 'failed'
        }
        statusLabel={
          preparing
            ? ''
            : task?.cancellationUncertain
              ? t('结果未知')
              : task
                ? taskStatusLabel[task.status]
                : t('读取中')
        }
      >
        {children}
      </StageSection>
    </div>
  )
}

export function RunProcess({ task, parameters }: { task: ToolTask; parameters?: ReactNode }) {
  useLocale()

  const finished = !taskActive(task)
  const terminal = task.runnerType === 'terminal'
  const result =
    task.result && !Array.isArray(task.result) && typeof task.result === 'object'
      ? task.result
      : null
  const log = [
    runLogText(task),
    task.error
      ? ((TOOL_ERRORS[task.error] ? translateKnown(TOOL_ERRORS[task.error] ?? '') : undefined) ??
        t('运行未成功，请查看日志。'))
      : '',
    task.cancellationUncertain
      ? t('已停止等待，服务端执行结果未知。再次执行前，请确认上次操作的结果。')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const response =
    finished && task.result !== null
      ? typeof task.result === 'string'
        ? task.result
        : JSON.stringify(task.result, null, 2)
      : ''
  const resultPanels = remoteResultPanels(task)
  const httpStatus = runHttpStatus(task)
  const defaultTab =
    terminal || !finished || task.status !== 'completed' || task.cancellationUncertain
      ? 'log'
      : 'result'
  const [selection, setSelection] = useState<{ taskId: string; tab: string } | null>(null)
  const tab = selection?.taskId === task.id ? selection.tab : defaultTab
  const id = useId()
  const [copying, setCopying] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<'inputs' | 'raw' | null>(null)
  const detailOrigin = useRef<HTMLElement | null>(null)
  const showToast = useToast()
  async function copyOutput(kind: string, text: string) {
    if (copying[kind] || !text) return
    setCopying((current) => ({ ...current, [kind]: true }))
    try {
      const copied = await copyText(text)
      showToast(
        copied ? t('已复制{v0}。', { v0: kind }) : t('复制失败，请重试。'),
        copied ? 'success' : 'error',
      )
    } catch {
      showToast(t('复制失败，请重试。'), 'error')
    } finally {
      setCopying((current) => ({ ...current, [kind]: false }))
    }
  }
  const copy = (kind: string, text: string, small = false) => (
    <IconButton
      label={t('复制{v0}', { v0: kind })}
      iconSize={small ? 'small' : 'default'}
      disabled={!text}
      loading={copying[kind]}
      onClick={() => void copyOutput(kind, text)}
    >
      <Copy />
    </IconButton>
  )
  const detailsButton = (
    <Button
      variant="text"
      onClick={(event) => {
        detailOrigin.current = event.currentTarget
        setDetail('inputs')
      }}
    >
      {t('查看详情')}
    </Button>
  )
  return (
    <div className="tool-run-output">
      {!terminal && (
        <div className="tool-run-output-navigation">
          {!terminal && (
            <Tabs
              label={t('运行内容')}
              value={tab}
              onValueChange={(next) => setSelection({ taskId: task.id, tab: next })}
              items={[
                { value: 'log', label: t('运行记录'), id: `${id}-log-tab`, panelId: `${id}-log` },
                ...(!terminal
                  ? [
                      {
                        value: 'result',
                        label: task.runnerType === 'http' ? t('响应') : t('结果'),
                        disabled: !finished,
                        id: `${id}-result-tab`,
                        panelId: `${id}-result`,
                      },
                    ]
                  : []),
              ]}
            />
          )}
          <div className="tool-run-output-tools">{detailsButton}</div>
        </div>
      )}
      <div
        className="tool-run-viewport"
        id={`${id}-log`}
        role={terminal ? undefined : 'tabpanel'}
        aria-labelledby={terminal ? undefined : `${id}-log-tab`}
        hidden={tab !== 'log'}
      >
        <LogViewer
          label={terminal ? t('运行内容') : t('运行记录')}
          size="fill"
          numbered={false}
          format={terminal ? 'terminal' : 'text'}
          onFollowChange={(following) => {
            if (!following) setSelection({ taskId: task.id, tab: 'log' })
          }}
          text={log}
          emptyLabel={finished ? t('没有运行内容。') : ''}
          overlayAction={copy(t('日志'), terminal ? terminalOutputText(log) : log, true)}
        />
      </div>
      {!terminal && (
        <div
          className="tool-run-viewport"
          id={`${id}-result`}
          role="tabpanel"
          aria-labelledby={`${id}-result-tab`}
          hidden={tab !== 'result'}
        >
          <div className="tool-run-result-panels">
            {httpStatus !== null && <p className="tool-help">HTTP {httpStatus}</p>}
            {resultPanels.map((panel) => (
              <div
                key={panel.key}
                className={
                  resultPanels.length > 1
                    ? 'tool-run-result-panel'
                    : 'tool-run-result-panel tool-run-result-panel--fill'
                }
              >
                {resultPanels.length > 1 && <FieldTitle label={panel.label} />}
                <LogViewer
                  label={panel.label}
                  variant="result"
                  size={resultPanels.length === 1 ? 'fill' : 'default'}
                  numbered={false}
                  autoScroll={false}
                  text={finished ? displayRunResult(panel.text) : ''}
                  emptyLabel={finished ? t('没有返回内容。') : t('等待结果…')}
                  overlayAction={copy(panel.label, finished ? panel.text : '', true)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {detail && (
        <Modal
          key={detail}
          returnFocus={detailOrigin.current}
          title={detail === 'inputs' ? t('运行详情') : t('原始数据')}
          onClose={() => setDetail(null)}
          actions={<Button onClick={() => setDetail(null)}>{t('完成')}</Button>}
        >
          {detail === 'inputs' ? (
            <div className="tool-run-pane">
              {parameters ?? (
                <p className="tool-help">{t('这条运行记录没有保留当时的输入，无法查看。')}</p>
              )}
              <Button variant="text" disabled={!response} onClick={() => setDetail('raw')}>
                {t('查看原始数据')}
              </Button>
            </div>
          ) : (
            <>
              {task.runnerType === 'http' && typeof result?.status === 'number' && (
                <p className="tool-help">HTTP {result.status}</p>
              )}
              <LogViewer
                text={response}
                variant="result"
                label={t('原始数据')}
                numbered={false}
                autoScroll={false}
                overlayAction={copy(t('原始结果'), response, true)}
              />
            </>
          )}
        </Modal>
      )}
      {task.truncated && <p className="tool-help">{t('输出已达到预览上限，后续内容被截断。')}</p>}
    </div>
  )
}

/** Host-only persisted input; the saved definition may since have changed. */
export function HistoricalTaskConfiguration({
  snapshot,
}: {
  snapshot: ToolTaskInputSnapshot | null
}) {
  useLocale()

  if (!snapshot)
    return <p className="tool-help">{t('这条旧运行记录没有保留当时的输入，无法查看。')}</p>
  const { definition, operation, arguments: args } = snapshot
  const fields = definition.tools.find((tool) => tool.name === operation)?.fields ?? []
  return (
    <>
      {definition.runner.settings.type === 'terminal' ? (
        <TerminalWorkingDirectory
          inputHint
          value={definition.runner.settings.cwd}
          change={() => {}}
          readOnly
        />
      ) : (
        <RunConfigurationFields
          settings={definition.runner.settings}
          disabled
          change={() => {}}
          operationName={operation}
        />
      )}
      <RunParameters
        fields={fields}
        label={t('运行时参数')}
        renderValue={(field, descriptionId, inputId) => {
          const value = field.aiVisible
            ? Object.hasOwn(args, field.key)
              ? args[field.key]
              : field.schema.default
            : field.value
          return (
            <Input
              id={inputId}
              aria-describedby={descriptionId}
              aria-label={t('{v0} 当时的输入', { v0: field.key })}
              readOnly
              type={field.aiVisible ? 'text' : 'password'}
              value={value === undefined ? '' : formatRunValue(field, value)}
            />
          )
        }}
      />
    </>
  )
}

export default function ToolRunPanel({
  definition: d,
  tasks,
  run,
  stop,
  busy,
  inspect,
  close,
  stale = false,
  runAvailable = true,
  windowed = false,
  onBusyChange,
  configurationCurrent = true,
  refreshConfiguration,
}: {
  windowed?: boolean
  onBusyChange?: (busy: boolean) => void
  configurationCurrent?: boolean
  refreshConfiguration?: () => void
  close?: () => void
  stale?: boolean
  runAvailable?: boolean
  inspect: (id: string | null) => void
  definition: CapabilityDefinition
  tasks: ToolTask[]
  run: (
    name: string,
    args: JsonObject,
    overrides?: ToolRunOverrides,
    expectedVersion?: number,
  ) => Promise<ToolTask | undefined>
  stop: (id: string) => void
  busy: boolean
}) {
  useLocale()

  const terminal = d.runner.type === 'terminal'
  const [operation, setOperation] = useState(() => initialRunOperation(d))
  const operations = availableRunOperations(d)
  const [settings, setSettings] = useState(() => structuredClone(d.runner.settings))
  const [inputs, setInputs] = useState<Record<string, RunValues>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showInspection, setShowInspection] = useState(false)
  const [inspectionDraft, setInspectionDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<{ key: string | null; message: string } | null>(null)
  const [preparing, setPreparing] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const preparationRevision = useRef(0)
  const [pickingDirectory, setPickingDirectory] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [submittedTask, setSubmittedTask] = useState<ToolTask | null>(null)
  const [preflight, setPreflight] = useState<ToolRunPreparation | null>(null)
  const [requiredInputs, setRequiredInputs] = useState<Record<string, string[]>>({})
  const [snapshot, setSnapshot] = useState<{
    operation: string
    effective: JsonObject
    values: RunValues
  } | null>(null)
  const fields = useRef(new Map<string, HTMLElement>())
  const operationInput = useRef<HTMLSelectElement>(null)
  const parameterForm = useRef<HTMLFormElement>(null)
  const developmentStart = useRef<HTMLButtonElement>(null)
  const focusParameters = useRef(false)
  const showToast = useToast()
  const formId = useId()
  const tool = d.tools.find((t) => t.name === operation)
  const values = inputs[operation] ?? {}
  const enabled =
    d.enabled && d.status === 'ready' && !d.archived && runAvailable && configurationCurrent
  const locked = busy || submitting || pickingDirectory
  useEffect(() => {
    onBusyChange?.(locked)
    return () => onBusyChange?.(false)
  }, [locked, onBusyChange])
  const task = tasks.find((t) => t.id === taskId) ?? submittedTask
  const stage = preparing || !task ? 0 : taskActive(task) ? 1 : 2
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const preset = window.__LUMI_DEV_UI_PRESET__
    if (
      !terminal ||
      !preset?.enabled ||
      preset.capabilityId !== d.id ||
      stage !== 0 ||
      !enabled ||
      locked ||
      preflight === null
    )
      return
    let cancelled = false
    void import('../lib/dev-ui')
      .then(async (development) => {
        if (!cancelled)
          await development.dispatchDevelopmentUiAction(preset, d.id, developmentStart.current)
      })
      .catch((error) => console.error('[lumi-development-ui]', error))
    return () => {
      cancelled = true
    }
  }, [d.id, terminal, stage, enabled, locked, preflight])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const preset = window.__LUMI_DEV_UI_PRESET__
    if (!terminal || !task || !preset?.enabled || preset.capabilityId !== d.id) return
    void import('../lib/dev-ui')
      .then((development) => development.observeDevelopmentUi(preset, task))
      .catch((error) => console.error('[lumi-development-ui]', error))
  }, [d.id, terminal, task?.id, task?.status, task?.stdout, task?.stderr, task?.result])
  const needed = (field: CapabilityField) => needsRunInput(field, requiredInputs[operation])
  const editable = tool?.fields ?? []
  function overridesFor(parsed: {
    ok: boolean
    fixedParameters?: JsonObject
  }): ToolRunOverrides | undefined {
    const fixedParameters = parsed.ok ? (parsed.fixedParameters ?? {}) : {}
    if (
      JSON.stringify(settings) === JSON.stringify(d.runner.settings) &&
      !Object.keys(fixedParameters).length
    )
      return undefined
    return { settings, fixedParameters }
  }
  useEffect(() => {
    inspect(taskId)
    return () => inspect(null)
  }, [taskId, inspect])
  useEffect(() => {
    if (!preparing || locked || (!error && !focusParameters.current)) return
    const frame = requestAnimationFrame(() => {
      if (error?.key && fields.current.has(error.key)) fields.current.get(error.key)?.focus()
      else if (!tool) operationInput.current?.focus()
      else
        (
          parameterForm.current?.querySelector<HTMLElement>('[aria-invalid="true"], :invalid') ??
          (fields.current.values().next().value as HTMLElement | undefined) ??
          parameterForm.current
        )?.focus()
      focusParameters.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [error, preparing, tool, locked])
  useEffect(() => {
    let cancelled = false
    const revision = ++preparationRevision.current
    setPreflight(null)
    if (!tool || !preparing) return
    const parsed = prepareManualInputs(tool, values)
    void toolsRequest<ToolRunPreparation>('prepare', {
      name: `${d.namespace}.${tool.name}`,
      arguments: parsed.ok ? parsed.args : {},
      expectedVersion: d.version,
      overrides: overridesFor(parsed),
    })
      .then((result) => {
        if (!cancelled && revision === preparationRevision.current) {
          setRequiredInputs((current) => ({ ...current, [operation]: result.requiredInputs }))
          setPreflight(parsed.ok ? result : { ...parsed, requiredInputs: result.requiredInputs })
        }
      })
      .catch((error) => {
        if (!cancelled && revision === preparationRevision.current)
          setPreflight({
            ok: false,
            key: null,
            message: toolErrorMessage(error),
            requiredInputs: tool.fields.filter((f) => f.aiVisible && f.required).map((f) => f.key),
          })
      })
    return () => {
      cancelled = true
    }
  }, [d, tool, operation, inputs, settings, preparing])
  function changeOperation(value: string) {
    if (locked || !preparing || (value && !operations.some((tool) => tool.name === value))) return
    preparationRevision.current++
    setOperation(value)
    setInputs({})
    setRequiredInputs({})
    setPreflight(null)
    setError(null)
    setInspectionDraft({})
    fields.current.clear()
    focusParameters.current = false
  }
  function change(field: CapabilityField, value: string) {
    setInputs((current) => ({
      ...current,
      [operation]: { ...current[operation], [field.key]: value },
    }))
    setError(null)
  }
  function reset(field: CapabilityField) {
    const next = { ...values }
    delete next[field.key]
    setInputs((current) => ({ ...current, [operation]: next }))
    setError(null)
  }
  async function validateInputs() {
    const invalid = parameterForm.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], :invalid',
    )
    if (invalid) {
      const key =
        invalid.getAttribute('name') ??
        [...fields.current].find(([, element]) => element === invalid)?.[0] ??
        null
      setError({ key, message: t('请修正配置中标记的字段。') })
      if (invalid.closest('[data-run-pane]')?.getAttribute('data-run-pane') === 'request')
        setShowAdvanced(true)
      invalid.focus()
      showToast(t('请修正配置中标记的字段。'), 'error')
      return null
    }
    if (!tool) {
      setError({ key: null, message: t('请先选择本次运行的工具。') })
      showToast(t('请先选择本次运行的工具。'), 'error')
      return null
    }
    const parsed = prepareManualInputs(tool, values)
    const prepared = parsed.ok
      ? await toolsRequest<ToolRunPreparation>('prepare', {
          name: `${d.namespace}.${tool.name}`,
          arguments: parsed.args,
          expectedVersion: d.version,
          overrides: overridesFor(parsed),
        })
      : parsed
    if (!prepared.ok) {
      if (d.runner.type === 'mcp' && prepared.key && !prepared.key.startsWith('runner.'))
        prepared.message = t('本次工具缺少有效的预设参数，请在工具详情中补齐配置后再运行。')
      setError({ ...prepared, message: translateKnown(prepared.message) })
      if (!terminal && prepared.key?.startsWith('runner.')) setShowAdvanced(true)
      showToast(translateKnown(prepared.message), 'error')
      return null
    }
    setError(null)
    return {
      args: parsed.ok ? parsed.args : {},
      effective: prepared.effective,
      overrides: overridesFor(parsed),
    }
  }
  async function submit() {
    if (submittingRef.current || locked || !enabled || !tool) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const prepared = await validateInputs()
      if (!prepared || !tool) return
      const next = await run(
        `${d.namespace}.${tool.name}`,
        prepared.args,
        prepared.overrides,
        d.version,
      )
      if (next) {
        setSnapshot({ operation, effective: prepared.effective, values: { ...values } })
        setSubmittedTask(next)
        setTaskId(next.id)
        setPreparing(false)
      }
    } catch (error) {
      showToast(toolErrorMessage(error), 'error')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  function rerun() {
    if (locked) return
    setPreparing(true)
    setTaskId(null)
    setSubmittedTask(null)
    setSnapshot(null)
    setPreflight(null)
    setError(null)
    setShowAdvanced(false)
    focusParameters.current = true
  }
  function renderControl(field: CapabilityField, descriptionId?: string, inputId?: string) {
    const selected = error?.key === field.key
    const props = {
      id: inputId,
      name: field.key,
      'aria-label': t('{v0} 参数值', { v0: field.key }),
      'aria-invalid': selected || undefined,
      'aria-describedby': descriptionId,
      value: runFieldValue(field, values),
      disabled: locked,
      ref: (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => {
        if (element) fields.current.set(field.key, element)
        else fields.current.delete(field.key)
      },
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
      ) => {
        if (event.target instanceof HTMLSelectElement && !event.target.value) reset(field)
        else change(field, event.target.value)
      },
    }
    return !terminal &&
      field.aiVisible &&
      (field.schema.type === 'boolean' || field.schema.enum) ? (
      <Select
        {...props}
        value={
          field.schema.type === 'string' &&
          (Object.hasOwn(values, field.key) ||
            field.schema.default !== undefined ||
            (!field.aiVisible && field.value !== null))
            ? JSON.stringify(props.value)
            : props.value
        }
        onChange={(event) => {
          if (!event.target.value) reset(field)
          else change(field, formatRunValue(field, JSON.parse(event.target.value)))
        }}
      >
        <option value="">{t('未设置')}</option>
        {(field.schema.enum ?? [true, false]).map((value) => (
          <option key={JSON.stringify(value)} value={JSON.stringify(value)}>
            {value === ''
              ? t('留空')
              : value === true
                ? t('是')
                : value === false
                  ? t('否')
                  : String(value)}
          </option>
        ))}
      </Select>
    ) : !multilineRunField(field) ? (
      <Input
        {...props}
        type={field.aiVisible ? 'text' : 'password'}
        placeholder={terminal && field.schema.type === 'boolean' ? 'true / false' : undefined}
        inputMode={
          field.schema.type === 'integer'
            ? 'numeric'
            : field.schema.type === 'number'
              ? 'decimal'
              : undefined
        }
      />
    ) : (
      <Textarea
        {...props}
        rows={terminal ? 3 : 5}
        spellCheck={false}
        className="tool-code"
        placeholder={field.schema.type === 'string' ? undefined : t('JSON 格式')}
      />
    )
  }
  function renderPreset(field: CapabilityField, descriptionId?: string, inputId?: string) {
    const props = {
      id: inputId,
      'aria-label': t('{v0} 参数值', { v0: field.key }),
      'aria-describedby': descriptionId,
      'aria-invalid': error?.key === field.key || undefined,
      readOnly: true,
      value:
        snapshot?.effective && Object.hasOwn(snapshot.effective, field.key)
          ? formatRunValue(field, snapshot.effective[field.key]!)
          : runFieldValue(field, snapshot?.values ?? values),
      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (element) fields.current.set(field.key, element)
        else fields.current.delete(field.key)
      },
    }
    return multilineRunField(field) ? (
      <Textarea {...props} rows={3} spellCheck={false} />
    ) : (
      <Input {...props} type={field.aiVisible ? 'text' : 'password'} />
    )
  }

  const status = !runAvailable
    ? t('服务未连接')
    : !configurationCurrent
      ? t('工具配置已变化，请载入最新配置')
      : !enabled
        ? t('请先审阅并启用工具')
        : !tool
          ? t('请选择要运行的工具')
          : ''
  const notice =
    stage === 0
      ? status
      : stale
        ? t('状态更新中断，正在重新连接')
        : task?.cancellationUncertain
          ? t('远端执行结果未知')
          : ''
  const actions = (
    <>
      {notice && (
        <span className="tool-run-footer-status tool-help" role="status">
          {notice}
        </span>
      )}
      {!configurationCurrent && refreshConfiguration && (!task || !taskActive(task)) && (
        <Button variant="secondary" disabled={locked} onClick={refreshConfiguration}>
          {t('载入最新配置')}
        </Button>
      )}
      {stage === 0 && close && (
        <Button variant="secondary" disabled={locked} onClick={close}>
          {t('取消')}
        </Button>
      )}
      {stage === 0 ? (
        <Button
          key="start"
          ref={developmentStart}
          variant="primary"
          loading={submitting || (enabled && !!tool && preflight === null)}
          loadingLabel={submitting ? t('提交中…') : t('检查中…')}
          disabled={!enabled || locked || !tool || preflight === null}
          onClick={() => void submit()}
        >
          {t('开始运行')}
        </Button>
      ) : task && taskActive(task) ? (
        <Button
          variant="danger"
          disabled={locked || !runAvailable || task.status === 'stopping'}
          onClick={(event) => {
            if (event.detail < 2) stop(task.id)
          }}
        >
          {task.status === 'stopping' ? t('正在停止…') : t('停止运行')}
        </Button>
      ) : (
        task && (
          <Button variant="primary" disabled={locked} onClick={rerun}>
            {t('调整后再运行')}
          </Button>
        )
      )}
    </>
  )
  const inspected = runConfigurationPreview(
    d,
    settings,
    preparing ? operation : (snapshot?.operation ?? operation),
    preparing ? values : (snapshot?.values ?? values),
    preparing ? (preflight?.ok ? preflight.effective : undefined) : snapshot?.effective,
    !preparing,
  )
  const inspection = (
    <Field label={preparing ? t('当前工具配置（只读）') : t('本次运行参数与配置（只读）')}>
      <Textarea
        readOnly
        spellCheck={false}
        className="tool-code"
        rows={18}
        value={JSON.stringify(
          {
            [t('本次工具')]: inspected.本次工具,
            [t('本次运行参数')]: inspected.本次运行参数,
            [t('完整工具配置')]: inspected.完整工具配置,
            ...(preparing && Object.keys(inspectionDraft).length
              ? { [t('未完成的编辑')]: inspectionDraft }
              : {}),
          },
          null,
          2,
        )}
      />
    </Field>
  )
  function openTechnicalInfo() {
    const raw: Record<string, string> = {}
    for (const control of parameterForm.current?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >('[aria-invalid="true"]') ?? [])
      raw[control.labels?.[0]?.textContent ?? control.getAttribute('aria-label') ?? t('内容')] =
        control.value
    setInspectionDraft(raw)
    setShowInspection(true)
  }
  const technicalAction = (
    <Button variant="text" disabled={locked} onClick={openTechnicalInfo}>
      {t('查看技术信息')}
    </Button>
  )
  const configurationForm = (
    <div className="tool-run-preparation">
      <form
        ref={parameterForm}
        id={formId}
        tabIndex={-1}
        aria-label={t('填写内容')}
        className="tool-run-parameter-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="tool-run-pane" data-run-pane="parameters">
          {!terminal && d.runner.type !== 'mcp' && d.tools.length > 1 && (
            <Field
              label={t('选择工具')}
              inline
              error={error?.key === null ? error.message : undefined}
            >
              <Select
                ref={operationInput}
                value={operation}
                disabled={locked}
                onChange={(event) => changeOperation(event.target.value)}
              >
                <option value="">{t('请选择工具')}</option>
                {d.tools.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.upstreamName ?? item.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!terminal && (
            <RunConfigurationFields
              section="connection"
              settings={settings}
              disabled={locked}
              operationName={tool?.upstreamName ?? tool?.name}
              operations={operations}
              operation={operation}
              onOperationChange={d.runner.type === 'mcp' ? changeOperation : undefined}
              operationRef={operationInput}
              change={() => {}}
            />
          )}
          {terminal && settings.type === 'terminal' ? (
            <>
              <TerminalWorkingDirectory
                inputHint
                value={settings.cwd}
                change={(cwd) => {
                  setSettings({ ...settings, cwd })
                  setError(null)
                }}
                disabled={locked}
                error={error?.key === 'runner.cwd' ? error.message : undefined}
                inputRef={(element) => {
                  if (element) fields.current.set('runner.cwd', element)
                  else fields.current.delete('runner.cwd')
                }}
                onPickingChange={setPickingDirectory}
              />
              <RunParameters
                fields={editable}
                needsInput={needed}
                action={technicalAction}
                renderValue={renderControl}
                renderAction={(field) =>
                  Object.hasOwn(values, field.key) &&
                  !needed(field) && (
                    <Button variant="text" disabled={locked} onClick={() => reset(field)}>
                      {!field.aiVisible
                        ? t('恢复固定值')
                        : field.schema.default !== undefined
                          ? t('恢复默认值')
                          : t('不提供此参数')}
                    </Button>
                  )
                }
                error={error}
              />
            </>
          ) : tool ? (
            <RunParameters
              key={operation}
              fields={editable}
              label={d.runner.type === 'mcp' ? t('MCP 预设参数（只读）') : t('请求参数')}
              needsInput={needed}
              error={error}
              action={technicalAction}
              renderValue={d.runner.type === 'mcp' ? renderPreset : renderControl}
              renderAction={
                d.runner.type === 'mcp'
                  ? undefined
                  : (field) =>
                      Object.hasOwn(values, field.key) &&
                      !needed(field) && (
                        <Button variant="text" disabled={locked} onClick={() => reset(field)}>
                          {!field.aiVisible
                            ? t('恢复固定值')
                            : field.schema.default !== undefined
                              ? t('恢复默认值')
                              : t('不提供此参数')}
                        </Button>
                      )
              }
            />
          ) : null}
        </div>
        {!terminal && (
          <>
            <div className="tool-run-secondary">
              <Button
                variant="text"
                disabled={locked}
                aria-expanded={showAdvanced}
                aria-controls={formId + '-advanced'}
                icon={showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? t('收起更多设置') : t('更多设置')}
              </Button>
            </div>
            <div
              className="tool-run-pane"
              data-run-pane="request"
              id={formId + '-advanced'}
              hidden={!showAdvanced}
            >
              <RunConfigurationFields
                section="values"
                settings={settings}
                change={(next) => {
                  setSettings(next)
                  setError(null)
                }}
                disabled={locked}
                operationName={tool?.upstreamName ?? tool?.name}
              />
              <div className="tool-run-secondary">{technicalAction}</div>
            </div>
          </>
        )}
      </form>
    </div>
  )
  const frozenConfiguration = (
    <div className="tool-run-pane">
      {terminal && settings.type === 'terminal' ? (
        <TerminalWorkingDirectory inputHint value={settings.cwd} change={() => {}} readOnly />
      ) : (
        <RunConfigurationFields
          settings={settings}
          section="connection"
          operationName={tool?.upstreamName ?? tool?.name}
          disabled
          change={() => {}}
        />
      )}
      <RunParameters
        fields={tool?.fields ?? []}
        label={
          terminal
            ? t('外部参数')
            : d.runner.type === 'mcp'
              ? t('MCP 预设参数（只读）')
              : t('本次请求参数')
        }
        action={technicalAction}
        renderValue={renderPreset}
      />
    </div>
  )

  const content = (
    <ToolRunStages
      preparing={preparing}
      task={task}
      configuration={preparing ? configurationForm : frozenConfiguration}
    >
      {task && <RunProcess key={task.id} task={task} parameters={frozenConfiguration} />}
    </ToolRunStages>
  )
  const heading = <ToolRunHeader title={d.name} />
  return (
    <>
      {showInspection && (
        <Modal
          title={t('技术信息')}
          onClose={() => setShowInspection(false)}
          actions={<Button onClick={() => setShowInspection(false)}>{t('完成')}</Button>}
        >
          {inspection}
        </Modal>
      )}
      {windowed ? (
        <WindowPanel
          title={d.name}
          className="tools-page tool-run-window"
          bodyLayout={preparing ? 'scroll' : 'fill'}
          nativeTitlebar={typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)}
          header={heading}
          actions={actions}
        >
          {content}
        </WindowPanel>
      ) : close ? (
        <Modal
          title={d.name}
          onClose={close}
          busy={locked}
          className={`tools-page tool-run-dialog tool-run-dialog--focused${preparing ? '' : ' tool-run-dialog--output'}`}
          actions={actions}
          header={({ titleId }) => <ToolRunHeader title={d.name} titleId={titleId} />}
        >
          {content}
        </Modal>
      ) : (
        <>
          {content}
          <div className="tool-actions">{actions}</div>
        </>
      )}
    </>
  )
}
