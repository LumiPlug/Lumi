// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function run(command, args) {
  const windowsPnpm = process.platform === 'win32' && command === 'pnpm'
  const result = spawnSync(
    windowsPnpm ? 'cmd.exe' : command,
    windowsPnpm ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args,
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} ${args.join(' ')} failed`)
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}
run('pnpm', ['build:core'])
run('pnpm', ['test:codeburn'])
const check = run('pnpm', ['check'])
const files = /Test Files\s+(\d+) passed/.exec(check),
  tests = /Tests\s+(\d+) passed/.exec(check)
if (!files || !tests) throw new Error('Test summary missing')
await fs.mkdir(path.join(root, 'reports'), { recursive: true })
await fs.writeFile(
  path.join(root, 'reports/codeburn-validation.json'),
  JSON.stringify(
    {
      success: true,
      createdAt: new Date().toISOString(),
      testFiles: Number(files[1]),
      tests: Number(tests[1]),
      checks: [
        'home-contract',
        'typecheck',
        'eslint',
        'vitest',
        'rustfmt',
        'cargo check',
        'cargo clippy',
      ],
      referenceCommit: '9a40cc603fcd194caca9daa8c5134a61ea7e0e2b',
    },
    null,
    2,
  ) + '\n',
)
run(process.execPath, ['scripts/audit-codeburn.mjs'])
run(process.execPath, ['scripts/build-codeburn-report.mjs'])
