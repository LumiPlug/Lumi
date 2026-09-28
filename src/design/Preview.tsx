// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import logo from '../assets/lumi-mark.svg'
import WorkbenchPage from '../components/WorkbenchPage'
import McpConnectionCard from '../components/McpConnectionCard'

type Page = 'workbench' | 'capabilities' | 'skills' | 'memory' | 'connections' | 'settings'
type Kind = 'Terminal' | 'HTTP' | 'MCP' | 'Skill' | 'Memory'
type IconName =
  | 'home'
  | 'grid'
  | 'layers'
  | 'memory'
  | 'link'
  | 'settings'
  | 'search'
  | 'plus'
  | 'arrow'
  | 'chevron'
  | 'terminal'
  | 'globe'
  | 'spark'
  | 'pin'
  | 'sun'
  | 'moon'
  | 'close'
  | 'file'
  | 'check'
type Resource = {
  id: string
  name: string
  description: string
  kind: Kind
  scope: string
  time: string
  pinned: boolean
}
type Overlay =
  | { type: 'search' }
  | { type: 'create' }
  | { type: 'detail'; id: string }
  | { type: 'connection'; name: string }
  | null

const pageNames: Record<Page, string> = {
  workbench: '工作台',
  capabilities: '能力',
  skills: 'Skills',
  memory: 'Memory',
  connections: 'AI 连接',
  settings: '设置',
}
const pageDescriptions: Record<Page, string> = {
  workbench: '让经验、技能与工具，一起工作。',
  capabilities: '把常用工具，变成随时可用的能力。',
  skills: '好方法，值得在每一次工作中复用。',
  memory: '留住经验，让下一次开始更轻松。',
  connections: '一份经验与能力，连接你的每一个 AI。',
  settings: '让 Lumi 更贴合你的工作习惯。',
}
const initialResources: Resource[] = [
  {
    id: 'dev',
    name: '本地开发',
    description: '启动项目服务，查看运行日志',
    kind: 'Terminal',
    scope: 'Lumi 项目',
    time: '刚刚',
    pinned: true,
  },
  {
    id: 'api',
    name: 'API 数据查询',
    description: '连接业务接口，获取结构化数据',
    kind: 'HTTP',
    scope: '个人空间',
    time: '12 分钟前',
    pinned: true,
  },
  {
    id: 'browser',
    name: '浏览器助手',
    description: '访问页面、检查交互与保存截图',
    kind: 'MCP',
    scope: '个人空间',
    time: '35 分钟前',
    pinned: true,
  },
  {
    id: 'ui',
    name: '界面设计规范',
    description: '保持清晰的层级、一致的间距与克制的视觉表达。',
    kind: 'Skill',
    scope: '个人空间',
    time: '1 小时前',
    pinned: false,
  },
  {
    id: 'project',
    name: 'Lumi 项目约定',
    description: '先明确产品意图，再设计操作流程。把值得复用的项目决定留在这里。',
    kind: 'Memory',
    scope: 'Lumi 项目',
    time: '今天',
    pinned: false,
  },
  {
    id: 'report',
    name: '周报整理',
    description: '将本周的进展、结果和下一步整理为可分享的文档。',
    kind: 'Skill',
    scope: '个人空间',
    time: '昨天',
    pinned: false,
  },
]
const mainNavigation: { page: Page; icon: IconName }[] = [
  { page: 'workbench', icon: 'home' },
  { page: 'capabilities', icon: 'grid' },
  { page: 'skills', icon: 'layers' },
  { page: 'memory', icon: 'memory' },
]
const kindIcons: Record<Kind, IconName> = {
  Terminal: 'terminal',
  HTTP: 'globe',
  MCP: 'spark',
  Skill: 'layers',
  Memory: 'memory',
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    memory: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="3" />
        <path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3" />
        <path d="M10 10h4v4h-4Z" />
      </>
    ),
    link: (
      <>
        <path
          d="m10 13 4-4M8 16l-1 1a4.25 4.25 0 0 1-6-6l4-4a4.25 4.25 0 0 1 6 0m2 1 1-1a4.25 4.25 0 0 1 6 6l-4 4a4.25 4.25 0 0 1-6 0"
          transform="translate(1 1)"
        />
      </>
    ),
    settings: (
      <>
        <path d="m10 3-.5 2.4-2 1.2-2.3-.8-2 3.4 1.8 1.6v2.4l-1.8 1.6 2 3.4 2.3-.8 2 1.2L10 21h4l.5-2.4 2-1.2 2.3.8 2-3.4-1.8-1.6v-2.4l1.8-1.6-2-3.4-2.3.8-2-1.2L14 3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    terminal: (
      <>
        <path d="m5 6 6 6-6 6M13 18h6" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    spark: <path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z" />,
    pin: (
      <>
        <path d="m8 3 8 0-1 6 3 3v2H6v-2l3-3ZM12 14v7" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20.8 13.3A9 9 0 0 1 10.7 3.2a9 9 0 1 0 10.1 10.1Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function Modal({
  children,
  title,
  close,
  wide = false,
}: {
  children: ReactNode
  title: string
  close: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    dialog?.querySelector<HTMLInputElement>('input, select')?.focus()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-label={title}
      onCancel={close}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close()
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  )
}

export default function Preview() {
  const [page, setPage] = useState<Page>('workbench')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [resources, setResources] = useState(initialResources)
  const [filter, setFilter] = useState('全部')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<Kind>('Terminal')
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  const [output, setOutput] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e0e11' : '#f7f7f5')
  }, [theme])
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuery('')
        setOverlay({ type: 'search' })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  function notify(message: string) {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3200)
  }
  function navigate(next: Page) {
    setPage(next)
    setFilter('全部')
    setOverlay(null)
  }
  function showResource(id: string) {
    setOutput(false)
    setOverlay({ type: 'detail', id })
  }
  function showCreate() {
    setNewName('')
    setNewKind(page === 'skills' ? 'Skill' : page === 'memory' ? 'Memory' : 'Terminal')
    setFormError('')
    setOverlay({ type: 'create' })
  }
  function togglePin(resource: Resource) {
    setResources((items) =>
      items.map((item) => (item.id === resource.id ? { ...item, pinned: !item.pinned } : item)),
    )
    notify(resource.pinned ? '已取消置顶' : '已置顶到工作台')
  }
  function navButton(next: Page, icon: IconName) {
    return (
      <button
        key={next}
        className={`rail-button ${page === next ? 'is-active' : ''}`}
        aria-label={pageNames[next]}
        aria-current={page === next ? 'page' : undefined}
        onClick={() => navigate(next)}
      >
        <Icon name={icon} />
        <span className="rail-tooltip">{pageNames[next]}</span>
      </button>
    )
  }

  const visible = resources.filter((resource) => {
    const inPage =
      page === 'capabilities'
        ? ['Terminal', 'HTTP', 'MCP'].includes(resource.kind)
        : page === 'skills'
          ? resource.kind === 'Skill'
          : page === 'memory'
            ? resource.kind === 'Memory'
            : true
    return (
      inPage &&
      (filter === '全部' ||
        (filter === '能力'
          ? ['Terminal', 'HTTP', 'MCP'].includes(resource.kind)
          : filter === 'Skills'
            ? resource.kind === 'Skill'
            : filter === 'Memory'
              ? resource.kind === 'Memory'
              : filter === resource.kind))
    )
  })
  const filters =
    page === 'capabilities'
      ? ['全部', 'Terminal', 'HTTP', 'MCP']
      : ['全部', '能力', 'Skills', 'Memory']
  const selected =
    overlay?.type === 'detail' ? resources.find((resource) => resource.id === overlay.id) : null
  const searchResults = resources.filter((resource) =>
    `${resource.name} ${resource.kind} ${resource.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )

  function resourceRows(items: Resource[]) {
    return (
      <div className="resource-list">
        {items.map((resource) => (
          <div className="resource-row" key={resource.id}>
            <button className="resource-open" onClick={() => showResource(resource.id)}>
              <span className={`resource-icon icon-${resource.kind.toLowerCase()}`}>
                <Icon name={kindIcons[resource.kind]} size={18} />
              </span>
              <span className="resource-text">
                <strong>{resource.name}</strong>
                <span>{resource.scope}</span>
              </span>
              <span className="resource-kind">{resource.kind}</span>
              <span className="resource-time">{resource.time}</span>
            </button>
            <button
              className={`icon-button row-pin ${resource.pinned ? 'is-pinned' : ''}`}
              aria-label={`${resource.pinned ? '取消置顶' : '置顶'} ${resource.name}`}
              aria-pressed={resource.pinned}
              onClick={() => togglePin(resource)}
            >
              <Icon name="pin" size={16} />
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="lumi-preview">
      <a className="skip" href="#content">
        跳转到主要内容
      </a>
      <aside className="rail" aria-label="主导航">
        <button
          className="brand-button"
          onClick={() => navigate('workbench')}
          aria-label="Lumi 工作台"
        >
          <img src={logo} width="38" height="46" alt="Lumi" />
        </button>
        <nav className="rail-main">
          {mainNavigation.map(({ page: next, icon }) => navButton(next, icon))}
        </nav>
        <nav className="rail-bottom">
          <button
            className="rail-button"
            aria-label="搜索资源"
            onClick={() => {
              setQuery('')
              setOverlay({ type: 'search' })
            }}
          >
            <Icon name="search" size={18} />
            <span className="rail-tooltip">搜索资源</span>
          </button>
          {navButton('connections', 'link')}
          {navButton('settings', 'settings')}
        </nav>
      </aside>

      <div className="app-body">
        <main id="content" className="main-content">
          <div className="desktop-content-inner">
            {page === 'workbench' ? (
              <WorkbenchPage />
            ) : (
              <>
                <header className="page-heading">
                  <div>
                    <p className="eyebrow">
                      YOUR PERSONAL AI SPACE <span className="preview-tag">设计预览</span>
                    </p>
                    <h1>{pageNames[page]}</h1>
                    <p className="page-description">{pageDescriptions[page]}</p>
                  </div>
                  {!['settings', 'connections'].includes(page) && (
                    <button className="primary-button" onClick={showCreate}>
                      <Icon name="plus" size={17} />
                      新建
                    </button>
                  )}
                </header>

                {!['settings', 'connections'].includes(page) && (
                  <button
                    className="search-bar"
                    onClick={() => {
                      setQuery('')
                      setOverlay({ type: 'search' })
                    }}
                  >
                    <Icon name="search" size={18} />
                    <span>查找能力、技能或记忆…</span>
                    <kbd>⌘ K</kbd>
                  </button>
                )}

                {!['settings', 'connections'].includes(page) && (
                  <div className="content-grid full-width">
                    <section className="recent-section" aria-labelledby="resources-title">
                      <div className="section-header">
                        <h2 id="resources-title">
                          {page === 'capabilities'
                            ? '我的能力'
                            : page === 'skills'
                              ? '我的技能'
                              : '我的记忆'}
                        </h2>
                        <span className="subtle-label">{visible.length} 个资源</span>
                      </div>
                      {page === 'capabilities' && (
                        <div className="filter-tabs" aria-label="资源类型">
                          {filters.map((label) => (
                            <button
                              key={label}
                              aria-pressed={filter === label}
                              className={filter === label ? 'selected' : ''}
                              onClick={() => setFilter(label)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      {resourceRows(visible)}
                      {visible.length === 0 && (
                        <div className="empty">还没有这类资源，点击「新建」添加。</div>
                      )}
                    </section>
                  </div>
                )}

                {page === 'connections' && (
                  <section className="connections-page">
                    <div className="section-header">
                      <h2>选择你的 AI 软件</h2>
                      <span className="subtle-label">共享 Memory · Skills · Capabilities</span>
                    </div>
                    {['Codex', 'Claude Code', 'Cursor', 'Gemini'].map((name, index) => (
                      <button
                        className="connection-option"
                        key={name}
                        onClick={() => setOverlay({ type: 'connection', name })}
                      >
                        <span className={`client-monogram client-${index}`} aria-hidden="true">
                          {name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{name}</strong>
                          <small>使用 Lumi 的统一连接入口</small>
                        </span>
                        <Icon name="arrow" size={18} />
                      </button>
                    ))}
                  </section>
                )}

                {page === 'settings' && (
                  <>
                    <section className="settings-section">
                      <div className="section-header">
                        <h2>外观</h2>
                        <span className="subtle-label">选择舒服的工作方式</span>
                      </div>
                      <div className="theme-options">
                        {(['dark', 'light'] as const).map((option) => (
                          <button
                            key={option}
                            aria-pressed={theme === option}
                            className={`theme-option ${theme === option ? 'selected' : ''}`}
                            onClick={() => setTheme(option)}
                          >
                            <span className={`theme-swatch swatch-${option}`}>
                              <i />
                              <i />
                              <i />
                            </span>
                            <span>
                              <Icon name={option === 'dark' ? 'moon' : 'sun'} size={16} />
                              {option === 'dark' ? '深色' : '浅色'}
                              {theme === option && <Icon name="check" size={16} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <McpConnectionCard />
                  </>
                )}
              </>
            )}
            {page !== 'workbench' && (
              <footer className="content-footer">
                <span>
                  <img src={logo} width="13" height="16" alt="" />
                  经验积累于此，能力连接于此。
                </span>
                <span>界面效果页 · 示例内容</span>
              </footer>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toast}
        </div>
      )}

      {overlay?.type === 'search' && (
        <Modal key="search" title="搜索资源" close={() => setOverlay(null)} wide>
          <label className="search-input-wrap">
            <Icon name="search" />
            <input
              aria-label="资源名称或关键词"
              placeholder="输入名称或关键词…"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>ESC</kbd>
          </label>
          <div className="search-results">
            {searchResults.map((resource) => (
              <button key={resource.id} onClick={() => showResource(resource.id)}>
                <span className="resource-icon">
                  <Icon name={kindIcons[resource.kind]} size={18} />
                </span>
                <strong>{resource.name}</strong>
                <span className="kind-label">{resource.kind}</span>
                <Icon name="arrow" size={16} />
              </button>
            ))}
            {searchResults.length === 0 && <p className="empty">没有找到匹配的资源。</p>}
          </div>
        </Modal>
      )}

      {overlay?.type === 'create' && (
        <Modal key="create" title="新建资源" close={() => setOverlay(null)}>
          <form
            className="create-resource-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!newName.trim()) {
                setFormError('请输入资源名称')
                return
              }
              setResources((items) => [
                {
                  id: crypto.randomUUID(),
                  name: newName.trim(),
                  description: '在这里记录用途，并完善资源配置。',
                  kind: newKind,
                  scope: '个人空间',
                  time: '刚刚',
                  pinned: false,
                },
                ...items,
              ])
              setOverlay(null)
              setPage(
                newKind === 'Skill' ? 'skills' : newKind === 'Memory' ? 'memory' : 'capabilities',
              )
              setFilter('全部')
              notify('已添加到效果页')
            }}
          >
            <label htmlFor="resource-name">名称</label>
            <input
              id="resource-name"
              autoFocus
              value={newName}
              maxLength={64}
              placeholder="例如：项目开发服务"
              aria-invalid={!!formError}
              aria-describedby={formError ? 'name-error' : undefined}
              onChange={(event) => {
                setNewName(event.target.value)
                setFormError('')
              }}
            />
            {formError && (
              <p id="name-error" className="field-error">
                {formError}
              </p>
            )}
            <label htmlFor="resource-type">资源类型</label>
            <select
              id="resource-type"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as Kind)}
            >
              {(['Terminal', 'HTTP', 'MCP', 'Skill', 'Memory'] as Kind[]).map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
            <p className="form-note">设计预览中的资源仅保留在当前页面。</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setOverlay(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                创建资源
                <Icon name="arrow" size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}

      {overlay?.type === 'detail' && selected && (
        <Modal
          key={`detail-${selected.id}`}
          title={selected.name}
          close={() => setOverlay(null)}
          wide
        >
          <div className="detail-meta">
            <span className="detail-kind">
              <Icon name={kindIcons[selected.kind]} size={17} />
              {selected.kind}
            </span>
            <span>{selected.scope}</span>
            <button
              className={`text-button ${selected.pinned ? 'accent-text' : ''}`}
              aria-pressed={selected.pinned}
              onClick={() => togglePin(selected)}
            >
              <Icon name="pin" size={15} />
              {selected.pinned ? '已置顶' : '置顶'}
            </button>
          </div>
          <p className="detail-description">{selected.description}</p>
          {['Skill', 'Memory'].includes(selected.kind) ? (
            <div className="document-preview">
              <span className="eyebrow">{selected.kind === 'Skill' ? '工作方法' : '项目经验'}</span>
              <h3>{selected.name}</h3>
              <p>{selected.description}</p>
              <p>清晰地记录背景、决定与使用条件，方便下一次工作直接复用。</p>
              <div className="document-tag">
                <Icon name="file" size={14} />
                Markdown 文档
              </div>
            </div>
          ) : (
            <div className="capability-preview">
              <label htmlFor="sample-parameter">
                {selected.kind === 'Terminal'
                  ? '工作目录'
                  : selected.kind === 'HTTP'
                    ? '查询条件'
                    : '页面地址'}
              </label>
              <input
                id="sample-parameter"
                placeholder={
                  selected.kind === 'Terminal'
                    ? '~/Projects/lumi'
                    : selected.kind === 'HTTP'
                      ? '本周业务数据'
                      : 'http://localhost:3000'
                }
              />
              <div className="detail-actions">
                <span className="subtle-label">交互演示 · 示例结果</span>
                <button className="primary-button" onClick={() => setOutput(true)}>
                  预览调用
                  <Icon name="arrow" size={15} />
                </button>
              </div>
              {output && (
                <div className="sample-output">
                  <span>
                    <Icon name="check" size={15} />
                    示例结果
                  </span>
                  <pre>
                    {selected.kind === 'Terminal'
                      ? '> pnpm dev\n\n  Local: http://localhost:3000/\n  Ready in 248 ms'
                      : selected.kind === 'HTTP'
                        ? '{\n  "period": "本周",\n  "records": 128,\n  "format": "dataset"\n}'
                        : '页面已打开\n标题：Lumi 工作台\n截图已保存为示例 Artifact'}
                  </pre>
                </div>
              )}
            </div>
          )}
          <div className="detail-bottom">
            <Icon name="link" size={14} />
            <span>通过统一 Lumi 入口在不同 AI 中复用</span>
          </div>
        </Modal>
      )}

      {overlay?.type === 'connection' && (
        <Modal
          key={`connection-${overlay.name}`}
          title={`连接 ${overlay.name}`}
          close={() => setOverlay(null)}
        >
          <div className="connect-summary">
            <span className="connection-logo">
              <img src={logo} width="48" height="58" alt="Lumi" />
            </span>
            <Icon name="link" />
            <span className="client-monogram">{overlay.name.slice(0, 1)}</span>
          </div>
          <p className="detail-description">
            连接后，{overlay.name} 可以使用 Lumi 中的记忆、技能与已授权能力。
          </p>
          <div className="connection-steps">
            <span>
              <b>1</b>在 AI 软件中添加 Lumi 连接
            </span>
            <span>
              <b>2</b>选择需要同步的 Skills
            </span>
            <span>
              <b>3</b>开始使用你的经验与能力
            </span>
          </div>
          <p className="form-note">当前为连接流程的界面预览。</p>
          <div className="modal-actions">
            <button
              className="primary-button"
              onClick={() => {
                setOverlay(null)
                notify('连接流程已预览')
              }}
            >
              完成预览
              <Icon name="check" size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
