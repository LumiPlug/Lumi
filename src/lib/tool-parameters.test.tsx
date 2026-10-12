// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CapabilityField, JsonSchema, JsonValue } from '@lumiplug/shared'
import { TerminalParameters } from '../components/TerminalParameters'
import {
  moveParameter,
  parameterDefaultText,
  parseParameterDefault,
  setParameterVisibility,
} from './tool-parameters'

const field = (schema: JsonSchema): CapabilityField => ({
  key: 'VALUE',
  schema,
  required: false,
  aiVisible: true,
  value: null,
  binding: { location: 'argument', key: 'VALUE' },
})
describe('terminal parameter defaults', () => {
  it('retains numeric, boolean, array and object types when editing existing defaults', () => {
    for (const [type, value] of [
      ['integer', 3],
      ['number', 0.25],
      ['boolean', false],
      ['array', ['演示']],
      ['object', { nested: 1 }],
      ['null', null],
    ] as Array<[JsonSchema['type'], JsonValue]>) {
      const parameter = field({ type, default: value })
      expect(parseParameterDefault(parameter, parameterDefaultText(parameter))).toEqual(value)
    }
  })
  it('keeps text literal and removes a default when the input is cleared', () => {
    const parameter = field({ type: 'string', default: 'false' })
    expect(parseParameterDefault(parameter, 'false')).toBe('false')
    expect(parseParameterDefault(parameter, '')).toBeUndefined()
    expect(parameterDefaultText(field({ type: 'string' }))).toBe('')
  })
  it('rejects malformed values and values of the wrong type', () => {
    for (const [type, text] of [
      ['integer', '1.2'],
      ['number', '1e999'],
      ['boolean', '"false"'],
      ['array', '{}'],
      ['object', '[]'],
      ['object', '{broken'],
    ] as const) {
      expect(() => parseParameterDefault(field({ type }), text)).toThrow()
    }
  })
  it('round trips union string defaults and reads private values without publicizing them', () => {
    const union = field({ type: ['string', 'null'], default: 'hello' })
    expect(parseParameterDefault(union, parameterDefaultText(union))).toBe('hello')
    const fixed = {
      ...field({ type: 'string', default: 'public-fallback' }),
      aiVisible: false,
      value: 'private-value',
    }
    expect(parameterDefaultText(fixed)).toBe('private-value')
  })
  it('renders a single semantic header with visibility, row-specific inputs and grouped actions', () => {
    const html = renderToStaticMarkup(
      <TerminalParameters
        fields={[
          field({ type: 'string', title: '名称一' }),
          field({ type: 'integer', default: 3 }),
        ]}
        change={() => {}}
      />,
    )
    expect(html.match(/scope="col"/g)).toHaveLength(6)
    expect(html.match(/aria-label="参数 \d 外部可见"[^>]*checked=""/g)).toHaveLength(2)
    expect(html).toContain('aria-label="参数 1 参数名"')
    expect(html).toContain('aria-label="参数 2 参数值"')
    expect(html).toContain('value="3"')
    expect(html).toContain('aria-label="删除参数 VALUE"')
    expect(html).toContain('aria-label="排序参数 1：VALUE"')
    expect(html).not.toContain('使用默认值')
    expect(html).not.toContain('aria-label="参数 1 名称"')
    expect(html).not.toContain('>编辑<')
    expect(html).toContain('tools-parameter-viewport')
    expect(html).toContain('>外部可见<')
    expect(html).toContain('>描述<')
    expect(html).not.toContain('>操作<')
    expect(html).toContain('>必填<')
    expect(html).not.toContain('可编辑')
    expect(html).toContain('lucide-grip-vertical')
  })
})

describe('parameter ordering', () => {
  it('moves complete public and private records in either direction without changing data', () => {
    const first = field({ type: 'integer', title: '次数', default: 3 })
    const second = field({ type: 'object', default: { nested: [false] } })
    const fixed = { ...field({ type: 'string' }), aiVisible: false, value: 'fixed-value' }
    const original = [first, second, fixed]
    const moved = moveParameter(original, 2, 0)
    expect(moved).toEqual([fixed, first, second])
    expect(moved[0]).toBe(fixed)
    expect(original).toEqual([first, second, fixed])
    expect(moveParameter(moved, 0, 2)).toEqual(original)
  })
  it('leaves identity untouched for boundaries, empty lists and the current position', () => {
    const original = [field({ type: 'boolean', default: false })]
    for (const [from, to] of [
      [0, 0],
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [0.5, 0],
    ]) {
      expect(moveParameter(original, from!, to!)).toBe(original)
    }
    const empty: number[] = []
    expect(moveParameter(empty, 0, 0)).toBe(empty)
  })
})

describe('parameter visibility', () => {
  it('moves typed defaults into private values and removes the public default', () => {
    for (const value of ['text', 0, false, { nested: [1] }] as JsonValue[]) {
      const original = field({ type: 'string', default: value })
      const hidden = setParameterVisibility(original, false)
      expect(hidden.aiVisible).toBe(false)
      expect(hidden.value).toEqual(value)
      expect(hidden.schema).not.toHaveProperty('default')
      expect(setParameterVisibility(hidden, true)).toEqual(original)
      expect(original.schema.default).toEqual(value)
    }
  })
  it('does not introduce defaults for blank private strings and retains nullable defaults', () => {
    const hidden = { ...field({ type: 'string' }), aiVisible: false }
    expect(setParameterVisibility(hidden, true).schema).not.toHaveProperty('default')
    const nullable = { ...hidden, schema: { type: ['string', 'null'] } as JsonSchema }
    expect(setParameterVisibility(nullable, true).schema.default).toBeNull()
    expect(setParameterVisibility(hidden, false)).toBe(hidden)
  })
})
