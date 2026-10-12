// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { CapabilityDefinition, JsonObject, ToolRunOverrides, ToolTask } from '@lumiplug/shared'
import { Button, Modal, SurfaceEffects, WindowPanel } from './ui'
import ToolRunPanel, { RunProcess, ToolRunHeader, ToolRunStages } from './ToolRunPanel'
import { useToast } from './ToastProvider'
import { getCoreStatus } from '../lib/tauri'
import { toolsRequest, toolErrorMessage } from '../lib/tools'
import { activeTask, closeToolRunWindow, type RunWindowRoute } from '../lib/tool-run-window'
import { useTheme } from '../lib/useTheme'
import { completeTaskSnapshot, refreshRunState } from '../lib/run-task-refresh'
import './tools.css'

export default function ToolRunWindow({ route }: { route: RunWindowRoute }) {
  useTheme()
  const toast = useToast()
  const [definition, setDefinition] = useState<CapabilityDefinition | null>(null)
  const [latest, setLatest] = useState<CapabilityDefinition | null>(null)
  const [tasks, setTasks] = useState<ToolTask[]>([])
  const [viewId, setViewId] = useState<string | null>(route.taskId)
  const [taskView, setTaskView] = useState(!!route.taskId)
  const [ready, setReady] = useState(false)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [panelBusy, setPanelBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loadRevision, setLoadRevision] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [closePrompt, setClosePrompt] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)
  const [pendingClose, setPendingClose] = useState(false)
  const initialised = useRef(false)
  const viewRef = useRef(viewId)
  const busyRef = useRef(false)
  const checkingClose = useRef(false)
  const requestCloseRef = useRef<() => void>(() => {})
  const task = tasks.find((item) => item.id === viewId)
  const replayAvailable =
    !!task?.canRestart &&
    !!latest?.enabled &&
    !latest.archived &&
    latest.version === task?.version &&
    !task?.cancellationUncertain
  const nativeTitlebar = /Mac/.test(navigator.userAgent)
  const inspect = useCallback((id: string | null) => {
    viewRef.current = id
    setViewId(id)
  }, [])
  busyRef.current = busy || panelBusy || closeBusy

  useEffect(() => {
    return refreshRunState({
      interval: 500,
      wakeTarget: window,
      read: async () => {
        const status = await getCoreStatus()
        if (status.state !== 'ready') return { status, snapshot: null }
        const [current, metadata] = await Promise.all([
          toolsRequest<CapabilityDefinition>('get', { id: route.capabilityId }),
          toolsRequest<ToolTask[]>('tasks', { id: route.capabilityId }),
        ])
        const id = viewRef.current ?? (!initialised.current ? metadata.find(activeTask)?.id : null)
        const full = id ? await toolsRequest<ToolTask>('task', { id }) : null
        return {
          status,
          snapshot: {
            current,
            tasks: completeTaskSnapshot(metadata, full, route.capabilityId),
            id,
          },
        }
      },
      update: ({ status, snapshot }) => {
        setReady(status.state === 'ready')
        if (!snapshot) {
          setStale(true)
          return
        }
        setLatest(snapshot.current)
        if (!initialised.current) {
          if (snapshot.id) {
            inspect(snapshot.id)
            setTaskView(true)
          }
          setDefinition(snapshot.current)
          initialised.current = true
        }
        setTasks(snapshot.tasks)
        setStale(false)
        setLoadFailed(false)
      },
      fail: () => {
        setStale(true)
        setLoadFailed(true)
      },
    })
  }, [route.capabilityId, route.taskId, viewId, loadRevision, inspect])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void getCurrentWindow()
      .listen('run-window-close-requested', () => requestCloseRef.current())
      .then((dispose) => {
        if (cancelled) dispose()
        else unlisten = dispose
      })
      .catch(() => toast('无法接收窗口关闭请求，请使用窗口内的关闭按钮。', 'error'))
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [toast])

  async function requestClose() {
    if (checkingClose.current || closePrompt || closeBusy) return
    if (busyRef.current) {
      setPendingClose(true)
      return
    }
    setPendingClose(false)
    checkingClose.current = true
    try {
      const id = viewRef.current
      const current = id ? await toolsRequest<ToolTask>('task', { id }) : null
      if (activeTask(current)) setClosePrompt(true)
      else await closeToolRunWindow('idle')
    } catch (error) {
      toast(toolErrorMessage(error), 'error')
      if (viewRef.current) setClosePrompt(true)
    } finally {
      checkingClose.current = false
    }
  }
  requestCloseRef.current = () => void requestClose()
  useEffect(() => {
    if (pendingClose && !busy && !panelBusy && !closeBusy) requestCloseRef.current()
  }, [pendingClose, busy, panelBusy, closeBusy])

  async function closeWith(mode: 'background' | 'ended') {
    if (closeBusy) return
    setCloseBusy(true)
    try {
      if (mode === 'ended' && viewRef.current) {
        let current = await toolsRequest<ToolTask>('stop', { id: viewRef.current })
        setTasks((previous) => [current, ...previous.filter((item) => item.id !== current.id)])
        while (activeTask(current)) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          current = await toolsRequest<ToolTask>('task', { id: current.id })
          setTasks((previous) => [current, ...previous.filter((item) => item.id !== current.id)])
        }
      }
      await closeToolRunWindow(mode)
    } catch (error) {
      toast(toolErrorMessage(error), 'error')
    } finally {
      setCloseBusy(false)
    }
  }
  async function run(
    name: string,
    args: JsonObject,
    overrides?: ToolRunOverrides,
    expectedVersion?: number,
  ) {
    if (busyRef.current && busy) return
    setBusy(true)
    try {
      const next = await toolsRequest<ToolTask>('run', {
        name,
        arguments: args,
        overrides,
        expectedVersion,
      })
      inspect(next.id)
      setTasks((previous) => [next, ...previous.filter((item) => item.id !== next.id)])
      toast('任务已提交', 'success')
      return next
    } catch (error) {
      toast(toolErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }
  async function taskAction(kind: 'stop' | 'restart', id: string) {
    if (busyRef.current) return
    setBusy(true)
    try {
      const next = await toolsRequest<ToolTask>(kind, { id })
      inspect(next.id)
      setTasks((previous) => [next, ...previous.filter((item) => item.id !== next.id)])
      toast(kind === 'stop' ? '已请求停止任务' : '已提交新的运行任务', 'success')
    } catch (error) {
      toast(toolErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }
  async function prepareFresh() {
    if (busyRef.current) return
    setBusy(true)
    try {
      const current = await toolsRequest<CapabilityDefinition>('get', { id: route.capabilityId })
      setDefinition(current)
      setLatest(current)
      setTaskView(false)
      inspect(null)
      setRevision((value) => value + 1)
    } catch (error) {
      toast(toolErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }
  const header = (
    <ToolRunHeader
      title={definition?.name ?? '工具运行'}
      status={definition ? undefined : '正在连接'}
    />
  )
  return (
    <SurfaceEffects depth="heavy">
      {!definition ? (
        <WindowPanel
          title="工具运行"
          nativeTitlebar={nativeTitlebar}
          header={header}
          actions={
            <>
              <Button disabled={busy} onClick={() => setLoadRevision((value) => value + 1)}>
                重新连接
              </Button>
              <Button onClick={() => void requestClose()}>关闭</Button>
            </>
          }
        >
          <p role="status">
            {loadFailed ? '无法读取工具，请检查服务连接后重试。' : '正在连接服务并读取工具…'}
          </p>
        </WindowPanel>
      ) : taskView ? (
        <WindowPanel
          title={definition.name}
          nativeTitlebar={nativeTitlebar}
          bodyLayout="fill"
          className="tools-page tool-run-window"
          header={header}
          actions={
            <>
              {stale && (
                <span className="tool-run-footer-status tool-help" role="status">
                  状态更新中断，正在重新连接
                </span>
              )}
              {task && activeTask(task) ? (
                <Button
                  variant="danger"
                  disabled={busy || !ready || task.status === 'stopping'}
                  onClick={() => void taskAction('stop', task.id)}
                >
                  {task.status === 'stopping' ? '正在停止…' : '停止运行'}
                </Button>
              ) : (
                task &&
                replayAvailable && (
                  <Button
                    variant="primary"
                    disabled={
                      busy ||
                      !ready ||
                      !task.canRestart ||
                      !latest?.enabled ||
                      latest.archived ||
                      latest.version !== task.version ||
                      task.cancellationUncertain
                    }
                    onClick={() => void taskAction('restart', task.id)}
                  >
                    再运行一次
                  </Button>
                )
              )}
              <Button
                variant={replayAvailable ? 'secondary' : 'primary'}
                disabled={
                  busy || activeTask(task) || !ready || !latest?.enabled || !!latest?.archived
                }
                onClick={() => void prepareFresh()}
              >
                调整后再运行
              </Button>
            </>
          }
        >
          {task ? (
            <ToolRunStages
              task={task}
              configuration={
                <p className="tool-help">这条运行记录没有保留当时的输入，无法查看。</p>
              }
            >
              <RunProcess key={task.id} task={task} />
            </ToolRunStages>
          ) : (
            <p role="status">正在读取任务…</p>
          )}
        </WindowPanel>
      ) : (
        <ToolRunPanel
          key={revision}
          definition={definition}
          tasks={tasks}
          inspect={inspect}
          windowed
          close={() => void requestClose()}
          run={run}
          stop={(id) => void taskAction('stop', id)}
          busy={busy}
          onBusyChange={setPanelBusy}
          stale={stale}
          runAvailable={ready}
          configurationCurrent={
            latest?.version === definition.version &&
            latest.enabled === definition.enabled &&
            latest.archived === definition.archived
          }
          refreshConfiguration={() => void prepareFresh()}
        />
      )}
      {closePrompt && (
        <Modal
          title="关闭运行窗口？"
          busy={closeBusy}
          onClose={() => setClosePrompt(false)}
          actions={
            <>
              <Button
                variant="secondary"
                disabled={closeBusy}
                onClick={() => setClosePrompt(false)}
              >
                继续查看
              </Button>
              <Button
                variant="secondary"
                disabled={closeBusy}
                onClick={() => void closeWith('background')}
              >
                后台运行
              </Button>
              <Button
                variant="danger"
                loading={closeBusy}
                loadingLabel="正在结束…"
                disabled={!ready}
                onClick={() => void closeWith('ended')}
              >
                结束运行
              </Button>
            </>
          }
        >
          <p>
            任务仍在运行。结束运行会停止任务；后台运行会关闭窗口并保留任务，可从运行记录重新查看。
          </p>
        </Modal>
      )}
    </SurfaceEffects>
  )
}
