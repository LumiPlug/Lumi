// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { dataMotionSignature, interpolateData, startDataMotion } from '../components/ui/data-motion'
import { AnimatedNumber } from '../components/ui/DataMetrics'
import { RankingList } from '../components/ui/DataDashboard'
import { StackedBars } from '../components/ui/StackedBars'

afterEach(() => vi.unstubAllGlobals())
function clock() {
  let sequence = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  return {
    frames,
    tick(now: number) {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(now))
    },
  }
}
describe('dashboard data transitions', () => {
  it('keeps token values, percentages and progress-bar fractions on the same animation frame', () => {
    const time = clock(),
      draw = vi.fn()
    startDataMotion({ tokens: 40500, share: 0.68 }, { tokens: 85050, share: 0.92 }, 900, draw)
    time.tick(1000)
    time.tick(1450)
    const frame = draw.mock.calls.at(-1)![0]
    expect((frame.tokens - 40500) / (85050 - 40500)).toBeCloseTo(
      (frame.share - 0.68) / (0.92 - 0.68),
    )
    expect(frame.tokens).toBe(79481.25)
    expect(frame.share).toBeCloseTo(0.89)
    time.tick(1900)
    expect(draw).toHaveBeenLastCalledWith({ tokens: 85050, share: 0.92 })
    expect(time.frames.size).toBe(0)
  })
  it('interpolates both increases and decreases, preserves unknowns and keys new series independently', () => {
    const from = { increasing: 100, decreasing: 80, unknown: null, disappearing: 70, removed: 999 }
    const to = { increasing: 200, decreasing: 20, unknown: 40, disappearing: null, added: 100 }
    expect(interpolateData(from, to, 0)).toEqual({
      increasing: 100,
      decreasing: 80,
      unknown: 40,
      disappearing: null,
      added: 0,
    })
    expect(interpolateData(from, to, 0.5)).toEqual({
      increasing: 187.5,
      decreasing: 27.5,
      unknown: 40,
      disappearing: null,
      added: 87.5,
    })
    expect(interpolateData(from, to, 1)).toEqual(to)
    expect(dataMotionSignature({ a: 1, b: null })).toBe(dataMotionSignature({ b: null, a: 1 }))
    expect(dataMotionSignature({ a: null })).not.toBe(dataMotionSignature({ a: 0 }))
  })
  it('lands on exact values after the configured duration and stops requesting frames', () => {
    const time = clock(),
      draw = vi.fn()
    startDataMotion({ value: 0 }, { value: 100 }, 900, draw)
    time.tick(1000)
    time.tick(1450)
    expect(draw).toHaveBeenLastCalledWith({ value: 87.5 })
    time.tick(1900)
    expect(draw).toHaveBeenLastCalledWith({ value: 100 })
    expect(time.frames.size).toBe(0)
  })
  it('cancels stale frames and resumes a rapid update from the currently displayed value', () => {
    const time = clock()
    let displayed = { value: 0 }
    const draw = vi.fn((value) => {
      displayed = value
    })
    const stop = startDataMotion(displayed, { value: 100 }, 900, draw)
    time.tick(1000)
    time.tick(1450)
    const stale = [...time.frames.values()][0]!
    stop()
    expect(time.frames.size).toBe(0)
    startDataMotion(displayed, { value: 20 }, 900, draw)
    expect(displayed.value).toBe(87.5)
    stale(1900)
    expect(displayed.value).toBe(87.5)
    time.tick(2000)
    time.tick(2900)
    expect(displayed.value).toBe(20)
    expect(time.frames.size).toBe(0)
  })
  it('keeps final accessible data and an exact initial render without requiring client animation', () => {
    const number = renderToStaticMarkup(<AnimatedNumber value={40500} />)
    expect(number).toContain('class="sr-only">40,500</span>')
    expect(renderToStaticMarkup(<AnimatedNumber value={null} />)).toContain(
      'class="sr-only">未知</span>',
    )
    const ranking = renderToStaticMarkup(
      <RankingList
        animate
        label="排行"
        rows={[
          {
            key: 'one',
            label: '模型',
            value: '40.5K',
            numericValue: 40500,
            formatValue: (value) => (value === null ? '未知' : `${value / 1000}K`),
            share: 0.68,
            tone: 'accent',
          },
          { key: 'unknown', label: '未知模型', value: '未知', share: null, tone: 'neutral' },
        ]}
      />,
    )
    expect(ranking).toContain('aria-valuenow="68"')
    expect(ranking).toContain('class="sr-only">40.5K</span>')
    expect(ranking).toContain('class="sr-only">68.0%</span>')
    expect(ranking).toContain('transform:scaleX(0.68)')
    expect(ranking).toContain('aria-valuetext="未知"')
    const chart = renderToStaticMarkup(
      <StackedBars
        animate
        label="趋势"
        series={[{ key: 'one', label: '模型' }]}
        days={[{ date: '2026-10-18', values: { one: 40500 } }]}
        onSelect={() => {}}
      />,
    )
    expect(chart).toContain('2026-10-18，模型 40,500，查看明细')
  })
})
