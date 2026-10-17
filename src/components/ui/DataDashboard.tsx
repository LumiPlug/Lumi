// SPDX-License-Identifier: MPL-2.0
import { Fragment, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from './Field'
import { IconButton, SurfaceButton } from './controls'

export type DataTone = 'accent' | 'success' | 'protocol' | 'neutral'
export function DataText({
  children,
  tone,
  muted = false,
  mono = false,
}: {
  children: ReactNode
  tone?: DataTone
  muted?: boolean
  mono?: boolean
}) {
  return (
    <span
      className={`ui-data-text${tone ? ` ui-tone--${tone} ui-data-text--tone` : ''}${muted ? ' ui-data-text--muted' : ''}${mono ? ' ui-data-text--mono' : ''}`}
    >
      {children}
    </span>
  )
}
export function MetricCard({
  label,
  value,
  exact,
  badge,
  description,
  footer,
  tone = 'neutral',
  highlight = false,
  children,
}: {
  label: string
  value?: ReactNode
  exact?: ReactNode
  badge?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  tone?: DataTone
  highlight?: boolean
}) {
  return (
    <Card className={`ui-metric ui-tone--${tone}${highlight ? ' ui-metric--highlight' : ''}`}>
      <div className="ui-metric-heading">
        <span>
          <i className="ui-data-dot" aria-hidden="true" />
          {label}
        </span>
        {badge}
      </div>
      {children ? (
        <div className="ui-metric-body">{children}</div>
      ) : (
        <div className="ui-metric-value">
          <strong>{value}</strong>
          {exact && (
            <DataText muted mono>
              / {exact}
            </DataText>
          )}
          {description}
        </div>
      )}
      {footer && <div className="ui-metric-footer">{footer}</div>}
    </Card>
  )
}
export function DataPanel({
  title,
  icon,
  actions,
  footer,
  children,
  className = '',
}: {
  title?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={`ui-data-panel ${className}`}>
      {(title || actions) && (
        <div className="ui-data-panel-heading">
          {title && (
            <h2>
              {icon && <span className="ui-data-panel-icon">{icon}</span>}
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
      {footer && <div className="ui-data-panel-footer">{footer}</div>}
    </Card>
  )
}
export function DashboardToolbar({
  children,
  bare = false,
}: {
  children: ReactNode
  bare?: boolean
}) {
  if (bare) return <div className="ui-dashboard-toolbar ui-dashboard-toolbar--bare">{children}</div>
  return (
    <Card density="compact" className="ui-dashboard-toolbar">
      {children}
    </Card>
  )
}
export interface RankingRow {
  key: string
  label: string
  icon?: ReactNode
  value: string
  share: number | null
  tone: DataTone
  detail?: string
  onSelect?: () => void
}
export function RankingList({
  rows,
  label,
  compact = false,
}: {
  rows: RankingRow[]
  label: string
  compact?: boolean
}) {
  return (
    <ul className={`ui-ranking${compact ? ' ui-ranking--compact' : ''}`} aria-label={label}>
      {rows.map((row) => {
        const content = (
          <>
            <span className="ui-ranking-heading">
              <span className="ui-ranking-name">
                {row.icon ?? <i className="ui-data-dot" aria-hidden="true" />}
                {row.label}
              </span>
              <strong>{row.value}</strong>
              <DataText muted mono>
                {row.share === null ? '未知' : `${(row.share * 100).toFixed(1)}%`}
              </DataText>
            </span>
            {row.detail && <DataText muted>{row.detail}</DataText>}
            <span
              className="ui-ranking-track"
              role="meter"
              aria-label={`${row.label}占比`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={row.share === null ? undefined : Math.round(row.share * 100)}
              aria-valuetext={row.share === null ? '未知' : undefined}
            >
              <span style={{ width: `${Math.max(0, Math.min(1, row.share ?? 0)) * 100}%` }} />
            </span>
          </>
        )
        return (
          <li key={row.key} className={`ui-tone--${row.tone}`}>
            {row.onSelect ? (
              <SurfaceButton className="ui-ranking-row" onClick={row.onSelect}>
                {content}
              </SurfaceButton>
            ) : (
              <div className="ui-ranking-row">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
export interface DataColumn<T> {
  key: string
  label: string
  align?: 'end'
  render: (row: T) => ReactNode
}
/** A semantic table with one native keyboard action per row: expand or open. */
export function ExpandableTable<T>({
  label,
  columns,
  rows,
  rowKey,
  rowName,
  renderExpanded,
  onRowOpen,
  empty = '暂无会话',
  busy = false,
  fixedHeight = false,
}: {
  label: string
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  rowName: (row: T) => string
  empty?: ReactNode
  busy?: boolean
  fixedHeight?: boolean
} & (
  | { renderExpanded: (row: T) => ReactNode; onRowOpen?: never }
  | { onRowOpen: (row: T) => void; renderExpanded?: never }
)) {
  const id = useId()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  function toggle(key: string) {
    setExpanded((old) => {
      const next = new Set(old)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  return (
    <div
      className={`ui-data-table-scroll${fixedHeight ? ' ui-data-table-scroll--fixed' : ''}`}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="ui-data-table" aria-label={label} aria-busy={busy || undefined}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.align === 'end' ? 'ui-data-align-end' : undefined}
              >
                {col.label}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">{onRowOpen ? '查看详情' : '展开记录'}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = rowKey(row),
              open = !onRowOpen && expanded.has(key),
              panelId = `${id}-${index}`
            const Chevron = open ? ChevronDown : ChevronRight
            const activate = () => (onRowOpen ? onRowOpen(row) : toggle(key))
            return (
              <Fragment key={key}>
                <tr
                  className="ui-data-table-row"
                  data-row-key={key}
                  data-expanded={open || undefined}
                  onClick={(event) => {
                    if (
                      !(event.target as Element).closest(
                        'button, a, input, select, textarea, label, [role="button"]',
                      )
                    )
                      activate()
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={col.align === 'end' ? 'ui-data-align-end' : undefined}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                  <td>
                    <IconButton
                      label={`${onRowOpen ? '查看' : open ? '收起' : '展开'}${rowName(row)}${onRowOpen ? '的明细' : ''}`}
                      aria-expanded={onRowOpen ? undefined : open}
                      aria-controls={onRowOpen ? undefined : panelId}
                      onClick={activate}
                    >
                      <Chevron aria-hidden="true" />
                    </IconButton>
                  </td>
                </tr>
                {renderExpanded && (
                  <tr hidden={!open} className="ui-data-table-expansion">
                    <td colSpan={columns.length + 1}>
                      <div
                        id={panelId}
                        role="region"
                        tabIndex={0}
                        aria-label={`${rowName(row)}的具体记录`}
                      >
                        {open && renderExpanded(row)}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {!rows.length && (
            <tr>
              <td className="ui-data-table-empty" colSpan={columns.length + 1}>
                {busy ? '正在读取…' : empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
