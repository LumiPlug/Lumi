// SPDX-License-Identifier: MPL-2.0

import { execFileSync } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetTriple = execFileSync('rustc', ['--print', 'host-tuple'], {
  encoding: 'utf8',
}).trim()

if (!targetTriple) {
  throw new Error('Unable to determine Rust host target triple')
}

if (process.platform === 'win32') {
  throw new Error(
    'Windows self-contained sidecar staging is deferred to M10; frontend/Core builds remain available.',
  )
}

const outputDirectory = path.join(projectRoot, 'src-tauri', 'binaries')
await mkdir(outputDirectory, { recursive: true })

const launchers = [
  ['lumi-core', 'packages/core/dist/index.js'],
  ['mcp-stdio-proxy', 'packages/mcp-stdio-proxy/dist/index.js'],
]

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`

for (const [name, entry] of launchers) {
  const outputPath = path.join(outputDirectory, `${name}-${targetTriple}`)
  const launcher = `#!/bin/sh
# SPDX-License-Identifier: MPL-2.0
set -eu
exec ${shellQuote(process.execPath)} ${shellQuote(path.join(projectRoot, entry))} "$@"
`
  await writeFile(outputPath, launcher, 'utf8')
  await chmod(outputPath, 0o755)
}

console.log(`Staged Node sidecar launchers for ${targetTriple}`)
