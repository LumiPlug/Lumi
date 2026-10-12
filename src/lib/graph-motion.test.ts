// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { advanceGraphFlow } from './graph-motion'

describe('graph flow screen velocity', () => {
  it.each([0.15, 0.5, 1, 3])('keeps the visible 10 pixel per second speed at zoom %s', (zoom) => {
    let offset = 0
    for (let frame = 0; frame < 15; frame++) offset = advanceGraphFlow(offset, 1000 / 60, 10, zoom)
    expect(-offset * zoom * 4).toBeCloseTo(10, 8)
  })

  it.each([0.15, 0.5, 1, 3])('moves 0.6 screen pixels per second at zoom %s', (zoom) => {
    let offset = 0
    for (let frame = 0; frame < 60; frame++) offset = advanceGraphFlow(offset, 1000 / 60, 0.6, zoom)
    expect(-offset * zoom).toBeCloseTo(0.6, 8)
  })

  it.each([30, 60, 120])('has the same velocity at %s frames per second', (fps) => {
    let offset = 0
    for (let frame = 0; frame < fps; frame++) offset = advanceGraphFlow(offset, 1000 / fps, 0.6, 1)
    expect(-offset).toBeCloseTo(0.6, 8)
  })

  it('does not jump after a stalled frame or invalid zoom', () => {
    expect(advanceGraphFlow(-2, 5000, 0.6, 1)).toBeCloseTo(-2.06)
    expect(advanceGraphFlow(-2, 16, 0.6, 0)).toBe(-2)
    expect(advanceGraphFlow(-2, -16, 0.6, 1)).toBe(-2)
  })

  it('wraps continuously across both dash patterns', () => {
    expect(advanceGraphFlow(-23.99, 100, 0.6, 1)).toBeCloseTo(-0.05)
  })
})
