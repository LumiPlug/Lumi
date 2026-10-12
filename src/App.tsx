// SPDX-License-Identifier: MPL-2.0

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
import { BookOpen } from 'lucide-react'
import { useTheme } from './lib/useTheme'
import { listen } from '@tauri-apps/api/event'
import { useToast } from './components/ToastProvider'

const UiComponentsPage = import.meta.env.DEV
  ? lazy(() => import('./components/UiComponentsPage'))
  : null

type NavKey =
  'workbench' | 'capabilities' | 'skills' | 'knowledge' | 'memory' | 'settings' | 'ui-components'
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

const navigation: Array<{ id: NavKey; label: string; icon: GlyphName }> = [
  { id: 'workbench', label: '工作台', icon: 'home' },
  { id: 'capabilities', label: '工具', icon: 'capability' },
  { id: 'skills', label: 'Skills', icon: 'layers' },
  { id: 'knowledge', label: '知识库', icon: 'knowledge' },
]

function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
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
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}

function PlannedPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <EmptyState title="尚未接入" description={description} />
    </>
  )
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('workbench')
  const [theme, setTheme] = useTheme()
  const showToast = useToast()
  const [coreStatus, setCoreStatus] = useState<UiCoreStatus>(disconnectedStatus)
  const [coreStatusLoaded, setCoreStatusLoaded] = useState(false)
  const mcpCredentialRevision = useRef(0)
  const [mcpConnection, setMcpConnection] = useState<McpConnectionInfo | null>(null)
  const leaveTools = useRef<(leave: () => void) => void>((leave) => leave())
  const registerLeave = useCallback((guard: (leave: () => void) => void) => {
    leaveTools.current = guard
  }, [])
  const navigate = (next: NavKey) => {
    if (activeNav === 'capabilities' && next !== activeNav)
      leaveTools.current(() => setActiveNav(next))
    else setActiveNav(next)
  }

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
    // Read startup readiness promptly; settle into normal polling once Core is ready.
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const credentialRevision = mcpCredentialRevision.current
      const [nextStatus, nextMcpConnection] = await Promise.all([
        getCoreStatus(),
        getMcpConnectionInfo(),
      ])
      if (cancelled) return
      setCoreStatus(nextStatus)
      setCoreStatusLoaded(true)
      if (credentialRevision === mcpCredentialRevision.current) setMcpConnection(nextMcpConnection)
      timer = setTimeout(
        () => void poll(),
        ['starting', 'restarting', 'disconnected'].includes(nextStatus.state) ? 250 : 2_000,
      )
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  function navButton(item: { id: NavKey; label: string; icon: GlyphName }) {
    return (
      <NavigationButton
        key={item.id}
        label={item.label}
        icon={item.icon === 'knowledge' ? <BookOpen size={20} /> : <Glyph name={item.icon} />}
        current={activeNav === item.id || (item.id === 'settings' && activeNav === 'ui-components')}
        onClick={() => navigate(item.id)}
      />
    )
  }

  return (
    <main className="app-frame">
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <aside className="sidebar" aria-label="Lumi 导航">
        <div className="sidebar-brand" title="Lumi">
          <img src={lumiMark} alt="Lumi" width={34} height={34} />
        </div>
        <nav className="main-nav" aria-label="主导航">
          {navigation.map(navButton)}
        </nav>
        <nav className="bottom-nav" aria-label="其他页面">
          {navButton({ id: 'settings', label: '设置', icon: 'settings' })}
        </nav>
      </aside>
      <section className="workspace">
        <div
          className={`workspace-content${activeNav === 'skills' ? ' skills-workspace' : activeNav === 'capabilities' ? ' tools-workspace' : activeNav === 'knowledge' ? ' knowledge-workspace' : ''}`}
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
              {activeNav === 'memory' && (
                <PlannedPage title="Memory" description="个人和项目经验功能正在开发中。" />
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
                <Suspense fallback={<p role="status">加载组件…</p>}>
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
