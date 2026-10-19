// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../../i18n'
import { useId } from 'react'
import type { ReactNode } from 'react'

export type StageState = 'current' | 'past' | 'pending'
export type StageStatus = 'current' | 'completed' | 'failed' | 'running' | 'pending'
/** Execution state and browsing expansion are intentionally independent. */
export function StageSection({
  title,
  state,
  expanded = false,
  onExpandedChange,
  summary,
  children,
  pendingLabel = t('尚未开始'),
  action,
  status = state === 'past' ? 'completed' : state,
  statusLabel,
}: {
  title: string
  state: StageState
  status?: StageStatus
  statusLabel?: string
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  action?: ReactNode
  pendingLabel?: string
  summary?: ReactNode
  children?: ReactNode
}) {
  useLocale()

  const titleId = useId()
  const panelId = useId()
  const open = state === 'current' || (state === 'past' && expanded)
  const label = (
    <>
      <svg
        className="ui-stage-marker"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r={status === 'running' ? '7' : '5'} />
        {status === 'running' && <circle className="ui-stage-spinner" cx="8" cy="8" r="3.5" />}
      </svg>
      <span className="ui-stage-title">{title}</span>
      <span className="ui-stage-status" role="status" aria-live="polite">
        {statusLabel ??
          {
            current: t('当前阶段'),
            completed: t('已执行'),
            failed: t('失败'),
            running: t('运行中'),
            pending: pendingLabel,
          }[status]}
      </span>
      {state === 'past' && (
        <svg
          className="ui-stage-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      )}
    </>
  )
  return (
    <section className="ui-stage" data-state={state} data-status={status}>
      <h3 id={titleId} className="ui-stage-heading">
        {state === 'past' ? (
          <button
            type="button"
            className="ui-stage-trigger"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => onExpandedChange?.(!open)}
          >
            {label}
          </button>
        ) : (
          <span className="ui-stage-label" aria-current={state === 'current' ? 'step' : undefined}>
            {label}
            {state === 'current' && action}
          </span>
        )}
      </h3>
      {state === 'past' && !open && summary && <div className="ui-stage-summary">{summary}</div>}
      <div
        id={panelId}
        role="region"
        aria-labelledby={titleId}
        className="ui-stage-content"
        hidden={!open}
      >
        {state !== 'pending' && children}
      </div>
    </section>
  )
}
