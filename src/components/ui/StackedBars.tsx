// SPDX-License-Identifier: MPL-2.0
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSurfaceDepth } from './SurfaceEffects'
import { Button } from './controls'
import { BarChart3 } from 'lucide-react'
import { useAnimatedValues } from './data-motion'
export interface BarSeries {
  key: string
  label: string
  tone?: 'accent' | 'success' | 'protocol' | 'neutral'
}
export interface BarDay {
  date: string
  label?: string
  values: Record<string, number | null>
  detail?: string
}
/** Token-independent shared chart. All values and callbacks come from its caller. */
export function StackedBars({
  series,
  days,
  onSelect,
  label = '按日用量',
  showHint = true,
  appearance = 'default',
  title,
  animate = false,
}: {
  series: BarSeries[]
  days: BarDay[]
  onSelect: (date: string) => void
  label?: string
  showHint?: boolean
  appearance?: 'default' | 'dashboard'
  title?: string
  animate?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const depth = useSurfaceDepth()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [availableWidth, setAvailableWidth] = useState(600)
  const [dashboardHeight, setDashboardHeight] = useState(200)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      setAvailableWidth(entries[0]?.contentRect.width ?? 600)
      const height = parseFloat(
        getComputedStyle(element).getPropertyValue('--lumi-dashboard-plot-height'),
      )
      if (Number.isFinite(height)) setDashboardHeight(height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [hidden, setHidden] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const visible = useMemo(() => series.filter((s) => !hidden.includes(s.key)), [series, hidden])
  const total = useMemo(
    () => (day: BarDay) => visible.reduce((sum, s) => sum + (day.values[s.key] ?? 0), 0),
    [visible],
  )
  const reportedMaximum = Math.max(0, ...days.map(total)),
    maximum = Math.max(1, reportedMaximum),
    width = Math.max(
      appearance === 'dashboard' ? 360 : 600,
      days.length * (appearance === 'dashboard' ? 14 : 36),
      availableWidth,
    ),
    height = appearance === 'dashboard' ? dashboardHeight : 220
  const seriesClass = (s: BarSeries) =>
    s.tone ? `ui-chart-tone--${s.tone}` : `ui-chart-series-${series.indexOf(s) % 3}`
  const selected = days.find((d) => d.date === hover)
  const targetHeights = useMemo(
    () =>
      Object.fromEntries(
        days.flatMap((day) =>
          visible.map((s) => [
            JSON.stringify([day.date, s.key]),
            day.values[s.key] === null
              ? null
              : ((day.values[s.key] ?? 0) / maximum) * (height - 36),
          ]),
        ),
      ),
    [days, visible, maximum, height],
  )
  const animatedHeights = useAnimatedValues(targetHeights, animate, container)
  useLayoutEffect(() => {
    if (!selected || !svg.current || !tooltip.current) return
    const plot = svg.current.getBoundingClientRect(),
      box = tooltip.current.getBoundingClientRect()
    const index = days.indexOf(selected)
    const x = plot.left + ((index + 0.5) / Math.max(1, days.length)) * plot.width
    const y =
      plot.top +
      ((height - (total(selected) / maximum) * (height - 36)) * plot.height) / (height + 34)
    setPosition({
      left: Math.max(16, Math.min(x - box.width / 2, window.innerWidth - box.width - 16)),
      top: Math.max(16, y - box.height - 10),
    })
    const close = () => {
      setHover(null)
      setPosition(null)
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [selected, days, height, maximum, width, total])
  return (
    <div
      className={`ui-stacked-chart${appearance === 'dashboard' ? ' ui-stacked-chart--dashboard' : ''}`}
    >
      <div className="ui-chart-heading">
        {title && (
          <h2>
            <BarChart3 aria-hidden="true" />
            {title}
          </h2>
        )}
        <div className="ui-chart-legend" aria-label="图例开关">
          {series.map((s) => (
            <Button
              key={s.key}
              variant={appearance === 'dashboard' ? 'text' : 'ghost'}
              aria-pressed={!hidden.includes(s.key)}
              onClick={() =>
                setHidden((v) => (v.includes(s.key) ? v.filter((x) => x !== s.key) : [...v, s.key]))
              }
            >
              <span className={`ui-chart-key ${seriesClass(s)}`} aria-hidden="true" />
              {s.label}
            </Button>
          ))}
        </div>
      </div>
      <div ref={container} className="ui-chart-scroll">
        <svg
          ref={svg}
          role="group"
          aria-label={label}
          viewBox={`0 0 ${width} ${height + 34}`}
          style={{ minWidth: width, height: height + 34 }}
        >
          <text x="0" y="14" className="ui-chart-label">
            {visible.length === 0 ||
            days.some((day) => visible.some((s) => day.values[s.key] != null))
              ? `${reportedMaximum.toLocaleString()} Token`
              : '暂无已报告用量'}
          </text>
          {appearance === 'dashboard' &&
            [0, 1, 2, 3].map((i) => (
              <line
                key={i}
                className="ui-chart-grid"
                x1={0}
                x2={width}
                y1={36 + ((height - 36) * i) / 3}
                y2={36 + ((height - 36) * i) / 3}
              />
            ))}
          {days.map((day, index) => {
            const column = width / Math.max(days.length, 1),
              barWidth = appearance === 'dashboard' ? Math.min(22, column - 4) : column - 8,
              x = index * column + (column - barWidth) / 2
            let bottom = height
            const description = series
              .map((s) => `${s.label} ${day.values[s.key]?.toLocaleString() ?? '未知'}`)
              .join('，')
            return (
              <g
                key={day.date}
                role="button"
                tabIndex={0}
                aria-label={`${day.date}，${description}，查看明细`}
                aria-describedby={hover === day.date ? tooltipId : undefined}
                className="ui-chart-day"
                onFocus={() => setHover(day.date)}
                onBlur={() => setHover(null)}
                onMouseEnter={() => setHover(day.date)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(day.date)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setHover(null)
                    return
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(day.date)
                  }
                }}
              >
                <rect
                  className="ui-chart-target"
                  x={index * column}
                  y="24"
                  width={column}
                  height={height - 24}
                />
                {visible.map((s) => {
                  const h = animatedHeights[JSON.stringify([day.date, s.key])] ?? 0
                  bottom -= h
                  return (
                    <rect
                      key={s.key}
                      className={seriesClass(s)}
                      x={x}
                      y={bottom}
                      width={barWidth}
                      height={h}
                    />
                  )
                })}
                {(days.length <= 7 ||
                  (index % Math.ceil(days.length / 8) === 0 &&
                    days.length - 1 - index >= Math.ceil(days.length / 8)) ||
                  index === days.length - 1) && (
                  <text
                    x={x + barWidth / 2}
                    y={height + 24}
                    textAnchor="middle"
                    className="ui-chart-label"
                  >
                    {day.label ?? day.date.slice(5)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {selected &&
        createPortal(
          <div
            ref={tooltip}
            id={tooltipId}
            role="tooltip"
            data-ui-depth={depth}
            className="ui-tooltip ui-chart-tooltip"
            style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
          >
            <strong>{selected.detail ?? selected.date}</strong>
            {visible.map((s) => (
              <div key={s.key} className="ui-chart-tooltip-row">
                <span>{s.label}</span>
                <span>{selected.values[s.key]?.toLocaleString() ?? '未知'} Token</span>
              </div>
            ))}
          </div>,
          container.current?.closest('dialog') ?? document.body,
        )}
      {showHint && <p className="ui-chart-detail">悬停或聚焦柱形查看详情，点击日期筛选。</p>}
    </div>
  )
}
