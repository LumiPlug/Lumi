// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultTerminalShell,
  readLoginEnvironment,
  terminalCommandArguments,
} from './terminal-environment'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-shell-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})
const signal = () => new AbortController().signal
function fixtureShell(startup: string): string {
  const shell = path.join(dir, 'shell')
  fs.writeFileSync(shell, `#!/bin/sh\n${startup}\nexec /bin/sh -c "$2"\n`, { mode: 0o755 })
  return shell
}
describe('system terminal environment', () => {
  it('executes quoted executable paths and inline code through the native shell', () => {
    const shell = defaultTerminalShell()
    const command = `"${process.execPath}" -e "process.stdout.write(process.env.LUMI_QUOTING_FIXTURE)"`
    const result = spawnSync(shell, terminalCommandArguments(shell, command), {
      windowsVerbatimArguments: process.platform === 'win32',
      env: { ...process.env, LUMI_QUOTING_FIXTURE: 'space ; " quoted & literal' },
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('space ; " quoted & literal')
  })
  it('selects the account shell before inherited SHELL, with explicit platform fallbacks', () => {
    expect(defaultTerminalShell({ SHELL: '/bin/bash' }, 'darwin', '/bin/zsh')).toBe('/bin/zsh')
    expect(defaultTerminalShell({ SHELL: '/bin/bash' }, 'linux', null)).toBe('/bin/bash')
    expect(defaultTerminalShell({ SHELL: 'invalid' }, 'linux', null)).toBe('/bin/sh')
    expect(defaultTerminalShell({ ComSpec: 'custom-cmd.exe' }, 'win32', null)).toBe(
      'custom-cmd.exe',
    )
  })
  it.skipIf(process.platform === 'win32')(
    'reads current exports despite startup noise, preserving multiline values and removing credentials',
    async () => {
      const shell = fixtureShell(
        `printf 'startup banner\\n'\nexport PATH="$HOME/bin:/usr/bin:/bin"\nexport MULTILINE='one\ntwo=three'\nexport LUMIPLUG_HOST_TOKEN=restored-secret\nunset REMOVED\n`,
      )
      const environment = await readLoginEnvironment(
        shell,
        {
          HOME: dir,
          PATH: '/usr/bin:/bin',
          REMOVED: 'desktop-only',
          LUMIPLUG_HOST_TOKEN: 'host-secret',
          LUMIPLUG_SESSION_TOKEN: 'session-secret',
        },
        dir,
        signal(),
      )
      expect(environment.PATH).toBe(`${dir}/bin:/usr/bin:/bin`)
      expect(environment.MULTILINE).toBe('one\ntwo=three')
      expect(environment.REMOVED).toBeUndefined()
      expect(environment.LUMIPLUG_HOST_TOKEN).toBeUndefined()
      expect(environment.LUMIPLUG_SESSION_TOKEN).toBeUndefined()
      fs.writeFileSync(shell, '#!/bin/sh\nexport UPDATED=yes\nexec /bin/sh -c "$2"\n', {
        mode: 0o755,
      })
      expect(
        (await readLoginEnvironment(shell, { HOME: dir, PATH: '/usr/bin:/bin' }, dir, signal()))
          .UPDATED,
      ).toBe('yes')
    },
  )
  it.skipIf(process.platform === 'win32' || !fs.existsSync('/bin/zsh'))(
    'loads both login and interactive zsh config from a minimal desktop PATH',
    async () => {
      fs.mkdirSync(path.join(dir, 'bin'))
      fs.writeFileSync(
        path.join(dir, '.zshenv'),
        'export PATH=/usr/bin:/bin\nexport TASK_SETTING=startup\n',
      )
      fs.writeFileSync(path.join(dir, '.zprofile'), 'export FROM_LOGIN=login\n')
      fs.writeFileSync(
        path.join(dir, '.zshrc'),
        'export PATH="$HOME/bin:$PATH"\nexport FROM_INTERACTIVE=interactive\n',
      )
      const executable = path.join(dir, 'bin', 'lumi-fixture-command')
      fs.writeFileSync(executable, '#!/bin/sh\nprintf system-environment\n', { mode: 0o755 })
      const environment = await readLoginEnvironment(
        '/bin/zsh',
        {
          HOME: dir,
          ZDOTDIR: dir,
          PATH: '/usr/bin:/bin',
        },
        dir,
        signal(),
      )
      expect(environment).toMatchObject({ FROM_LOGIN: 'login', FROM_INTERACTIVE: 'interactive' })
      expect(
        execFileSync(
          '/bin/zsh',
          terminalCommandArguments(
            '/bin/zsh',
            'test "$TASK_SETTING" = override && lumi-fixture-command',
          ),
          {
            env: { ...environment, TASK_SETTING: 'override' },
            encoding: 'utf8',
          },
        ),
      ).toBe('system-environment')
    },
  )
  it.skipIf(process.platform === 'win32')(
    'fails rather than falling back when shell initialization fails or produces excessive output',
    async () => {
      await expect(
        readLoginEnvironment(fixtureShell('exit 1'), { PATH: '/usr/bin:/bin' }, dir, signal()),
      ).rejects.toThrow('tool_terminal_environment_failed')
      await expect(
        readLoginEnvironment(
          fixtureShell('/usr/bin/head -c 1100000 /dev/zero'),
          { PATH: '/usr/bin:/bin' },
          dir,
          signal(),
        ),
      ).rejects.toThrow('tool_terminal_environment_failed')
    },
  )
  it.skipIf(process.platform === 'win32')(
    'cancels or times out initialization and terminates its child processes',
    async () => {
      const marker = path.join(dir, 'late-output')
      const shell = fixtureShell(`(sleep 1; touch '${marker}') &\nwait`)
      const controller = new AbortController()
      const pending = readLoginEnvironment(shell, { PATH: '/usr/bin:/bin' }, dir, controller.signal)
      setTimeout(() => controller.abort(), 50)
      await expect(pending).rejects.toThrow('tool_terminal_environment_failed')
      await expect(
        readLoginEnvironment(shell, { PATH: '/usr/bin:/bin' }, dir, signal(), 50),
      ).rejects.toThrow('tool_terminal_environment_failed')
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(fs.existsSync(marker)).toBe(false)
    },
  )
})
