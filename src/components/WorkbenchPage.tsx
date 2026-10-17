// SPDX-License-Identifier: MPL-2.0
import { useRetainWindowState } from '../lib/window-retention'
import { Textarea, Button, ChoiceCard } from './ui'

import { useEffect, useReducer, useRef, useState } from 'react'
import type { McpConnectionInfo, UiCoreStatus } from '@lumiplug/shared'
import { WORKBENCH_PRESETS } from '@lumiplug/shared'
import type { WorkbenchPresetId } from '@lumiplug/shared'
import { copyText } from '../lib/clipboard'
import { buildWorkbenchPrompt } from '../lib/mcp'
import { applyWorkbenchTemplate, checkMcpConnection } from '../lib/tauri'
import { useWorkbenchDocument } from '../lib/useWorkbenchDocument'
import WorkbenchContent from './WorkbenchContent'
import LumiLoading from './LumiLoading'
import {
  isSameReadySession,
  readSavedWorkbenchSetup,
  saveWorkbenchPreferences,
  workbenchSetupReducer,
  workbenchStep,
  workbenchStorageKey,
  workbenchTemplateEvent,
  workbenchTemplates,
} from '../lib/workbench'
import type { WorkbenchTemplate } from '../lib/workbench'
import { useToast } from './ToastProvider'
import './workbench.css'

export default function WorkbenchPage({
  connection = null,
  coreStatus,
  coreStatusLoaded,
  openSettings,
  active = true,
}: {
  connection?: McpConnectionInfo | null
  coreStatus: UiCoreStatus
  coreStatusLoaded: boolean
  openSettings: () => void
  active?: boolean
}) {
  const [setup, dispatch] = useReducer(workbenchSetupReducer, null, readSavedWorkbenchSetup)
  const step = workbenchStep(setup, connection)
  const selected = setup.selected
  const [copying, setCopying] = useState(false)
  const [copyFallback, setCopyFallback] = useState<{ epoch: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [preset, setPreset] = useState<WorkbenchPresetId>('office')
  const [applying, setApplying] = useState(false)
  const showToast = useToast()
  const { view, loadError, ready, refresh, accept } = useWorkbenchDocument(connection, active)

  useRetainWindowState(!!view?.manifest || copying || checking || applying || !!copyFallback)
  const promptField = useRef<HTMLTextAreaElement>(null)
  const promptDetails = useRef<HTMLDetailsElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const homeHeading = useRef<HTMLHeadingElement>(null)
  const showingHome = Boolean(view?.manifest)
  const previousView = useRef({ step, active, showingHome })
  const currentActive = useRef(active)
  const currentConnection = useRef(connection)
  const operationEpoch = useRef(0)
  const inFlight = useRef(false)
  currentConnection.current = connection
  currentActive.current = active
  const prompt =
    step === 'connection'
      ? buildWorkbenchPrompt('connection', connection)
      : step === 'templates' && selected
        ? buildWorkbenchPrompt(selected, null)
        : ''

  useEffect(() => {
    function syncTemplate(event: Event) {
      const template: unknown = (event as CustomEvent).detail
      if (template === 'assistant' || template === 'features')
        dispatch({ type: 'select', template })
    }
    window.addEventListener(workbenchTemplateEvent, syncTemplate)
    return () => window.removeEventListener(workbenchTemplateEvent, syncTemplate)
  }, [])

  useEffect(() => {
    if (
      active &&
      (!previousView.current.active ||
        previousView.current.step !== step ||
        previousView.current.showingHome !== showingHome)
    ) {
      const target = showingHome ? homeHeading.current : heading.current
      target?.focus({ preventScroll: true })
      target?.closest('.workspace-content')?.scrollTo({ top: 0 })
    }
    previousView.current = { step, active, showingHome }
  }, [step, active, showingHome])

  useEffect(() => {
    if (copyFallback?.epoch === operationEpoch.current && active) {
      if (promptDetails.current) promptDetails.current.open = true
      promptField.current?.focus()
      promptField.current?.select()
    }
  }, [copyFallback, active, selected, step])

  useEffect(() => {
    try {
      localStorage.setItem(workbenchStorageKey, saveWorkbenchPreferences(setup))
    } catch {
      // Configuration remains usable when storage is unavailable.
    }
  }, [setup.deferred, setup.selected])

  useEffect(() => {
    operationEpoch.current += 1
    if (inFlight.current || copying || setup.verifiedConnection) {
      showToast('Lumi 会话已变化，请重新复制连接提示并连接后重试。')
    }
    inFlight.current = false
    setChecking(false)
    setApplying(false)
    setCopying(false)
    setCopyFallback(null)
    dispatch({ type: 'invalidate' })
    // Session identity and service readiness invalidate both checks and verification.
    // The verified snapshot itself is intentionally not an effect dependency.
  }, [
    connection?.endpoint,
    connection?.authHeader,
    connection?.sessionToken,
    connection?.coreState,
    showToast,
  ])

  useEffect(
    () => () => {
      operationEpoch.current += 1
    },
    [],
  )

  async function handleStart() {
    if (inFlight.current || connection?.coreState !== 'ready') return
    const epoch = operationEpoch.current
    inFlight.current = true
    setChecking(true)
    try {
      const result = await checkMcpConnection()
      if (epoch !== operationEpoch.current) return
      if (!isSameReadySession(connection, currentConnection.current)) {
        showToast('Lumi 会话已变化，请重新复制连接提示并连接后重试。')
      } else if (!result.ok) {
        showToast(result.error ?? '连接检查失败，请重试。', 'error')
      } else if (!result.lastExternalActivityAt) {
        showToast(
          '尚未检测到 AI 软件访问 Lumi。请完成连接，并让 AI 读取 Lumi 工具列表后重试。',
          'error',
        )
      } else {
        dispatch({ type: 'verified', connection })
        showToast('连接检查通过，可以开始构建工作台。', 'success')
      }
    } catch {
      if (epoch === operationEpoch.current) {
        showToast('无法检查连接，请确认 Lumi 本地服务已启动后重试。', 'error')
      }
    } finally {
      if (epoch === operationEpoch.current) {
        inFlight.current = false
        setChecking(false)
      }
    }
  }

  async function handleCopy(template?: WorkbenchTemplate) {
    const copyPrompt = template ? buildWorkbenchPrompt(template, null) : prompt
    if (inFlight.current || copying || checking || !copyPrompt.trim()) return
    const epoch = operationEpoch.current
    inFlight.current = true
    setCopying(true)
    setCopyFallback(null)
    if (template) {
      if (promptDetails.current) promptDetails.current.open = false
      dispatch({ type: 'select', template })
    }
    try {
      const copied = await copyText(copyPrompt.trim())
      if (epoch !== operationEpoch.current) return
      showToast(
        copied
          ? step === 'connection'
            ? '已复制，发送给你的 AI 完成连接。'
            : '已复制，发送给你的 AI 开始设计。'
          : '未能自动复制，请选中提示词手动复制。',
        copied ? 'success' : 'error',
      )
      if (!copied && currentActive.current) {
        setCopyFallback({ epoch })
      }
    } catch {
      if (epoch === operationEpoch.current) {
        showToast('未能自动复制，请选中提示词手动复制。', 'error')
        if (currentActive.current) {
          setCopyFallback({ epoch })
        }
      }
    } finally {
      if (epoch === operationEpoch.current) {
        inFlight.current = false
        setCopying(false)
      }
    }
  }

  function finishSetup() {
    dispatch({ type: 'complete' })
    showToast('引导已完成，可随时重新配置工作台。', 'success')
  }

  async function handleApply() {
    if (
      inFlight.current ||
      !ready ||
      !view ||
      view.manifest ||
      step !== 'templates' ||
      !isSameReadySession(setup.verifiedConnection, currentConnection.current)
    )
      return
    const epoch = operationEpoch.current
    inFlight.current = true
    setApplying(true)
    try {
      const next = await applyWorkbenchTemplate(preset, view.version)
      if (epoch !== operationEpoch.current) return
      accept(next)
      dispatch({ type: 'complete' })
      showToast('模板已应用，可添加待办并配置常用工作流。', 'success')
    } catch {
      if (epoch !== operationEpoch.current) return
      showToast('模板未能应用，主页可能已更新。请刷新后重试。', 'error')
      void refresh()
    } finally {
      if (epoch === operationEpoch.current) {
        inFlight.current = false
        setApplying(false)
      }
    }
  }

  const promptArea = (
    <Textarea
      id="workbench-system-prompt"
      name="workbench-prompt"
      ref={promptField}
      aria-label={step === 'connection' ? '连接操作提示' : '工作台构建提示词'}
      aria-describedby={
        step === 'connection' && connection?.coreState !== 'ready'
          ? 'workbench-availability-note'
          : undefined
      }
      value={prompt}
      readOnly
      rows={10}
      spellCheck={false}
      autoComplete="off"
      translate="no"
    />
  )
  const coreStarting =
    !coreStatusLoaded ||
    coreStatus.state === 'starting' ||
    coreStatus.state === 'restarting' ||
    (coreStatus.state === 'ready' &&
      (connection?.coreState === 'starting' || connection?.coreState === 'restarting'))

  if (
    !view &&
    (coreStarting ||
      (!loadError && coreStatus.state === 'ready' && connection?.coreState === 'ready'))
  ) {
    return (
      <section
        className="workbench-home workbench-initial-loading"
        hidden={!active}
        aria-busy="true"
      >
        <LumiLoading />
      </section>
    )
  }

  if (view?.manifest) {
    return (
      <WorkbenchContent
        headingRef={homeHeading}
        view={view}
        active={active}
        ready={ready}
        loadError={loadError}
        onRetry={() => {
          void refresh().then((ok) =>
            showToast(
              ok ? '主页已刷新。' : '无法读取主页，请确认服务后重试。',
              ok ? 'success' : 'error',
            ),
          )
        }}
      />
    )
  }

  if (!coreStarting && (coreStatus.state !== 'ready' || connection?.coreState !== 'ready')) {
    const title =
      coreStatus.state === 'error'
        ? 'Lumi 服务启动失败'
        : coreStatus.state === 'ready'
          ? '连接配置暂不可用'
          : 'Lumi 服务未连接'
    return (
      <section
        className="workbench-start workbench-unavailable"
        aria-labelledby="workbench-unavailable-title"
        hidden={!active}
      >
        <header className="workbench-header">
          <h1 id="workbench-unavailable-title" aria-live="polite">
            {title}
          </h1>
        </header>
        <p className="workbench-description">
          {coreStatus.state === 'ready'
            ? '无法获取当前会话的连接配置，暂时不能加载或配置工作台。'
            : '暂时不能加载或配置工作台。请到设置查看本地服务状态。'}
        </p>
        <div className="workbench-prompt-actions">
          <Button variant="primary" onClick={openSettings}>
            到设置查看服务
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="workbench-start" aria-labelledby="workbench-title" hidden={!active}>
      <header className="workbench-header">
        <h1 id="workbench-title">你的工作台，由你来设计</h1>
        {step !== 'later' && (
          <ol className="workbench-steps" aria-label="工作台设置进度">
            <li aria-current={step === 'connection' ? 'step' : undefined}>
              <span className="workbench-step-number" aria-hidden="true">
                1
              </span>
              连接 Lumi
            </li>
            <li aria-current={step === 'templates' ? 'step' : undefined}>
              <span className="workbench-step-number" aria-hidden="true">
                2
              </span>
              构建工作台
            </li>
          </ol>
        )}
      </header>
      <section
        className="workbench-prompt"
        aria-labelledby="workbench-prompt-title"
        aria-busy={checking || copying || applying}
      >
        <h2 id="workbench-prompt-title" ref={heading} tabIndex={-1}>
          {step === 'connection'
            ? '连接你的 AI'
            : step === 'templates'
              ? '选择工作台模板'
              : '工作台'}
        </h2>
        {step === 'connection' ? (
          <>
            <p className="workbench-description">
              把连接提示发给你的 AI，完成连接后点击「开始使用」。
            </p>
            <div className="workbench-connection-copy">
              <div>
                <span className="workbench-copy-title">Lumi 连接提示</span>
                <span className="workbench-copy-description">
                  {connection ? '已包含当前会话的 MCP 配置' : '请从 Lumi 桌面应用获取连接配置'}
                </span>
              </div>
              <Button
                type="button"
                className="secondary-button"
                disabled={copying || checking || connection?.coreState !== 'ready'}
                onClick={() => void handleCopy()}
              >
                {copying ? '复制中…' : '复制连接提示'}
              </Button>
            </div>
            <details className="workbench-connection-details" ref={promptDetails}>
              <summary>查看连接提示</summary>
              {promptArea}
            </details>
          </>
        ) : step === 'templates' ? (
          <>
            <p className="workbench-description">
              选择适合你的工作方式，直接应用模板。接入已授权工具后即可运行。
            </p>
            <div
              className="workbench-prompt-types workbench-default-presets"
              role="group"
              aria-label="默认效率工作台模板"
            >
              {WORKBENCH_PRESETS.map((item) => (
                <ChoiceCard
                  key={item.id}
                  label={item.label}
                  description={item.description}
                  selected={preset === item.id}
                  disabled={copying || applying}
                  onClick={() => setPreset(item.id)}
                />
              ))}
            </div>
            <p className="workbench-template-hint">
              模板使用真实工具和数据，未配置时会提供设置引导。应用模板不会执行工具。
            </p>
            <details className="workbench-generated-prompt">
              <summary>让 AI 定制工作台</summary>
              <p className="workbench-description">
                复制提示词，让已连接的 AI 按你的需求开发或调整主页。
              </p>
              <div
                className="workbench-prompt-types"
                role="group"
                aria-label="工作台快捷模板"
                aria-describedby="workbench-template-hint"
              >
                {workbenchTemplates.map((type) => (
                  <ChoiceCard
                    key={type.id}
                    label={type.label}
                    description={type.description}
                    selected={selected === type.id}
                    disabled={copying || applying}
                    onClick={() => void handleCopy(type.id)}
                  />
                ))}
              </div>
              <p id="workbench-template-hint" className="workbench-template-hint">
                点击快捷模板即可复制提示词，发送给你的 AI 开始设计。
              </p>
              {selected && (
                <details className="workbench-generated-prompt" ref={promptDetails} key={selected}>
                  <summary>查看构建提示词</summary>
                  {promptArea}
                </details>
              )}
            </details>
          </>
        ) : (
          <p className="workbench-description">随时选择一个模板，制作你的专属工作台。</p>
        )}
        <div className="workbench-prompt-actions">
          {step === 'connection' ? (
            <Button
              variant="primary"
              type="button"
              className="primary-button"
              disabled={checking || copying || connection?.coreState !== 'ready'}
              onClick={() => void handleStart()}
            >
              {checking ? '检查连接中…' : '开始使用'}
            </Button>
          ) : step === 'templates' ? (
            <>
              <Button type="button" disabled={copying || applying} onClick={finishSetup}>
                稍后配置
              </Button>
              <Button
                variant="primary"
                type="button"
                className="primary-button"
                disabled={copying || !ready || !view || loadError}
                loading={applying}
                loadingLabel="应用中…"
                onClick={() => void handleApply()}
              >
                应用模板
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              type="button"
              className="primary-button"
              onClick={() => {
                dispatch({ type: 'resume', connection })
              }}
            >
              配置工作台
            </Button>
          )}
        </div>
        {step === 'connection' && connection?.coreState !== 'ready' && (
          <p id="workbench-availability-note" className="workbench-availability-note">
            连接配置暂不可用，请等待 Lumi 本地服务就绪。
          </p>
        )}
      </section>
    </section>
  )
}
