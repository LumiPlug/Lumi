// SPDX-License-Identifier: MPL-2.0

import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1]
const target = process.env.LUMI_TARGET_TRIPLE ?? host
const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
}
if (!target || target !== targets[`${process.platform}-${process.arch}`]) {
  throw new Error(`Sidecars require a native Node/Rust runner; requested target: ${target}`)
}
const runtime = await realpath(process.env.LUMI_NODE_BINARY ?? process.execPath)
const runtimeInfo = JSON.parse(
  execFileSync(
    runtime,
    ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'],
    { encoding: 'utf8' },
  ),
)
if (
  Number(runtimeInfo.version.slice(1).split('.')[0]) < 26 ||
  runtimeInfo.platform !== process.platform ||
  runtimeInfo.arch !== process.arch
) {
  throw new Error('Sidecars require Node 26 or newer with the native platform and architecture')
}
if (process.platform === 'darwin') {
  const libraries = execFileSync('otool', ['-L', runtime], { encoding: 'utf8' })
  if (/\/opt\/homebrew\/|\/usr\/local\//.test(libraries.split('\n').slice(1).join('\n'))) {
    throw new Error('Use an official standalone Node runtime via LUMI_NODE_BINARY for packaging')
  }
}
const outputDirectory = path.join(root, 'src-tauri', 'binaries')
const buildDirectory = path.join(root, 'dist', 'sidecars')
await mkdir(outputDirectory, { recursive: true })
await mkdir(buildDirectory, { recursive: true })
const notices = new Map()
for (const candidate of [
  path.join(path.dirname(runtime), 'LICENSE'),
  path.join(path.dirname(runtime), '..', 'LICENSE'),
]) {
  try {
    notices.set(`Node.js ${runtimeInfo.version}`, await readFile(candidate, 'utf8'))
    break
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
if (!notices.size)
  throw new Error('The official Node distribution LICENSE must accompany its binary')

async function collectNotices(inputs) {
  for (const input of Object.keys(inputs)) {
    if (!input.includes('node_modules')) continue
    let directory = path.dirname(path.resolve(root, input))
    while (directory !== path.dirname(directory)) {
      try {
        const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
        if (!pkg.name || !pkg.version) {
          directory = path.dirname(directory)
          continue
        }
        const key = `${pkg.name}@${pkg.version}`
        if (!notices.has(key)) {
          const names = (await readdir(directory)).filter((name) =>
            /^(licen[sc]e|copying)(\..*)?$/i.test(name),
          )
          const texts = await Promise.all(
            names.map((name) => readFile(path.join(directory, name), 'utf8')),
          )
          if (!texts.length) throw new Error(`Missing dependency license text: ${key}`)
          notices.set(key, texts.join('\n\n'))
        }
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        directory = path.dirname(directory)
      }
    }
  }
}

for (const [name, entry] of [
  ['lumi-core', 'packages/core/src/index.ts'],
  ['mcp-stdio-proxy', 'packages/mcp-stdio-proxy/src/index.ts'],
]) {
  const bundledScript = path.join(buildDirectory, `${name}.cjs`)
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: bundledScript,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node26',
    legalComments: 'eof',
    metafile: true,
    banner: { js: '// SPDX-License-Identifier: MPL-2.0' },
  })
  await collectNotices(result.metafile.inputs)
  const executable = path.join(
    outputDirectory,
    `${name}-${target}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const config = path.join(buildDirectory, `${name}.sea.json`)
  await writeFile(
    config,
    JSON.stringify({
      main: bundledScript,
      output: executable,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: 'none',
    }),
  )
  execFileSync(runtime, ['--build-sea', config], { cwd: root, stdio: 'inherit' })
  if (process.platform !== 'win32') await chmod(executable, 0o755)
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--sign', '-', executable], { stdio: 'inherit' })
  }
}
await writeFile(
  path.join(buildDirectory, 'THIRD_PARTY_NOTICES.txt'),
  [...notices]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, text]) => `${name}\n${'='.repeat(72)}\n${text}`)
    .join('\n\n'),
)
await writeFile(
  path.join(buildDirectory, 'manifest.json'),
  JSON.stringify({ target, nodeVersion: runtimeInfo.version }, null, 2) + '\n',
)
console.log(`Built independent Node sidecars for ${target} (${runtimeInfo.version}).`)
