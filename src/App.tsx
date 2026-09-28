// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useState } from 'react'
import type {
  CapabilityDraftKind,
  CapabilitySummary,
  McpConnectionInfo,
  UiCoreStatus,
} from '@lumiplug/shared'
import {
  createCapabilityDraft,
  disconnectedStatus,
  getCoreStatus,
  getMcpConnectionInfo,
  listCapabilities,
} from './lib/tauri'
import lumiMark from './assets/lumi-mark.svg'
import WorkbenchPage from './components/WorkbenchPage'
import McpConnectionCard from './components/McpConnectionCard'

type NavKey = 'workbench' | 'capabilities' | 'skills' | 'memory' | 'settings'
type CapabilityFilter = 'all' | CapabilityDraftKind
type GlyphName =
  'home' | 'capability' | 'layers' | 'memory' | 'settings' | 'plus' | 'terminal' | 'mcp'

const navigation: Array<{ id: NavKey; label: string; icon: GlyphName }> = [
  { id: 'workbench', label: '工作台', icon: 'home' },
  { id: 'capabilities', label: '能力', icon: 'capability' },
  { id: 'skills', label: 'Skills', icon: 'layers' },
  { id: 'memory', label: 'Memory', icon: 'memory' },
]

const draftKinds: Array<{ kind: CapabilityDraftKind; label: string; icon: GlyphName }> = [
  { kind: 'terminal', label: 'Terminal', icon: 'terminal' },
  { kind: 'http', label: 'HTTP', icon: 'capability' },
  { kind: 'mcp', label: 'MCP', icon: 'mcp' },
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
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function statusLabel(status: UiCoreStatus['state']): string {
  switch (status) {
    case 'ready':
      return 'Core 已连接'
    case 'starting':
      return 'Core 启动中'
    case 'restarting':
      return 'Core 重启中'
    case 'error':
      return 'Core 连接异常'
    case 'stopped':
      return 'Core 已停止'
    case 'disconnected':
      return 'Core 未连接'
  }
}

function capabilityStatusLabel(status: CapabilitySummary['status']): string {
  switch (status) {
    case 'draft':
      return '草稿'
    case 'ready':
      return '已就绪'
    case 'disabled':
      return '已停用'
  }
}

function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
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

function CapabilityList({ capabilities }: { capabilities: CapabilitySummary[] }) {
  return (
    <div className="capability-list">
      {capabilities.map((capability) => (
        <article className="capability-row" key={capability.id}>
          <span className={'capability-icon capability-icon-' + capability.runnerType}>
            <Glyph
              name={
                capability.runnerType === 'terminal'
                  ? 'terminal'
                  : capability.runnerType === 'mcp'
                    ? 'mcp'
                    : 'capability'
              }
              size={19}
            />
          </span>
          <div className="capability-main">
            <strong>{capability.name}</strong>
            {capability.description && <span>{capability.description}</span>}
          </div>
          <span className="runner-type">{capability.runnerType.toUpperCase()}</span>
          <span className={'status-badge status-' + capability.status}>
            {capabilityStatusLabel(capability.status)}
          </span>
        </article>
      ))}
    </div>
  )
}

function CapabilitiesPage({
  capabilities,
  coreStatus,
  draftName,
  busyKind,
  notice,
  filter,
  onDraftNameChange,
  onFilterChange,
  onCreate,
}: {
  capabilities: CapabilitySummary[]
  coreStatus: UiCoreStatus
  draftName: string
  busyKind: CapabilityDraftKind | null
  notice: string | null
  filter: CapabilityFilter
  onDraftNameChange: (value: string) => void
  onFilterChange: (value: CapabilityFilter) => void
  onCreate: (kind: CapabilityDraftKind) => void
}) {
  const visibleCapabilities =
    filter === 'all' ? capabilities : capabilities.filter((item) => item.runnerType === filter)
  return (
    <>
      <PageHeader title="能力" description="创建和管理 Terminal、HTTP 与 MCP 能力声明。" />
      <section className="create-card" aria-labelledby="create-title">
        <h2 id="create-title">新建草稿</h2>
        <label className="field-label" htmlFor="draft-name">
          能力名称
        </label>
        <div className="create-form">
          <input
            id="draft-name"
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            placeholder="例如：本地开发服务"
            maxLength={64}
          />
          <div className="create-type-buttons">
            {draftKinds.map((entry) => (
              <button
                type="button"
                className="type-button"
                key={entry.kind}
                disabled={coreStatus.state !== 'ready' || busyKind !== null}
                onClick={() => onCreate(entry.kind)}
              >
                <Glyph name={entry.icon} size={16} />
                {busyKind === entry.kind ? '保存中…' : entry.label}
              </button>
            ))}
          </div>
        </div>
        {coreStatus.state !== 'ready' && <p className="form-hint">连接 Core 后可保存草稿。</p>}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </section>
      <div className="section-heading list-heading">
        <h2>
          已保存的能力 <span>{capabilities.length}</span>
        </h2>
        {capabilities.length > 0 && (
          <div className="filter-group" aria-label="按类型筛选">
            {(['all', 'terminal', 'http', 'mcp'] as CapabilityFilter[]).map((item) => (
              <button
                type="button"
                className={'filter-button ' + (filter === item ? 'filter-button-active' : '')}
                key={item}
                aria-pressed={filter === item}
                onClick={() => onFilterChange(item)}
              >
                {item === 'all' ? '全部' : item.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      {visibleCapabilities.length > 0 ? (
        <CapabilityList capabilities={visibleCapabilities} />
      ) : (
        <EmptyState
          title={capabilities.length ? '没有匹配的能力' : '还没有能力声明'}
          description={
            capabilities.length ? '切换类型查看其他能力。' : '在上方输入名称并选择能力类型。'
          }
        />
      )}
    </>
  )
}

function PlannedPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="尚未接入" description={description} />
    </>
  )
}

type Theme = 'dark' | 'light'

function SettingsPage({
  coreStatus,
  mcpConnection,
  theme,
  onThemeChange,
}: {
  coreStatus: UiCoreStatus
  mcpConnection: McpConnectionInfo | null
  theme: Theme
  onThemeChange: (theme: Theme) => void
}) {
  return (
    <>
      <PageHeader title="设置" description="调整外观，管理 MCP 连接与本地服务。" />
      <section className="settings-card appearance-card">
        <h2>外观</h2>
        <p>选择适合你的工作环境的主题。</p>
        <div className="appearance-options" aria-label="主题">
          {(['dark', 'light'] as const).map((option) => (
            <button
              type="button"
              key={option}
              className={
                'appearance-option ' + (theme === option ? 'appearance-option-selected' : '')
              }
              aria-pressed={theme === option}
              onClick={() => onThemeChange(option)}
            >
              <span className={'appearance-swatch appearance-swatch-' + option} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                {option === 'dark' ? '深色' : '浅色'}
                {theme === option && <span className="appearance-selection">已选择</span>}
              </span>
            </button>
          ))}
        </div>
      </section>
      <McpConnectionCard connection={mcpConnection} />
      <section className="settings-card">
        <h2>Core</h2>
        <dl>
          <div>
            <dt>连接状态</dt>
            <dd>{statusLabel(coreStatus.state)}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{coreStatus.coreVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>本地数据目录</dt>
            <dd>{coreStatus.userDataPathAvailable ? '可用' : '不可用'}</dd>
          </div>
        </dl>
      </section>
    </>
  )
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('workbench')
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('lumi.theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [coreStatus, setCoreStatus] = useState<UiCoreStatus>(disconnectedStatus)
  const [mcpConnection, setMcpConnection] = useState<McpConnectionInfo | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilitySummary[]>([])
  const [draftName, setDraftName] = useState('')
  const [busyKind, setBusyKind] = useState<CapabilityDraftKind | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>('all')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e0e11' : '#f0f0ee')
    try {
      localStorage.setItem('lumi.theme', theme)
    } catch {
      /* Theme remains usable when storage is unavailable. */
    }
  }, [theme])

  const refresh = useCallback(async () => {
    const [nextStatus, nextCapabilities, nextMcpConnection] = await Promise.all([
      getCoreStatus(),
      listCapabilities(),
      getMcpConnectionInfo(),
    ])
    setCoreStatus(nextStatus)
    setCapabilities(nextCapabilities)
    setMcpConnection(nextMcpConnection)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  function showNotice(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 4_000)
  }

  async function handleCreate(kind: CapabilityDraftKind): Promise<void> {
    const name = draftName.trim()
    if (!name) {
      showNotice('请先填写能力名称')
      return
    }
    setBusyKind(kind)
    setNotice(null)
    try {
      const created = await createCapabilityDraft(kind, name)
      setCapabilities((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setDraftName('')
      showNotice(created.name + ' 已保存为草稿')
    } catch {
      showNotice('保存失败，请检查名称或 Core 连接状态')
    } finally {
      setBusyKind(null)
    }
  }

  function navButton(item: { id: NavKey; label: string; icon: GlyphName }) {
    return (
      <button
        type="button"
        className={'nav-item ' + (activeNav === item.id ? 'nav-item-active' : '')}
        key={item.id}
        aria-label={item.label}
        aria-current={activeNav === item.id ? 'page' : undefined}
        onClick={() => {
          setActiveNav(item.id)
          setNotice(null)
        }}
      >
        <Glyph name={item.icon} />
        <span className="nav-tooltip" aria-hidden="true">
          {item.label}
        </span>
      </button>
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
          <img src={lumiMark} alt="Lumi" />
        </div>
        <nav className="main-nav" aria-label="主导航">
          {navigation.map(navButton)}
        </nav>
        <nav className="bottom-nav" aria-label="其他页面">
          {navButton({ id: 'settings', label: '设置', icon: 'settings' })}
        </nav>
      </aside>
      <section className="workspace">
        <div className="workspace-content" id="main-content">
          <div className="desktop-content-inner">
            {activeNav === 'workbench' && <WorkbenchPage connection={mcpConnection} />}
            {activeNav === 'capabilities' && (
              <CapabilitiesPage
                capabilities={capabilities}
                coreStatus={coreStatus}
                draftName={draftName}
                busyKind={busyKind}
                notice={notice}
                filter={capabilityFilter}
                onDraftNameChange={setDraftName}
                onFilterChange={setCapabilityFilter}
                onCreate={(kind) => void handleCreate(kind)}
              />
            )}
            {activeNav === 'skills' && (
              <PlannedPage title="Skills" description="Skill 导入与同步功能正在开发中。" />
            )}
            {activeNav === 'memory' && (
              <PlannedPage title="Memory" description="个人和项目经验功能正在开发中。" />
            )}
            {activeNav === 'settings' && (
              <SettingsPage
                coreStatus={coreStatus}
                mcpConnection={mcpConnection}
                theme={theme}
                onThemeChange={setTheme}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
