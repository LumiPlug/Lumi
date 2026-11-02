// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_MCP_PORT, LOOPBACK_HOST, SESSION_TOKEN_ENV } from '@lumiplug/shared'

export interface CoreRuntimeConfig {
  host: typeof LOOPBACK_HOST
  port: number
  sessionToken: string
  hostToken?: string
  userDataDir: string
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) {
    return undefined
  }
  return args[index + 1]
}

function positivePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_MCP_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('invalid_port')
  }
  return port
}

/** Parse the narrow launch contract used by the Tauri supervisor. */
export function parseRuntimeConfig(
  args = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): CoreRuntimeConfig {
  const host = argumentValue(args, '--host') ?? LOOPBACK_HOST
  if (host !== LOOPBACK_HOST) {
    throw new Error('core_must_bind_loopback')
  }

  const sessionToken =
    argumentValue(args, '--session-token') ?? environment[SESSION_TOKEN_ENV] ?? randomUUID()
  if (sessionToken.length < 16 || /[\r\n]/.test(sessionToken)) {
    throw new Error('session_token_too_short')
  }

  const userDataDir =
    argumentValue(args, '--user-data-dir') ??
    environment.LUMIPLUG_USER_DATA_DIR ??
    path.join(os.tmpdir(), 'lumiplug')

  const hostToken = environment.LUMIPLUG_HOST_TOKEN
  if (
    hostToken !== undefined &&
    (hostToken.length < 32 || /[\r\n]/.test(hostToken) || hostToken === sessionToken)
  )
    throw new Error('invalid_host_token')
  // Do not inherit the host credential into Terminal or upstream MCP subprocesses.
  if (environment === process.env) delete process.env.LUMIPLUG_HOST_TOKEN

  return {
    host: LOOPBACK_HOST,
    port: positivePort(argumentValue(args, '--port') ?? environment.LUMIPLUG_CORE_PORT),
    sessionToken,
    hostToken,
    userDataDir: path.resolve(userDataDir),
  }
}
