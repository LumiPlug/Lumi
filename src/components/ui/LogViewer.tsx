// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../../i18n'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { Button, IconButton } from './controls'
import { ArrowDown } from 'lucide-react'
import {
  terminalOutputLines,
  terminalOutputRuns,
  type TerminalRun,
} from '../../lib/terminal-output'

function StyledRuns({ runs }: { runs: TerminalRun[] }) {
  useLocale()

  return runs.map(({ text, style }, index) => {
    const decoration = [style.underline && 'underline', style.strike && 'line-through']
      .filter(Boolean)
      .join(' ')
    const css: CSSProperties = {
      color: style.inverse ? (style.background ?? 'var(--input)') : style.foreground,
      backgroundColor: style.inverse ? (style.foreground ?? 'var(--text)') : style.background,
      fontWeight: style.bold ? 700 : undefined,
      fontStyle: style.italic ? 'italic' : undefined,
      opacity: style.dim ? 'var(--lumi-terminal-dim-opacity)' : undefined,
      textDecoration: decoration || undefined,
    }
    return (
      <span key={index} style={css}>
        {text}
      </span>
    )
  })
}
/** Shared ANSI rendering for existing inline output surfaces. */
export function TerminalText({ text }: { text: string }) {
  useLocale()

  const runs = useMemo(() => terminalOutputRuns(text), [text])
  return <StyledRuns runs={runs} />
}

/** A bounded-height output viewport. Line numbers are excluded from copying and speech. */
export function LogViewer({
  text,
  label = t('运行日志'),
  emptyLabel = t('等待输出…'),
  autoScroll = true,
  onFollowChange,
  headerAction,
  overlayAction,
  title,
  variant = 'log',
  numbered = true,
  size = 'default',
  format = 'text',
}: {
  text: string
  label?: string
  emptyLabel?: string
  autoScroll?: boolean
  onFollowChange?: (following: boolean) => void
  title?: string
  headerAction?: ReactNode
  overlayAction?: ReactNode
  variant?: 'log' | 'result'
  numbered?: boolean
  size?: 'default' | 'combined' | 'fill'
  format?: 'text' | 'terminal'
}) {
  useLocale()

  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [paused, setPaused] = useState(false)
  const lines = useMemo(() => {
    if (format === 'terminal') return terminalOutputLines(text)
    const result = text.replace(/\r\n/g, '\n').split('\n')
    if (result.length > 1 && result.at(-1) === '') result.pop()
    return result.map((line) => [{ text: line || ' ', style: {} }])
  }, [text, format])
  const pinToBottom = () => {
    const element = viewport.current
    if (element && element.clientHeight > 0) element.scrollTop = element.scrollHeight
  }
  useLayoutEffect(() => {
    if (autoScroll && following.current) pinToBottom()
  }, [text, autoScroll])
  useLayoutEffect(() => {
    const element = viewport.current
    if (!autoScroll || !element) return
    const observer = new ResizeObserver(() => {
      if (following.current) pinToBottom()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [autoScroll])
  return (
    <div
      className={`ui-output ui-output--${variant}${size === 'default' ? '' : ` ui-output--${size}`}${overlayAction ? ' ui-output--overlay' : ''}`}
    >
      {(title || headerAction || (autoScroll && paused && !overlayAction)) && (
        <div className="ui-output-header">
          <span>{title ?? label}</span>
          <div className="ui-output-actions">
            {autoScroll && paused && (
              <Button
                variant="text"
                onClick={() => {
                  following.current = true
                  setPaused(false)
                  onFollowChange?.(true)
                  pinToBottom()
                  viewport.current?.focus({ preventScroll: true })
                }}
              >
                {t('回到最新')}
              </Button>
            )}
            {headerAction}
          </div>
        </div>
      )}
      {overlayAction && <div className="ui-output-overlay">{overlayAction}</div>}
      {overlayAction && autoScroll && paused && (
        <div className="ui-output-follow">
          <IconButton
            label={t('回到最新')}
            iconSize="small"
            onClick={() => {
              following.current = true
              setPaused(false)
              onFollowChange?.(true)
              pinToBottom()
              viewport.current?.focus({ preventScroll: true })
            }}
          >
            <ArrowDown />
          </IconButton>
        </div>
      )}
      <div
        ref={viewport}
        className={`ui-log${numbered ? '' : ' ui-log--plain'}`}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={(event) => {
          if (!autoScroll || !event.currentTarget.clientHeight) return
          const element = event.currentTarget
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24
          following.current = atBottom
          setPaused(!atBottom)
          onFollowChange?.(atBottom)
        }}
      >
        {text ? (
          lines.map((line, index) => (
            <div className="ui-log-line" key={index}>
              {numbered && (
                <span className="ui-log-number" aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <span>{line.length ? <StyledRuns runs={line} /> : ' '}</span>
            </div>
          ))
        ) : (
          <span className="ui-log-empty">{emptyLabel}</span>
        )}
      </div>
    </div>
  )
}
