// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from './i18n'

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { McpConnectionInfo, UiCoreStatus } from '@lumiplug/shared'
import { disconnectedStatus, getCoreStatus, getMcpConnectionInfo } from './lib/tauri'
import lumiMark from './assets/lumi-mark.svg'
import WorkbenchPage from './components/WorkbenchPage'
import { NavigationButton, SurfaceEffects } from './components/ui'
import SettingsPage from './components/SettingsPage'
import SkillsPage from './components/SkillsPage'
import ToolsPage from './components/ToolsPage'
import KnowledgePage from './components/KnowledgePage'
import UsagePage from './components/UsagePage'
import { BookOpen, ChartNoAxesCombined } from 'lucide-react'
import { useTheme } from './lib/useTheme'
import { refreshRunState } from './lib/run-task-refresh'
import { useNativeWindowActivity } from './lib/window-activity'
import { useMainWindowIdle } from './lib/window-retention'
import { useRetainWindowState } from './lib/window-retention'
import { isTauri } from '@tauri-apps/api/core'
import { connectDesktopActions } from './lib/desktop-actions'
import { pendingDesktopAction, acknowledgeDesktopAction, controlCore } from './lib/tauri'
import type { DesktopRequest } from '@lumiplug/shared'
import ConfirmationDialog from './components/ConfirmationDialog'
import { listen } from '@tauri-apps/api/event'
import { useToast } from './components/ToastProvider'

const UiComponentsPage = import.meta.env.DEV
  ? lazy(() => import('./components/UiComponentsPage'))
  : null

type NavKey =
  | 'workbench'
  | 'capabilities'
  | 'skills'
  | 'knowledge'
  | 'usage'
  | 'memory'
  | 'settings'
  | 'ui-components'
type GlyphName =
  | 'home'
  | 'capability'
  | 'layers'
  | 'memory'
  | 'settings'
  | 'plus'
  | 'terminal'
  | 'mcp'
  | 'knowledge'
  | 'usage'

const navigation: Array<{ id: NavKey; label: string; icon: GlyphName }> = [
  {
    id: 'workbench',
    get label() {
      return t('工作台')
    },
    icon: 'home',
  },
  {
    id: 'capabilities',
    get label() {
      return t('工具')
    },
    icon: 'capability',
  },
  { id: 'skills', label: 'Skills', icon: 'layers' },
  {
    id: 'knowledge',
    get label() {
      return t('知识库')
    },
    icon: 'knowledge',
  },
  {
    id: 'usage',
    get label() {
      return t('AI 用量')
    },
    icon: 'usage',
  },
]

function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  useLocale()

  const paths: Record<GlyphName, string> = {
    home: 'm3 11 9-8 9 8v9H5v-9M9 20v-5h6v5',
    capability: 'M12 3v18M5 7h14M5 17h14M7 3v4m10-4v4M7 17v4m10-4v4',
    layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
    memory: 'M8 4v3m8-3v3M8 17v3m8-3v3M4 8h3m-3 8h3m10-8h4m-4 8h4M7 7h10v10H7zM10 10h4v4h-4z',
    settings:
      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2-1.2L14.6 3h-4l-.4 2.7a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.4 2.7h4l.4-2.7a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
    plus: 'M12 5v14M5 12h14',
    terminal: 'm5 7 5 5-5 5m7 0h7',
    mcp: 'M4 8h16M4 16h16M8 4v16m8-16v16',
    knowledge: '',
    usage: '',
  }
  return (
    <svg
      className="glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  useLocale()

  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}

function PlannedPage({ title, description }: { title: string; description: string }) {
  useLocale()

  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <EmptyState title={t('尚未接入')} description={description} />
    </>
  )
}

export default function App() {
  useLocale()

  const [activeNav, setActiveNav] = useState<NavKey>('workbench')
  useNativeWindowActivity()
  useMainWindowIdle(activeNav === 'workbench')
  const [theme, setTheme] = useTheme()
  const showToast = useToast()
  const [coreStatus, setCoreStatus] = useState<UiCoreStatus>(disconnectedStatus)
  const [coreStatusLoaded, setCoreStatusLoaded] = useState(false)
  const mcpCredentialRevision = useRef(0)
  const [mcpConnection, setMcpConnection] = useState<McpConnectionInfo | null>(null)
  const leaveTools = useRef<(leave: () => void) => void>((leave) => leave())
  const [coreStopRequest, setCoreStopRequest] = useState<DesktopRequest | null>(null)
  const [coreControlBusy, setCoreControlBusy] = useState(false)
  const coreControlInFlight = useRef(false)
  const coreControlRevision = useRef(0)
  const stopPromptOpen = useRef(false)
  const deliveredDesktopActions = useRef(new Set<string>())
  useRetainWindowState(!!coreStopRequest || coreControlBusy)
  const registerLeave = useCallback((guard: (leave: () => void) => void) => {
    leaveTools.current = guard
  }, [])
  const navigate = (next: NavKey, after?: () => void) => {
    const apply = () => {
      setActiveNav(next)
      if (after) requestAnimationFrame(after)
    }
    if (activeNav === 'capabilities' && next !== activeNav) leaveTools.current(apply)
    else apply()
  }
  const desktopHandler = useRef<(request: DesktopRequest) => void>(() => {})
  async function runCoreControl(action: 'start' | 'stop', request: DesktopRequest) {
    if (coreControlInFlight.current) return
    coreControlInFlight.current = true
    coreControlRevision.current += 1
    setCoreControlBusy(true)
    try {
      const status = await controlCore(action, request.coreGeneration)
      setCoreStatus(status)
      if (action === 'stop') {
        stopPromptOpen.current = false
        setCoreStopRequest(null)
      }
      showToast(
        action === 'start' ? t('已请求启动 Core。') : t('Core 已停止，任务与连接已关闭。'),
        'success',
      )
    } catch (error) {
      const code = String(error)
      showToast(
        code.includes('core_state_changed')
          ? t('Core 状态已变化，请重新选择操作。')
          : action === 'stop'
            ? t('未能确认 Core 已停止，请查看状态；不会自动启动另一个进程。')
            : t('Core 启动失败，请检查状态与端口。'),
        'error',
      )
      setCoreStatus(await getCoreStatus())
    } finally {
      coreControlInFlight.current = false
      coreControlRevision.current += 1
      setCoreControlBusy(false)
      window.dispatchEvent(new Event('focus'))
    }
  }
  desktopHandler.current = (request) => {
    const focusCore = () => {
      const section = document.getElementById('core-title')
      section?.scrollIntoView({ block: 'nearest' })
      section?.focus()
    }
    switch (request.action) {
      case 'open':
        break
      case 'usage':
        navigate('usage')
        break
      case 'skills':
        navigate('skills')
        break
      case 'knowledge':
        navigate('knowledge')
        break
      case 'settings':
        navigate('settings')
        break
      case 'core-status':
        navigate('settings', focusCore)
        break
      case 'core-start':
        navigate('settings', () => {
          focusCore()
          void runCoreControl('start', request)
        })
        break
      case 'core-stop':
        navigate('settings', () => {
          focusCore()
          if (!stopPromptOpen.current && !coreControlInFlight.current) {
            stopPromptOpen.current = true
            setCoreStopRequest(request)
          }
        })
        break
    }
  }
  useEffect(() => {
    if (!isTauri()) return
    return connectDesktopActions({
      subscribe: async (wake) => {
        const unlisten = await listen('lumi-desktop-action', wake)
        try {
          const removeError = await listen<string>('lumi-native-error', ({ payload }) =>
            showToast(payload, 'error'),
          )
          window.addEventListener('focus', wake)
          return () => {
            unlisten()
            removeError()
            window.removeEventListener('focus', wake)
          }
        } catch (error) {
          unlisten()
          throw error
        }
      },
      read: pendingDesktopAction,
      acknowledge: acknowledgeDesktopAction,
      handle: (request) => desktopHandler.current(request),
      delivered: deliveredDesktopActions.current,
      fail: () => showToast(t('托盘操作未完成，请重新打开 Lumi 后重试。'), 'error'),
    })
  }, [showToast])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen<string>('tool-run-window-feedback', ({ payload }) => showToast(payload, 'success'))
      .then((dispose) => {
        if (cancelled) dispose()
        else unlisten = dispose
      })
      .catch(() => {
        /* Browser previews have no native window events. */
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [showToast])

  useEffect(() => {
    return refreshRunState({
      wakeTarget: window,
      interval: ({ nextStatus }) =>
        ['starting', 'restarting', 'stopping', 'disconnected'].includes(nextStatus.state)
          ? 250
          : 2000,
      read: async () => {
        const credentialRevision = mcpCredentialRevision.current
        const lifecycleRevision = coreControlRevision.current
        const [nextStatus, nextMcpConnection] = await Promise.all([
          getCoreStatus(),
          getMcpConnectionInfo(),
        ])
        return { credentialRevision, lifecycleRevision, nextStatus, nextMcpConnection }
      },
      update: ({ credentialRevision, lifecycleRevision, nextStatus, nextMcpConnection }) => {
        if (lifecycleRevision !== coreControlRevision.current) return
        setCoreStatus(nextStatus)
        setCoreStatusLoaded(true)
        if (credentialRevision === mcpCredentialRevision.current)
          setMcpConnection(nextMcpConnection)
      },
      fail: () => {},
    })
  }, [])

  function navButton(item: { id: NavKey; label: string; icon: GlyphName }) {
    return (
      <NavigationButton
        key={item.id}
        label={item.label}
        icon={
          item.icon === 'knowledge' ? (
            <BookOpen size={20} />
          ) : item.icon === 'usage' ? (
            <ChartNoAxesCombined size={20} />
          ) : (
            <Glyph name={item.icon} />
          )
        }
        current={activeNav === item.id || (item.id === 'settings' && activeNav === 'ui-components')}
        onClick={() => navigate(item.id)}
      />
    )
  }

  return (
    <main className="app-frame">
      {coreStopRequest && (
        <ConfirmationDialog
          title={t('停止 Core？')}
          confirmLabel={t('停止 Core')}
          danger
          busy={coreControlBusy}
          confirm={() => void runCoreControl('stop', coreStopRequest)}
          cancel={() => {
            stopPromptOpen.current = false
            setCoreStopRequest(null)
          }}
        >
          <p>
            {t(
              '这会中断 Lumi 托管的运行任务、断开 MCP 连接并暂停用量采集。仅停止本应用启动的 Core；之后可从托盘重新启动。',
            )}
          </p>
        </ConfirmationDialog>
      )}
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />
      <a className="skip-link" href="#main-content">
        {t('跳转到主要内容')}
      </a>
      <aside className="sidebar" aria-label={t('Lumi 导航')}>
        <div className="sidebar-brand" title="Lumi">
          <img src={lumiMark} alt="Lumi" width={34} height={34} />
        </div>
        <nav className="main-nav" aria-label={t('主导航')}>
          {navigation.map(navButton)}
        </nav>
        <nav className="bottom-nav" aria-label={t('其他页面')}>
          {navButton({ id: 'settings', label: t('设置'), icon: 'settings' })}
        </nav>
      </aside>
      <section className="workspace">
        <div
          className={`workspace-content${activeNav === 'skills' ? ' skills-workspace' : activeNav === 'capabilities' ? ' tools-workspace' : activeNav === 'knowledge' ? ' knowledge-workspace' : activeNav === 'usage' ? ' usage-workspace' : ''}`}
          id="main-content"
        >
          <div className="desktop-content-inner">
            <WorkbenchPage
              connection={mcpConnection}
              coreStatus={coreStatus}
              coreStatusLoaded={coreStatusLoaded}
              openSettings={() => navigate('settings')}
              active={activeNav === 'workbench'}
            />
            <SurfaceEffects depth="heavy" className="app-ui-surfaces">
              <ToolsPage
                active={activeNav === 'capabilities'}
                coreReady={coreStatus.state === 'ready'}
                registerLeave={registerLeave}
                openSettings={() => navigate('settings')}
              />
              <SkillsPage
                active={activeNav === 'skills'}
                coreReady={coreStatus.state === 'ready'}
              />
              <KnowledgePage
                active={activeNav === 'knowledge'}
                coreStatus={coreStatus}
                coreStatusLoaded={coreStatusLoaded}
                openSettings={() => navigate('settings')}
              />
              <UsagePage active={activeNav === 'usage'} coreReady={coreStatus.state === 'ready'} />
              {activeNav === 'memory' && (
                <PlannedPage title="Memory" description={t('个人和项目经验功能正在开发中。')} />
              )}
              {activeNav === 'settings' && (
                <SettingsPage
                  coreStatus={coreStatus}
                  mcpConnection={mcpConnection}
                  onMcpConnectionChange={(next) => {
                    mcpCredentialRevision.current += 1
                    setMcpConnection(next)
                  }}
                  theme={theme}
                  onThemeChange={setTheme}
                  openComponents={() => navigate('ui-components')}
                />
              )}
              {import.meta.env.DEV && activeNav === 'ui-components' && UiComponentsPage && (
                <Suspense fallback={<p role="status">{t('加载组件…')}</p>}>
                  <UiComponentsPage
                    theme={theme}
                    onThemeChange={setTheme}
                    back={() => {
                      navigate('settings')
                      requestAnimationFrame(() =>
                        document
                          .getElementById('ui-components-entry')
                          ?.focus({ preventScroll: true }),
                      )
                    }}
                  />
                </Suspense>
              )}
            </SurfaceEffects>
          </div>
        </div>
      </section>
    </main>
  )
}
