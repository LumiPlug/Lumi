// SPDX-License-Identifier: MPL-2.0
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { ToolError } from './config'

export function defaultTerminalShell(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  accountShell: string | null = os.userInfo().shell,
): string {
  if (platform === 'win32') return environment.ComSpec || environment.COMSPEC || 'cmd.exe'
  return (
    [accountShell, environment.SHELL].find((shell) => shell && path.isAbsolute(shell)) || '/bin/sh'
  )
}

export function withoutLumiCredentials(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...environment }
  delete clean.LUMIPLUG_HOST_TOKEN
  delete clean.LUMIPLUG_SESSION_TOKEN
  return clean
}

export function terminalCommandArguments(shell: string, command: string): string[] {
  if (process.platform === 'win32') return ['/d', '/s', '/c', `"${command}"`]
  // The environment already contains .zshenv followed by login/interactive overrides.
  // Loading .zshenv again would undo those overrides and the tool's own variables.
  return path.basename(shell) === 'zsh' ? ['-f', '-c', command] : ['-c', command]
}

/** Read exports, rather than running tasks interactively and changing process-group semantics. */
export function readLoginEnvironment(
  shell: string,
  environment: NodeJS.ProcessEnv,
  home: string,
  signal: AbortSignal,
  timeoutMs = 10000,
): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ToolError('tool_terminal_environment_failed'))
      return
    }
    const marker = `\0${randomUUID()}\0`
    const command = `printf '\\000${marker.slice(1, -1)}\\000'; /usr/bin/env -0; printf '\\000${marker.slice(1, -1)}\\000'`
    const child = spawn(shell, ['-ilc', command], {
      cwd: home,
      env: withoutLumiCredentials({
        ...environment,
        SHELL: shell,
        TERM: environment.TERM || 'xterm-256color',
      }),
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let failed = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, signal)
      } catch {
        /* Already exited. */
      }
    }
    const stop = () => {
      if (failed) return
      failed = true
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 300)
    }
    const timeout = setTimeout(stop, timeoutMs)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const cleanup = () => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', stop)
      kill('SIGKILL')
    }
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 1024 * 1024) stop()
      else chunks.push(chunk)
    })
    child.once('error', () => {
      cleanup()
      reject(new ToolError('tool_terminal_environment_failed'))
    })
    child.once('close', (code) => {
      cleanup()
      const output = Buffer.concat(chunks).toString('utf8')
      const start = output.indexOf(marker)
      const end = output.indexOf(marker, start + marker.length)
      if (failed || signal.aborted || code !== 0 || start < 0 || end < 0) {
        reject(new ToolError('tool_terminal_environment_failed'))
        return
      }
      const exports: NodeJS.ProcessEnv = {}
      for (const entry of output.slice(start + marker.length, end).split('\0')) {
        const equals = entry.indexOf('=')
        if (equals > 0)
          Object.defineProperty(exports, entry.slice(0, equals), {
            value: entry.slice(equals + 1),
            enumerable: true,
            configurable: true,
            writable: true,
          })
      }
      if (!exports.PATH) reject(new ToolError('tool_terminal_environment_failed'))
      else resolve(withoutLumiCredentials(exports))
    })
  })
}

export async function systemTerminalEnvironment(signal: AbortSignal): Promise<{
  shell: string
  environment: NodeJS.ProcessEnv
}> {
  const shell = defaultTerminalShell()
  const environment =
    process.platform === 'win32'
      ? withoutLumiCredentials(process.env)
      : await readLoginEnvironment(shell, process.env, os.homedir(), signal)
  return { shell, environment }
}
