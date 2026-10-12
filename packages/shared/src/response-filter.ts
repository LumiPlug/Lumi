// SPDX-License-Identifier: MPL-2.0
import type { JsonValue, JsonSchema } from './json'
export function responseFilterSchema(rules: JsonValue): JsonSchema {
  if (typeof rules === 'string') return { type: ['string', 'number', 'boolean', 'null'] }
  if (Array.isArray(rules)) return { type: 'array', items: responseFilterSchema(rules[0]!) }
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(rules ?? {}).map(([key, value]) => [key, responseFilterSchema(value)]),
    ),
    additionalProperties: false,
  }
}
/** Rules mirror JSON; leaves are regular expressions and arrays contain one item template. */
export function validResponseFilter(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false
  if (typeof value === 'string') {
    if (value.length > 512) return false
    try {
      new RegExp(value)
      return true
    } catch {
      return false
    }
  }
  if (Array.isArray(value)) return value.length === 1 && validResponseFilter(value[0], depth + 1)
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.entries(value).length <= 128 &&
    Object.entries(value).every(
      ([key, child]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        validResponseFilter(child, depth + 1),
    )
  )
}
