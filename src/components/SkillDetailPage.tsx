// SPDX-License-Identifier: MPL-2.0
import { IconButton, Button, SurfaceButton } from './ui'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  InstalledSkill,
  SkillDirectory,
  SkillFileEntry,
  SkillFilePreview,
  SkillSource,
} from '@lumiplug/shared'
import type { MarketSkill } from '../lib/skills'
import { getSkillDirectory, getSkillFile, openSkillLink } from '../lib/tauri'
import { resolveSkillDocumentLink, skillFileFailure, splitSkillMarkdown } from '../lib/skill-files'
import { copyText } from '../lib/clipboard'
import { useToast } from './ToastProvider'

export type SkillDetail =
  { kind: 'installed'; skill: InstalledSkill } | { kind: 'market'; skill: MarketSkill }
const scopes: Record<SkillSource['scope'], string> = {
  personal: '个人',
  project: '项目',
  plugin: '插件',
}

function FileIcon({ folder = false }: { folder?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {folder ? (
        <path d="M3 7V5h6l2 2h10v13H3z" />
      ) : (
        <>
          <path d="M6 3h8l4 4v14H6zM14 3v5h4" />
          <path d="M9 12h6M9 16h6" />
        </>
      )}
    </svg>
  )
}

function SkillFileTree({
  entries,
  selected,
  onSelect,
}: {
  entries: SkillFileEntry[]
  selected: string
  onSelect: (entry: SkillFileEntry) => void
}) {
  return (
    <ul className="skill-file-tree">
      {entries.map((entry) => (
        <li key={entry.path}>
          {entry.kind === 'directory' ? (
            <details open={selected.startsWith(`${entry.path}/`) || undefined}>
              <summary title={entry.path}>
                <FileIcon folder />
                <span>{entry.name}</span>
              </summary>
              {entry.note && <p className="skill-file-note">{entry.note}</p>}
              {entry.children?.length ? (
                <SkillFileTree entries={entry.children} selected={selected} onSelect={onSelect} />
              ) : (
                <p className="skill-file-note">此处没有可预览文件</p>
              )}
            </details>
          ) : (
            <SurfaceButton
              type="button"
              className={`skill-file-button ${entry.path === selected ? 'skill-file-selected' : ''}`}
              aria-current={entry.path === selected ? 'page' : undefined}
              title={entry.path}
              onClick={() => onSelect(entry)}
            >
              <FileIcon />
              <span>{entry.name}</span>
            </SurfaceButton>
          )}
        </li>
      ))}
    </ul>
  )
}

function SkillMarkdownImage({
  id,
  current,
  src,
  alt,
}: {
  id?: string
  current: string
  src?: string
  alt?: string
}) {
  const holder = useRef<HTMLSpanElement>(null)
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    const local = src ? resolveSkillDocumentLink(current, src) : null
    if (!id || !local) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void getSkillFile(id, local.path)
        .then((file) => {
          if (cancelled) return
          if (file.kind === 'image' && file.content) setImage(file.content)
          else setFailed(true)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    })
    if (holder.current) observer.observe(holder.current)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [id, current, src])
  return (
    <span ref={holder} className="skill-markdown-image">
      {image ? (
        <img src={image} alt={alt ?? ''} />
      ) : (
        <span className="skill-file-note">
          {alt || '图片'}
          {failed
            ? '（无法预览）'
            : !id || !src || !resolveSkillDocumentLink(current, src)
              ? '（外部图片）'
              : '（加载中…）'}
        </span>
      )}
    </span>
  )
}

export function SkillMarkdown({
  content,
  id,
  current,
  onLink,
}: {
  content: string
  id?: string
  current: string
  onLink: (href: string) => void
}) {
  const markdown = splitSkillMarkdown(content)
  return (
    <div className="skill-markdown ui-reading-content">
      {markdown.header && (
        <details className="skill-frontmatter">
          <summary>文件元信息</summary>
          <pre>
            <code>{markdown.header}</code>
          </pre>
        </details>
      )}
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children, title }) =>
            href ? (
              <a
                href={href}
                title={title}
                onClick={(event) => {
                  event.preventDefault()
                  onLink(href)
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) => (
            <SkillMarkdownImage id={id} current={current} src={src} alt={alt} />
          ),
          table: ({ children }) => (
            <div className="skill-markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown.body}
      </Markdown>
    </div>
  )
}

export default function SkillDetailPage({
  detail,
  opening,
  onClose,
  onSource,
}: {
  detail: SkillDetail
  opening: boolean
  onClose: () => void
  onSource: (skill: MarketSkill) => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const fileRequest = useRef(0)
  const directoryRequest = useRef(0)
  const [directory, setDirectory] = useState<SkillDirectory | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(detail.kind === 'installed')
  const [directoryFailed, setDirectoryFailed] = useState(false)
  const mainFile =
    detail.kind === 'installed' ? detail.skill.path.split(/[\\/]/).pop() || 'SKILL.md' : ''
  const [selected, setSelected] = useState(mainFile)
  const [preview, setPreview] = useState<SkillFilePreview | null>(null)
  const [fileLoading, setFileLoading] = useState(detail.kind === 'installed')
  const [fileFailed, setFileFailed] = useState(false)
  const [fragment, setFragment] = useState('')
  const showToast = useToast()
  const id = detail.kind === 'installed' ? detail.skill.id : null

  const loadFile = useCallback(
    async (relativePath: string) => {
      if (!id) return
      const request = ++fileRequest.current
      setSelected(relativePath)
      setPreview(null)
      setFileLoading(true)
      setFileFailed(false)
      viewport.current?.scrollTo(0, 0)
      try {
        const file = await getSkillFile(id, relativePath)
        if (request === fileRequest.current) setPreview(file)
      } catch (error) {
        if (request === fileRequest.current) {
          setFileFailed(true)
          showToast(skillFileFailure(error), 'error')
        }
      } finally {
        if (request === fileRequest.current) setFileLoading(false)
      }
    },
    [id, showToast],
  )

  const loadDirectory = useCallback(async () => {
    if (!id) return
    const request = ++directoryRequest.current
    setDirectoryLoading(true)
    setDirectoryFailed(false)
    try {
      const files = await getSkillDirectory(id)
      if (request !== directoryRequest.current) return
      setDirectory(files)
      void loadFile(mainFile)
    } catch (error) {
      if (request === directoryRequest.current) {
        setDirectoryFailed(true)
        setFileLoading(false)
        showToast(skillFileFailure(error), 'error')
      }
    } finally {
      if (request === directoryRequest.current) setDirectoryLoading(false)
    }
  }, [id, mainFile, loadFile, showToast])
  useEffect(() => {
    void loadDirectory()
    return () => {
      directoryRequest.current++
      fileRequest.current++
    }
  }, [loadDirectory])

  useEffect(() => {
    if (!fragment || fileLoading) return
    const elements = viewport.current?.querySelectorAll<HTMLElement>('[id], h1, h2, h3, h4, h5, h6')
    const match = [...(elements ?? [])].find(
      (element) =>
        element.id === fragment ||
        element.textContent
          ?.trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .replace(/\s+/g, '-') === fragment,
    )
    match?.scrollIntoView({ block: 'start' })
    setFragment('')
  }, [fragment, fileLoading, preview])

  function selectFile(entry: SkillFileEntry) {
    setFragment('')
    if (entry.kind === 'unavailable') {
      fileRequest.current++
      setSelected(entry.path)
      setFileLoading(false)
      setFileFailed(false)
      setPreview({ path: entry.path, size: 0, kind: 'unsupported' })
      return
    }
    void loadFile(entry.path)
  }
  async function followLink(href: string) {
    if (/^https?:\/\//i.test(href)) {
      try {
        await openSkillLink(href)
      } catch {
        showToast('无法打开链接，请检查默认浏览器', 'error')
      }
      return
    }
    const local = resolveSkillDocumentLink(selected, href)
    if (!id || !local) {
      showToast('此链接未指向可预览的技能文件', 'info')
      return
    }
    setFragment(local.fragment)
    if (local.path !== selected) void loadFile(local.path)
  }
  async function copyPath() {
    const path = directory
      ? `${directory.rootPath}/${selected}`
      : detail.kind === 'installed'
        ? detail.skill.path
        : detail.skill.url
    try {
      if (!(await copyText(path))) throw new Error('copy_failed')
      showToast('文件路径已复制', 'success')
    } catch {
      showToast('复制失败，请从详情中手动复制路径', 'error')
    }
  }
  useLayoutEffect(() => {
    title.current?.focus({ preventScroll: true })
  }, [])
  return (
    <section className="skills-detail" aria-labelledby="skill-detail-title">
      <header className="skill-detail-header">
        <IconButton label="返回技能列表" title="返回" onClick={onClose}>
          <ArrowLeft size={18} />
        </IconButton>
        <h2 id="skill-detail-title" className="ui-detail-heading" ref={title} tabIndex={-1}>
          {detail.skill.name}
        </h2>
        <div className="skill-detail-actions">
          {detail.kind === 'installed' ? (
            <Button className="type-button" type="button" onClick={() => void copyPath()}>
              复制路径
            </Button>
          ) : (
            <Button
              className="type-button"
              type="button"
              disabled={opening}
              onClick={() => onSource(detail.skill)}
            >
              {opening ? '打开中…' : '查看来源（浏览器）'}
            </Button>
          )}
        </div>
      </header>
      <div className="skill-detail-body">
        <nav
          className="skill-directory"
          aria-label={id ? '技能文件目录' : '技能内容'}
          aria-busy={directoryLoading}
        >
          {id ? (
            <>
              {directoryLoading ? (
                <p className="skill-file-note" role="status">
                  正在读取文件目录…
                </p>
              ) : directoryFailed ? (
                <div className="skill-file-state">
                  <p>文件目录暂不可用</p>
                  <Button
                    className="type-button"
                    type="button"
                    onClick={() => void loadDirectory()}
                  >
                    重新读取
                  </Button>
                </div>
              ) : (
                directory && (
                  <>
                    <SkillFileTree
                      entries={directory.entries}
                      selected={selected}
                      onSelect={selectFile}
                    />
                    {directory.truncated && (
                      <p className="skill-file-note">部分大目录或依赖目录未列出</p>
                    )}
                  </>
                )
              )}
              <details className="skill-source-info">
                <summary>来源与状态</summary>
                <p>{detail.skill.description || '此技能未提供描述'}</p>
                {detail.kind === 'installed' && (
                  <>
                    <p>
                      {detail.skill.archived ? '已归档 · ' : ''}
                      {!detail.skill.present ? '未找到源文件 · ' : ''}
                      {!detail.skill.metadataValid ? '信息不完整 · ' : ''}归档仅在 Lumi 中收起
                    </p>
                    <dl>
                      {detail.skill.sources.map((source) => (
                        <div key={`${source.client}-${source.path}`}>
                          <dt>
                            {source.client} · {scopes[source.scope]}
                          </dt>
                          <dd>
                            <code>{source.path}</code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
              </details>
            </>
          ) : (
            <SurfaceButton
              className="skill-file-button skill-file-selected"
              type="button"
              aria-current="page"
            >
              <FileIcon />
              <span>技能介绍</span>
            </SurfaceButton>
          )}
        </nav>
        <section className="skill-file-pane" aria-label="选中文件详情">
          <div className="skill-file-heading">
            <span title={id ? selected : detail.skill.name}>{id ? selected : '技能介绍'}</span>
            {preview && (
              <span>
                {preview.size < 1024 ? `${preview.size} B` : `${Math.ceil(preview.size / 1024)} KB`}
              </span>
            )}
          </div>
          <div
            className="skill-file-preview"
            ref={viewport}
            tabIndex={0}
            aria-label="文件内容"
            aria-busy={fileLoading}
          >
            {!id ? (
              <>
                <SkillMarkdown
                  content={detail.skill.description}
                  current=""
                  onLink={(href) => void followLink(href)}
                />
                <p className="skill-file-note">
                  {detail.kind === 'market' ? `${detail.skill.publisher} · 官方技能` : ''}
                </p>
              </>
            ) : fileLoading ? (
              <p className="skill-file-note" role="status">
                正在读取文件…
              </p>
            ) : directoryFailed ? (
              <p className="skill-file-note">重新读取目录后可查看文件内容。</p>
            ) : fileFailed ? (
              <div className="skill-file-state">
                <p>文件暂不可用</p>
                <Button
                  className="type-button"
                  type="button"
                  onClick={() => void loadFile(selected)}
                >
                  重新读取文件
                </Button>
              </div>
            ) : preview?.kind === 'markdown' ? (
              <SkillMarkdown
                key={selected}
                content={preview.content ?? ''}
                id={id}
                current={selected}
                onLink={(href) => void followLink(href)}
              />
            ) : preview?.kind === 'text' ? (
              <pre className="skill-source-code">
                <code>{preview.content || '（空文件）'}</code>
              </pre>
            ) : preview?.kind === 'image' ? (
              <img className="skill-file-image" src={preview.content} alt={selected} />
            ) : (
              <p className="skill-file-note">
                {preview?.kind === 'too-large'
                  ? '文件超过预览大小限制（文本 256 KB，图片 1 MB）。'
                  : '此文件类型暂不支持预览。'}
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
