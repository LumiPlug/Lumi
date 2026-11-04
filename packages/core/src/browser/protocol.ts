// SPDX-License-Identifier: MPL-2.0

import { validateAdvanced } from './advanced-tools'
import { Transform } from 'node:stream'
import type { TransformCallback, Writable } from 'node:stream'

export const MAX_BROWSER_FRAME = 1024 * 1024
export type BrowserMessage = Record<string, unknown>
export const isRecord = (value: unknown): value is BrowserMessage =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** In-process object framing between secure transport and browser service. */
export class BrowserFrames extends Transform {
  private buffer: Buffer = Buffer.alloc(0)
  constructor() {
    super({ readableObjectMode: true })
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk])
      for (;;) {
        const end = this.buffer.indexOf(10)
        if (end < 0) break
        if (end > MAX_BROWSER_FRAME) throw new Error('Browser transport frame exceeds limit')
        const line = this.buffer.subarray(0, end)
        this.buffer = this.buffer.subarray(end + 1)
        if (!line.length) continue
        const message: unknown = JSON.parse(line.toString('utf8'))
        if (!isRecord(message)) throw new Error('Browser transport requires object messages')
        this.push(message)
      }
      if (this.buffer.length > MAX_BROWSER_FRAME)
        throw new Error('Browser transport frame exceeds limit')
      done()
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)))
    }
  }
  override _flush(done: TransformCallback): void {
    done(this.buffer.length ? new Error('Truncated browser transport frame') : undefined)
  }
}

export function writeBrowserFrame(stream: Writable, message: BrowserMessage): void {
  const body = Buffer.from(JSON.stringify(message))
  if (body.length > MAX_BROWSER_FRAME) throw new Error('Browser transport frame exceeds limit')
  if (stream.destroyed || stream.writableLength > 4 * MAX_BROWSER_FRAME)
    throw new Error('Browser transport unavailable or backpressured')
  stream.write(Buffer.concat([body, Buffer.from('\n')]))
}

export type BrowserTool =
  | 'activate_tab'
  | 'close_tab'
  | 'go_back'
  | 'go_forward'
  | 'hover'
  | 'press_key'
  | 'select_option'
  | 'set_checked'
  | 'screenshot'
  | 'click_at'
  | 'open_tab'
  | 'navigate'
  | 'reload'
  | 'list_sessions'
  | 'snapshot'
  | 'read_text'
  | 'click'
  | 'fill'
  | 'scroll'
  | 'wait_for'
export class BrowserError extends Error {
  readonly outcome?: 'unknown'
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    if (code === 'outcome_unknown') this.outcome = 'unknown'
  }
}

export function validateBrowserArguments(
  tool: string,
  value: unknown,
): asserts value is BrowserMessage {
  const advanced = validateAdvanced(tool, value)
  if (advanced !== undefined) {
    if (!advanced) throw new BrowserError('invalid_arguments', 'Invalid advanced browser arguments')
    return
  }
  const keys: Record<BrowserTool, string[]> = {
    activate_tab: ['sessionId'],
    close_tab: ['sessionId'],
    go_back: ['sessionId'],
    go_forward: ['sessionId'],
    hover: ['sessionId', 'ref'],
    press_key: ['sessionId', 'ref', 'key', 'shift'],
    select_option: ['sessionId', 'ref', 'values'],
    set_checked: ['sessionId', 'ref', 'checked'],
    screenshot: ['sessionId'],
    click_at: ['sessionId', 'captureId', 'x', 'y'],
    open_tab: ['url', 'active'],
    navigate: ['sessionId', 'url'],
    reload: ['sessionId'],
    list_sessions: [],
    snapshot: ['sessionId'],
    read_text: ['sessionId', 'ref'],
    click: ['sessionId', 'ref', 'button', 'clickCount'],
    fill: ['sessionId', 'ref', 'text'],
    scroll: ['sessionId', 'ref', 'deltaX', 'deltaY'],
    wait_for: ['sessionId', 'ref', 'text', 'state', 'timeoutMs'],
  }
  if (!Object.hasOwn(keys, tool)) throw new BrowserError('unknown_tool', 'Unsupported browser tool')
  if (!isRecord(value))
    throw new BrowserError('invalid_arguments', 'Browser arguments must be an object')
  const allowed = keys[tool as BrowserTool]
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BrowserError('invalid_arguments', 'Unexpected browser argument')
  const text = (key: string, required: boolean, limit: number, empty = false) => {
    const item = value[key]
    if (item === undefined && !required) return
    if (typeof item !== 'string' || (!empty && !item.length) || item.length > limit)
      throw new BrowserError('invalid_arguments', `Invalid ${key}`)
  }
  if (allowed.includes('url')) text('url', true, 2048)
  if (allowed.includes('sessionId')) text('sessionId', true, 256)
  if (allowed.includes('ref'))
    text(
      'ref',
      ['click', 'fill', 'hover', 'press_key', 'select_option', 'set_checked'].includes(tool),
      256,
    )

  for (const key of ['active', 'shift', 'checked'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new BrowserError('invalid_arguments', `Invalid ${key}`)
  if (tool === 'set_checked' && typeof value.checked !== 'boolean')
    throw new BrowserError('invalid_arguments', 'checked is required')
  if (
    tool === 'press_key' &&
    ![
      'Enter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Space',
    ].includes(value.key as string)
  )
    throw new BrowserError('invalid_arguments', 'Unsupported page key')
  if (
    tool === 'select_option' &&
    (!Array.isArray(value.values) ||
      value.values.length < 1 ||
      value.values.length > 100 ||
      value.values.some((v) => typeof v !== 'string' || v.length > 10000))
  )
    throw new BrowserError('invalid_arguments', 'Provide 1–100 bounded option values')
  if (value.button !== undefined && !['left', 'right', 'middle'].includes(value.button as string))
    throw new BrowserError('invalid_arguments', 'Invalid mouse button')
  if (value.clickCount !== undefined && value.clickCount !== 1 && value.clickCount !== 2)
    throw new BrowserError('invalid_arguments', 'Invalid click count')
  if (tool === 'click_at') {
    text('captureId', true, 256)
    if (![value.x, value.y].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0))
      throw new BrowserError('invalid_arguments', 'Invalid coordinates')
  }
  if (tool === 'fill') text('text', true, 100000, true)
  if (tool === 'wait_for') {
    text('text', false, 10000)
    if (!!value.ref === !!value.text)
      throw new BrowserError('invalid_arguments', 'Provide exactly one of text or ref')
    if (
      value.state !== undefined &&
      (typeof value.state !== 'string' || !['visible', 'hidden'].includes(value.state))
    )
      throw new BrowserError('invalid_arguments', 'Invalid wait state')
    if (
      value.timeoutMs !== undefined &&
      (typeof value.timeoutMs !== 'number' ||
        !Number.isInteger(value.timeoutMs) ||
        value.timeoutMs < 1 ||
        value.timeoutMs > 30000)
    )
      throw new BrowserError('invalid_arguments', 'Invalid wait timeout')
  }
  if (tool === 'scroll')
    for (const key of ['deltaX', 'deltaY']) {
      const delta = value[key]
      if (
        delta !== undefined &&
        (typeof delta !== 'number' || !Number.isFinite(delta) || Math.abs(delta) > 10000)
      )
        throw new BrowserError('invalid_arguments', `Invalid ${key}`)
    }
}
