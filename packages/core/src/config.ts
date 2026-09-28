// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { LOOPBACK_HOST, SESSION_TOKEN_ENV } from '@lumiplug/shared'

export interface CoreRuntimeConfig {
  host: typeof LOOPBACK_HOST
  port: number
  sessionToken: string
  userDataDir: string
  parentPid: number
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
    return 0
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('invalid_port')
  }
  return port
}

function positivePid(value: string | undefined): number {
  const pid = Number(value ?? process.ppid)
  if (!Number.isInteger(pid) || pid < 1) {
    throw new Error('invalid_parent_pid')
  }
  return pid
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

  return {
    host: LOOPBACK_HOST,
    port: positivePort(argumentValue(args, '--port') ?? environment.LUMIPLUG_CORE_PORT),
    sessionToken,
    userDataDir: path.resolve(userDataDir),
    parentPid: positivePid(argumentValue(args, '--parent-pid') ?? environment.LUMIPLUG_PARENT_PID),
  }
}
