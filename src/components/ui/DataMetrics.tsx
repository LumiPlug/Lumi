// SPDX-License-Identifier: MPL-2.0
import { t, useLocale, getLocale } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Button } from './controls'
import { paginationItems } from './pagination'
import type { CSSProperties } from 'react'
import type { DataTone } from './DataDashboard'
import type { ReactNode } from 'react'
import { useAnimatedValues } from './data-motion'

export function AnimatedNumber({
  value,
  format = (number) =>
    number === null ? t('未知') : Math.round(number).toLocaleString(getLocale()),
  animate = true,
}: {
  value: number | null
  format?: (value: number | null) => string
  animate?: boolean
}) {
  useLocale()

  const element = useRef<HTMLSpanElement>(null)
  const display = useAnimatedValues({ value }, animate, element)
  return (
    <span ref={element} className="ui-animated-number">
      <span className="ui-animated-number-value" aria-hidden="true">
        {format(display.value ?? null)}
      </span>
      <span className="ui-animated-number-measure" aria-hidden="true">
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}

export function MetricPair({
  first,
  second,
}: {
  first: { label: string; value: ReactNode; exact?: string; tone?: DataTone }
  second: { label: string; value: ReactNode; exact?: string; tone?: DataTone }
}) {
  useLocale()

  return (
    <div className="ui-metric-pair">
      <dl>
        <dt>{first.label}</dt>
        <dd className={`ui-tone--${first.tone ?? 'accent'}`} title={first.exact}>
          {first.value}
        </dd>
      </dl>
      <span className="ui-metric-pair-divider" aria-hidden="true">
        /
      </span>
      <dl>
        <dt>{second.label}</dt>
        <dd className={`ui-tone--${second.tone ?? 'protocol'}`} title={second.exact}>
          {second.value}
        </dd>
      </dl>
    </div>
  )
}
export interface RingItem {
  key: string
  label: string
  value: number | null
  tone: DataTone
}
/** One data transition from equal shares to measured shares; no decorative looping. */
export function DistributionRing({ items, label }: { items: RingItem[]; label: string }) {
  useLocale()

  const svg = useRef<SVGSVGElement>(null)
  const [progress, setProgress] = useState(1)
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const known = items.every((item) => item.value !== null)
  const animate = known && total > 0 && items.length > 1
  const signature = items.map((item) => `${item.key}:${item.value}`).join('|')
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    if (!animate || media.matches) {
      setProgress(1)
      return
    }
    let frame = 0,
      start: number | undefined
    const value = getComputedStyle(svg.current!).getPropertyValue('--lumi-motion-progress').trim()
    const duration = Math.max(1, parseFloat(value) * (value.endsWith('ms') ? 1 : 1000) || 900)
    const stop = () => {
      cancelAnimationFrame(frame)
      setProgress(1)
    }
    function draw(now: number) {
      start ??= now
      const ratio = Math.min(1, (now - start) / duration)
      setProgress(1 - Math.pow(1 - ratio, 3))
      if (ratio < 1) frame = requestAnimationFrame(draw)
    }
    setProgress(0)
    frame = requestAnimationFrame(draw)
    media.addEventListener('change', stop)
    return () => {
      cancelAnimationFrame(frame)
      media.removeEventListener('change', stop)
    }
  }, [signature, animate])
  const positive = [...items]
    .filter((item) => (item.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const slices =
    positive.length > 4
      ? [
          ...positive.slice(0, 3),
          {
            key: 'others',
            label: t('其他 {v0} 款', { v0: positive.length - 3 }),
            value: positive.slice(3).reduce((sum, item) => sum + (item.value ?? 0), 0),
            tone: 'neutral' as const,
          },
        ]
      : items
  let offset = 0
  const summary = !known
    ? t('用量占比未知')
    : total === 0
      ? '0 Token'
      : items
          .map((item) => `${item.label} ${(((item.value ?? 0) / total) * 100).toFixed(1)}%`)
          .join('，')
  return (
    <svg
      ref={svg}
      className="ui-distribution-ring"
      viewBox="0 0 300 88"
      role="img"
      aria-label={`${label}：${summary}`}
    >
      <title>{summary}</title>
      <circle className="ui-ring-track" cx="150" cy="44" r="28" />
      {known && total > 0 && (
        <g transform="rotate(-90 150 44)">
          {slices.map((item) => {
            const share = (1 - progress) / slices.length + (progress * (item.value ?? 0)) / total
            const begin = offset
            offset += share
            return (
              <circle
                key={item.key}
                className={`ui-ring-segment ui-tone--${item.tone}`}
                cx="150"
                cy="44"
                r="28"
                pathLength="100"
                strokeDasharray={`${share * 100} ${100 - share * 100}`}
                strokeDashoffset={-begin * 100}
              />
            )
          })}
        </g>
      )}
      {known && total > 0 ? (
        (() => {
          let cumulative = 0
          const labels = slices
            .map((item) => {
              const fraction = (item.value ?? 0) / total
              const angle =
                slices.filter((entry) => (entry.value ?? 0) > 0).length === 1
                  ? 0
                  : (cumulative + fraction / 2) * Math.PI * 2 - Math.PI / 2
              cumulative += fraction
              return {
                item,
                fraction,
                x: Math.cos(angle),
                y: Math.sin(angle),
                labelY: 44 + Math.sin(angle) * 32,
              }
            })
            .filter((entry) => entry.fraction > 0)
          for (const right of [false, true]) {
            const side = labels
              .filter((entry) => entry.x >= 0 === right)
              .sort((a, b) => a.labelY - b.labelY)
            side.forEach((entry, index) => {
              entry.labelY = Math.max(
                16 + index * 28,
                Math.min(70 - (side.length - 1 - index) * 28, entry.labelY),
              )
            })
          }
          return labels.map(({ item, fraction, x, y, labelY }) => {
            const right = x >= 0,
              end = right ? 202 : 98,
              text = right ? 208 : 92
            return (
              <g key={item.key} className={`ui-tone--${item.tone}`}>
                <polyline
                  className="ui-ring-leader"
                  points={`${150 + x * 33},${44 + y * 33} ${150 + x * 40},${labelY} ${end},${labelY}`}
                />
                <text
                  className="ui-ring-label"
                  x={text}
                  y={labelY - 3}
                  textAnchor={right ? 'start' : 'end'}
                >
                  {item.label}
                </text>
                <text
                  className="ui-ring-value"
                  x={text}
                  y={labelY + 13}
                  textAnchor={right ? 'start' : 'end'}
                >
                  {(fraction * 100).toFixed(1)}%
                </text>
              </g>
            )
          })
        })()
      ) : (
        <text className="ui-ring-label" x="150" y="49" textAnchor="middle">
          {known ? '0' : t('未知')}
        </text>
      )}
    </svg>
  )
}
export function Pagination({
  page,
  total,
  pageSize,
  busy = false,
  onPageChange,
}: {
  page: number
  total: number
  pageSize: number
  busy?: boolean
  onPageChange: (page: number) => void
}) {
  useLocale()

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const visible = paginationItems(page, pages)
  return (
    <nav className="ui-pagination" aria-label={t('会话分页')}>
      <span className="ui-pagination-summary" role="status">
        {t('共 {v0} 个 · 第 {v1} / {v2} 页', {
          v0: total.toLocaleString(getLocale()),
          v1: page,
          v2: pages,
        })}
      </span>
      <div style={{ '--ui-pagination-digits': String(pages).length } as CSSProperties}>
        <Button variant="text" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>
          {t('上一页')}
        </Button>
        {visible.map((value) => (
          <span className="ui-pagination-step" key={value}>
            {typeof value === 'number' ? (
              <Button
                disabled={busy}
                aria-label={t('第 {v0} 页', { v0: value })}
                aria-current={value === page ? 'page' : undefined}
                variant="text"
                onClick={() => onPageChange(value)}
              >
                {value}
              </Button>
            ) : (
              <span aria-hidden="true">…</span>
            )}
          </span>
        ))}
        <Button
          variant="text"
          disabled={busy || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('下一页')}
        </Button>
      </div>
    </nav>
  )
}
