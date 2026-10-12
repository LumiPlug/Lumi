// SPDX-License-Identifier: MPL-2.0

export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type JsonSchemaType =
  'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string'

export interface JsonSchema {
  default?: JsonValue
  $schema?: string
  $id?: string
  title?: string
  description?: string
  type?: JsonSchemaType | JsonSchemaType[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  enum?: JsonValue[]
  const?: JsonValue
  format?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  dependentRequired?: Record<string, string[]>
  dependentSchemas?: Record<string, JsonSchema>
  if?: JsonSchema
  then?: JsonSchema
  else?: JsonSchema
  not?: JsonSchema
  minProperties?: number
  maxProperties?: number
}
