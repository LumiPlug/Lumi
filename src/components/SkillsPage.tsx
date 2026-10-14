// SPDX-License-Identifier: MPL-2.0
import { IconButton, Input, Button, Tabs, SurfaceButton, Card, Badge, Modal, Field } from './ui'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { InstalledSkill, SkillInventory } from '@lumiplug/shared'
import { skillsRequest, openSkillSource } from '../lib/tauri'
import {
  filterInstalledSkills,
  skillAddedTime,
  skillClientOptions,
  skillSourceKey,
  skillImportFailure,
} from '../lib/skills'
import { useToast } from './ToastProvider'
import SkillDetailPage, { type SkillDetail } from './SkillDetailPage'
import './skills.css'

type Tab = 'installed' | 'archived'
const emptyInventory: SkillInventory = {
  skills: [],
  locations: [],
  issues: [],
  scannedAt: null,
  projects: [],
}

function ActionIcon({ action }: { action: 'archive' | 'restore' | 'refresh' | 'close' }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {action === 'refresh' ? (
        <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
      ) : action === 'close' ? (
        <path d="m6 6 12 12M6 18 18 6" />
      ) : (
        <>
          <path d="M4 4h16v4H4zM5 8v12h14V8" />
          {action === 'restore' ? <path d="M12 16v-5m-3 3 3-3 3 3" /> : <path d="M10 12h4" />}
        </>
      )}
    </svg>
  )
}

function SkillCard({
  name,
  description,
  clients,
  addedTime,
  onOpen,
  archiveAction,
}: {
  name: string
  description: string
  clients: string[]
  addedTime: ReturnType<typeof skillAddedTime>
  onOpen: (trigger: HTMLButtonElement) => void
  archiveAction?: { archived: boolean; pending: boolean; disabled: boolean; onClick: () => void }
}) {
  const addedTimeId = useId()
  return (
    <Card
      role="article"
      density="flush"
      interactive
      className={`skill-card${archiveAction ? ' skill-card-archivable' : ''}`}
    >
      <SurfaceButton
        className="skill-card-open"
        type="button"
        aria-label={`查看 ${name} 详情`}
        aria-describedby={addedTimeId}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <span className="skill-card-heading">
          <span className="skill-card-title" title={name}>
            {name}
          </span>
        </span>
        <span className="ui-resource-description skill-description">
          {description || '此技能未提供描述'}
        </span>
        <span className="ui-resource-meta skill-card-date">
          <Badge
            className="skill-client-tag"
            data-source={skillSourceKey(clients[0] ?? '')}
            title={clients.join(' · ')}
          >
            {clients[0] || '本机'}
            {clients.length > 1 ? ` +${clients.length - 1}` : ''}
          </Badge>
          <span id={addedTimeId} title={addedTime.description}>
            {addedTime.dateTime ? (
              <time dateTime={addedTime.dateTime}>{addedTime.text}</time>
            ) : (
              addedTime.text
            )}
          </span>
        </span>
      </SurfaceButton>
      {archiveAction && (
        <IconButton
          className="skill-icon-button skill-archive-button"
          tone="accent"
          glow
          type="button"
          disabled={archiveAction.disabled}
          aria-busy={archiveAction.pending}
          label={`${archiveAction.pending ? '正在保存' : archiveAction.archived ? '恢复' : '归档'} ${name}`}
          title={archiveAction.archived ? '恢复' : '归档'}
          onClick={archiveAction.onClick}
        >
          <ActionIcon action={archiveAction.archived ? 'restore' : 'archive'} />
        </IconButton>
      )}
    </Card>
  )
}

export default function SkillsPage({ active, coreReady }: { active: boolean; coreReady: boolean }) {
  const [tab, setTab] = useState<Tab>('installed')
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!active) setDetail(null)
  }, [active])
  function showDetail(next: SkillDetail, trigger: HTMLButtonElement) {
    detailTrigger.current = trigger
    setDetail(next)
  }
  function closeDetail() {
    setDetail(null)
    requestAnimationFrame(() => detailTrigger.current?.focus({ preventScroll: true }))
  }
  const [filters, setFilters] = useState<Record<Tab, { query: string; client: string }>>({
    installed: { query: '', client: 'all' },
    archived: { query: '', client: 'all' },
  })
  const [inventory, setInventory] = useState<SkillInventory>(emptyInventory)
  const [scanning, setScanning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [importDialog, setImportDialog] = useState(false)
  const [importPath, setImportPath] = useState('')
  const [importError, setImportError] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const importErrorId = useId()
  useEffect(() => {
    if (importDialog && importError && pending === null) importInput.current?.focus()
  }, [importDialog, importError, pending])
  const scanLock = useRef(false)
  const mutationLock = useRef(false)
  const initialized = useRef(false)
  const categoryButtons = useRef(new Map<string, HTMLButtonElement>())
  const showToast = useToast()

  const scan = useCallback(
    async (manual: boolean) => {
      if (scanLock.current || mutationLock.current) return
      scanLock.current = true
      setScanning(true)
      try {
        const next = await skillsRequest('scan')
        setInventory(next)
        setFailed(false)
        if (manual)
          showToast(
            next.issues.length
              ? `扫描完成，${next.issues.length} 处未能完整读取，已保留可用技能`
              : `扫描完成，发现 ${next.skills.filter((item) => item.present).length} 个技能`,
            next.issues.length ? 'error' : 'success',
          )
      } catch {
        setFailed(true)
        showToast('扫描失败，请检查 Core 连接后重新扫描', 'error')
      } finally {
        scanLock.current = false
        setScanning(false)
      }
    },
    [showToast],
  )

  useEffect(() => {
    if (!coreReady) {
      initialized.current = false
      return
    }
    if (!active || initialized.current) return
    initialized.current = true
    void skillsRequest('list')
      .then(setInventory)
      .catch(() => {})
      .then(() => scan(false))
  }, [active, coreReady, scan])

  async function archive(skill: InstalledSkill) {
    if (mutationLock.current || scanLock.current) return
    mutationLock.current = true
    setPending(skill.id)
    try {
      setInventory(await skillsRequest('archive', { id: skill.id, archived: !skill.archived }))
      const category = tab === 'archived' ? 'archived' : filters.installed.client
      categoryButtons.current.get(category)?.focus({ preventScroll: true })
      showToast(
        skill.archived
          ? skill.managed && skill.present && skill.metadataValid
            ? '已恢复，MCP 可搜索和读取此技能'
            : skill.present
              ? '已恢复到已安装'
              : '已移出归档，源文件尚未找到'
          : skill.managed
            ? '已归档，MCP 已停止提供此技能'
            : '已归档，原软件仍可使用此技能',
        'success',
      )
    } catch {
      showToast('归档状态保存失败，请检查 Core 连接后重试', 'error')
    } finally {
      mutationLock.current = false
      setPending(null)
    }
  }

  async function importSkill(skill?: InstalledSkill) {
    if (mutationLock.current || scanLock.current || !coreReady) return
    if (!skill && !importPath.trim()) {
      const message = '请输入包含 SKILL.md 的完整本地目录'
      setImportError(message)
      showToast(message, 'error')
      importInput.current?.focus()
      return
    }
    mutationLock.current = true
    setPending(skill?.id ?? 'import-directory')
    setImportError('')
    try {
      const next = await skillsRequest(
        'import',
        skill ? { id: skill.id } : { directory: importPath.trim() },
      )
      setInventory(next)
      setImportDialog(false)
      setImportPath('')
      setDetail(null)
      setFilters((previous) => ({ ...previous, installed: { query: '', client: 'Lumi' } }))
      setTab('installed')
      requestAnimationFrame(() =>
        categoryButtons.current.get('Lumi')?.focus({ preventScroll: true }),
      )
      showToast('已导入 Lumi，外部 AI 可通过 MCP 搜索和读取；原文件已保留', 'success')
    } catch (error) {
      const message = skillImportFailure(error)
      showToast(message, 'error')
      if (!skill) {
        setImportError(message)
        importInput.current?.focus()
      }
    } finally {
      mutationLock.current = false
      setPending(null)
    }
  }

  async function openSource(id: string, url: string) {
    if (opening) return
    setOpening(id)
    try {
      await openSkillSource(url)
    } catch {
      showToast('无法打开来源，请检查系统默认浏览器', 'error')
    } finally {
      setOpening(null)
    }
  }

  if (!active) return null
  const filter = filters[tab]
  const installed = inventory.skills.filter((item) => item.present && !item.archived)
  const archived = inventory.skills.filter((item) => item.archived)
  const current = tab === 'archived' ? archived : installed
  const visible = filterInstalledSkills(current, filter.query, filter.client)
  const clients = [
    ...new Set([...installed, ...archived].flatMap((item) => item.sources.map((s) => s.client))),
  ].sort()
  const updateFilter = (patch: Partial<typeof filter>) =>
    setFilters((previous) => ({ ...previous, [tab]: { ...previous[tab], ...patch } }))
  const sourceOptions = [
    { value: 'all', label: '全部来源' },
    { value: 'Lumi', label: 'Lumi 托管' },
    ...skillClientOptions(
      clients.filter((client) => client !== 'Lumi'),
      filters.installed.client,
    ).filter((option) => option.value !== 'Lumi'),
    { value: 'archived', label: '已归档' },
  ]
  const category = tab === 'archived' ? 'archived' : filter.client
  const categoryId = (value: string) => `skills-category-${encodeURIComponent(value)}`
  const selectCategory = (value: string) => {
    if (value === 'archived') setTab('archived')
    else {
      setFilters((previous) => ({
        ...previous,
        installed: { ...previous.installed, client: value },
      }))
      setTab('installed')
    }
  }
  const busy = scanning || pending !== null
  const count = visible.length
  const total = current.length
  return (
    <div className="skills-page">
      <h1 className="sr-only">Skills</h1>
      <div className="skills-overview" hidden={detail !== null}>
        <div className="skills-toolbar ui-list-toolbar">
          <div className="ui-list-toolbar-heading">
            <Tabs
              className="skills-source-tabs ui-list-toolbar-tabs"
              label="技能分类"
              value={category}
              items={sourceOptions.map((item) => ({
                ...item,
                id: categoryId(item.value),
                panelId: 'skills-panel',
              }))}
              onValueChange={selectCategory}
              buttonRef={(element, index) => {
                const value = sourceOptions[index]!.value
                if (element) categoryButtons.current.set(value, element)
                else categoryButtons.current.delete(value)
              }}
            />
            <Button
              disabled={busy || !coreReady}
              onClick={() => {
                setImportError('')
                setImportDialog(true)
              }}
            >
              导入目录
            </Button>
          </div>
          <div className="ui-list-toolbar-filters">
            <Input
              className="skills-search ui-list-toolbar-search"
              aria-label="搜索技能"
              type="search"
              placeholder="名称、用途、软件或路径"
              value={filter.query}
              onChange={(event) => updateFilter({ query: event.target.value })}
            />
            <IconButton
              className="skill-icon-button skill-refresh-button"
              type="button"
              disabled={busy || !coreReady}
              label={scanning ? '正在扫描技能' : '重新扫描技能'}
              aria-busy={scanning}
              title={scanning ? '扫描中…' : '重新扫描'}
              onClick={() => void scan(true)}
            >
              <ActionIcon action="refresh" />
            </IconButton>
          </div>
        </div>
        <section
          id="skills-panel"
          role="tabpanel"
          aria-labelledby={categoryId(category)}
          tabIndex={0}
          aria-busy={scanning}
        >
          <div className="skills-list-scroll" tabIndex={0} role="region" aria-label="技能列表内容">
            {(!coreReady || failed) && (
              <div className="skills-connection-note">
                {!coreReady
                  ? '本机扫描需要 Lumi 桌面应用及可用的 Core 连接。'
                  : '本次扫描未完成。已有列表已保留，请重新扫描。'}
              </div>
            )}
            <div className="skills-grid">
              {visible.map((skill) => (
                <SkillCard
                  key={skill.id}
                  name={skill.name}
                  description={skill.description}
                  addedTime={skillAddedTime(skill)}
                  clients={[...new Set(skill.sources.map((source) => source.client))].sort(
                    (a, b) => Number(b === filter.client) - Number(a === filter.client),
                  )}
                  onOpen={(trigger) => showDetail({ kind: 'installed', skill }, trigger)}
                  archiveAction={{
                    archived: skill.archived,
                    pending: pending === skill.id,
                    disabled: busy || !coreReady,
                    onClick: () => void archive(skill),
                  }}
                />
              ))}
              {scanning && !inventory.scannedAt && (
                <div className="empty-state" role="status">
                  <strong>正在扫描本机技能…</strong>
                  <p>读取标准技能目录，完成后将在此显示。</p>
                </div>
              )}
              {count === 0 && !(scanning && !inventory.scannedAt) && (
                <div className="empty-state">
                  <strong>
                    {total > 0
                      ? '没有匹配的技能'
                      : tab === 'archived'
                        ? '还没有归档的技能'
                        : '尚未发现技能'}
                  </strong>
                  <p>
                    {total > 0
                      ? '试试其他关键词或软件来源。'
                      : tab === 'archived'
                        ? '在软件分类的技能卡片中选择“归档”，可将技能收起到这里。'
                        : filter.client === 'Lumi'
                          ? '选择“导入目录”，或打开已扫描技能的详情并选择“导入 Lumi”。托管后可通过 MCP 使用。'
                          : '重新扫描本机技能，在详情中选择“导入 Lumi”，或选择“导入目录”安装本地技能。'}
                  </p>
                  {total > 0 ? (
                    <Button
                      className="type-button"
                      type="button"
                      onClick={() => {
                        updateFilter({ query: '', client: 'all' })
                      }}
                    >
                      清除筛选
                    </Button>
                  ) : tab === 'archived' ? (
                    <Button
                      className="type-button"
                      type="button"
                      onClick={() => selectCategory('all')}
                    >
                      查看本机技能
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      {detail && (
        <SkillDetailPage
          detail={detail}
          opening={opening !== null}
          onClose={closeDetail}
          onSource={(skill) => void openSource(skill.id, skill.url)}
          onImport={(skill) => void importSkill(skill)}
          importing={pending === detail.skill.id}
          importDisabled={busy || !coreReady}
        />
      )}
      {importDialog && (
        <Modal
          title="导入技能到 Lumi"
          onClose={() => setImportDialog(false)}
          busy={pending !== null}
          initialFocus={importInput}
          actions={(close) => (
            <>
              <Button disabled={pending !== null} onClick={close}>
                取消
              </Button>
              <Button
                variant="primary"
                loading={pending === 'import-directory'}
                loadingLabel="导入中…"
                disabled={!coreReady}
                type="submit"
                form="skill-import-form"
              >
                导入 Lumi
              </Button>
            </>
          )}
        >
          <form
            id="skill-import-form"
            onSubmit={(event) => {
              event.preventDefault()
              void importSkill()
            }}
          >
            <Field
              label="技能目录"
              controlWidth="wide"
              description="填写包含 SKILL.md 的完整本地目录。复制说明和附件到 Lumi，保留原文件；导入后可通过 MCP 搜索和读取。"
            >
              <Input
                ref={importInput}
                value={importPath}
                disabled={pending !== null}
                aria-invalid={!!importError}
                aria-describedby={importError ? importErrorId : undefined}
                onChange={(event) => {
                  setImportPath(event.target.value)
                  setImportError('')
                }}
              />
            </Field>
            {importError && (
              <span id={importErrorId} className="sr-only">
                {importError}
              </span>
            )}
          </form>
        </Modal>
      )}
    </div>
  )
}
