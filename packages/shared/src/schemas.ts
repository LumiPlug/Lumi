// SPDX-License-Identifier: MPL-2.0

import type { JsonSchema } from './json'

export const CORE_LAUNCH_CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    host: { type: 'string', const: '127.0.0.1' },
    port: { type: 'integer', minimum: 0, maximum: 65_535 },
    sessionToken: { type: 'string', minLength: 16 },
    userDataDir: { type: 'string', minLength: 1 },
    parentPid: { type: 'integer', minimum: 1 },
  },
  required: ['host', 'port', 'sessionToken', 'userDataDir', 'parentPid'],
  additionalProperties: false,
}

export const SIDECAR_READY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', const: 'sidecar.ready' },
    protocolVersion: { type: 'integer', minimum: 1 },
    coreVersion: { type: 'string' },
    port: { type: 'integer', minimum: 1, maximum: 65_535 },
    pid: { type: 'integer', minimum: 1 },
    mcpAvailable: { type: 'boolean' },
  },
  required: ['kind', 'protocolVersion', 'coreVersion', 'port', 'pid', 'mcpAvailable'],
  additionalProperties: false,
}

export const CORE_HEALTH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', const: 'ok' },
    protocolVersion: { type: 'integer', minimum: 1 },
    coreVersion: { type: 'string' },
    pid: { type: 'integer', minimum: 1 },
    readyAt: { type: 'string', format: 'date-time' },
  },
  required: ['status', 'protocolVersion', 'coreVersion', 'pid', 'readyAt'],
  additionalProperties: false,
}

export const CORE_REQUEST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    method: { type: 'string', enum: ['GET', 'POST'] },
    path: { type: 'string', pattern: '^/app/' },
    body: {},
  },
  required: ['id', 'method', 'path'],
  additionalProperties: false,
}

export const CORE_RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    requestId: { type: 'string' },
    data: {},
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
      additionalProperties: false,
    },
  },
  required: ['ok', 'requestId'],
  additionalProperties: false,
}

export const CORE_EVENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['core.status', 'capability.changed', 'sidecar.ready'] },
    status: { type: 'object' },
    capability: { type: 'object' },
    handshake: { type: 'object' },
  },
  required: ['type'],
  additionalProperties: false,
}

export const CAPABILITY_DEFINITION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    namespace: { type: 'string' },
    description: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    source: { type: 'string', enum: ['ui', 'ai', 'import'] },
    status: { type: 'string', enum: ['draft', 'ready', 'disabled'] },
    enabled: { type: 'boolean' },
    runner: { type: 'object' },
    tools: { type: 'array', items: { type: 'object' } },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'name',
    'namespace',
    'description',
    'version',
    'source',
    'status',
    'enabled',
    'runner',
    'tools',
    'createdAt',
    'updatedAt',
  ],
  additionalProperties: false,
}
