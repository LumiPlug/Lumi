// SPDX-License-Identifier: MPL-2.0
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { activityEvent, windowIsActive } from '../../lib/window-activity'

export type MotionValues = Record<string, number | null>
export function dataMotionSignature(values: MotionValues): string {
  return JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  )
}
export function interpolateData(
  from: MotionValues,
  to: MotionValues,
  progress: number,
): MotionValues {
  const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3)
  return Object.fromEntries(
    Object.entries(to).map(([key, value]) => {
      // Unknown is a data state, never an invented zero. New series may grow from zero.
      if (value === null || from[key] === null) return [key, value]
      const initial = from[key] ?? 0
      return [key, initial + (value - initial) * eased]
    }),
  )
}
export function startDataMotion(
  from: MotionValues,
  to: MotionValues,
  duration: number,
  draw: (values: MotionValues) => void,
): () => void {
  let frame = 0,
    start: number | undefined,
    stopped = false
  const tick = (now: number) => {
    if (stopped) return
    start ??= now
    const progress = Math.min(1, (now - start) / Math.max(1, duration))
    draw(progress === 1 ? to : interpolateData(from, to, progress))
    if (progress < 1) frame = requestAnimationFrame(tick)
  }
  draw(interpolateData(from, to, 0))
  frame = requestAnimationFrame(tick)
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
  }
}

/** Presentation only: callers retain final values for accessible labels, selection and totals. */
export function useAnimatedValues(
  values: MotionValues,
  enabled: boolean,
  element: RefObject<Element | null>,
): MotionValues {
  const signature = useMemo(() => dataMotionSignature(values), [values])
  const [display, setDisplay] = useState(values)
  const current = useRef(values)
  const target = useRef(values)
  target.current = values
  useLayoutEffect(() => {
    const next = target.current
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    let cancel = () => {}
    const draw = (value: MotionValues) => {
      current.current = value
      setDisplay(value)
    }
    const finish = () => {
      cancel()
      draw(next)
    }
    const preference = () => {
      if (media.matches) finish()
    }
    const visibility = () => {
      if (!windowIsActive()) finish()
    }
    const unchanged = dataMotionSignature(current.current) === dataMotionSignature(next)
    if (!enabled || media.matches || !windowIsActive() || unchanged) draw(next)
    else {
      const duration = getComputedStyle(element.current ?? document.documentElement)
        .getPropertyValue('--lumi-motion-progress')
        .trim()
      const milliseconds = parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000)
      if (Number.isFinite(milliseconds) && milliseconds > 0)
        cancel = startDataMotion(current.current, next, milliseconds, draw)
      else draw(next)
    }
    media.addEventListener('change', preference)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener(activityEvent, visibility)
    return () => {
      cancel()
      media.removeEventListener('change', preference)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener(activityEvent, visibility)
    }
  }, [signature, enabled, element])
  return enabled ? display : values
}
