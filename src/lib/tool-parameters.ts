// SPDX-License-Identifier: MPL-2.0
import type { CapabilityField, JsonValue } from '@lumiplug/shared'

export function parameterDefaultText(field: CapabilityField): string {
  const value = field.aiVisible ? field.schema.default : field.value
  return value === undefined || (!field.aiVisible && value === null)
    ? ''
    : typeof value === 'string' &&
        (field.schema.type === 'string' || field.schema.type === undefined)
      ? value
      : JSON.stringify(value)
}

/** Blank removes a default; non-string defaults retain their canonical JSON type. */
export function parseParameterDefault(field: CapabilityField, text: string): JsonValue | undefined {
  if (text === '') return undefined
  if (field.schema.type === 'string' || field.schema.type === undefined) return text
  const value = JSON.parse(text) as JsonValue
  const types = Array.isArray(field.schema.type) ? field.schema.type : [field.schema.type]
  const valid = types.some((type) => {
    if (type === 'null') return value === null
    if (type === 'array') return Array.isArray(value)
    if (type === 'object')
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
    return typeof value === type
  })
  if (!valid) throw new Error('parameter_default_type_invalid')
  return value
}

/** Move one complete record without rewriting its values or bindings. */
export function moveParameter<T>(items: T[], from: number, to: number): T[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= items.length ||
    to < 0 ||
    to >= items.length ||
    from === to
  )
    return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/** Move the current value with its visibility; hidden values must not remain public defaults. */
export function setParameterVisibility(
  field: CapabilityField,
  aiVisible: boolean,
): CapabilityField {
  if (field.aiVisible === aiVisible) return field
  const schema = { ...field.schema }
  if (!aiVisible) {
    const value = schema.default ?? null
    delete schema.default
    return { ...field, schema, aiVisible, value }
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (field.value !== null || types.includes('null')) schema.default = field.value
  else delete schema.default
  return { ...field, schema, aiVisible, value: null }
}
