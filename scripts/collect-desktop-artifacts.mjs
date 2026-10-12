// SPDX-License-Identifier: MPL-2.0

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'dist/sidecars/manifest.json'), 'utf8'))
const bundle = path.join(root, 'src-tauri/target', manifest.target, 'release/bundle')
const output = path.join(root, 'dist/artifacts', manifest.target)
await mkdir(output, { recursive: true })

const formats =
  process.platform === 'darwin'
    ? [['dmg', '.dmg']]
    : [
        ['nsis', '.exe'],
        ['msi', '.msi'],
      ]
for (const [folder, extension] of formats) {
  const files = (await readdir(path.join(bundle, folder))).filter((name) =>
    name.endsWith(extension),
  )
  assert.ok(files.length, `No ${extension} installer found`)
  for (const name of files) await copyFile(path.join(bundle, folder, name), path.join(output, name))
}
if (process.platform === 'darwin') {
  const apps = (await readdir(path.join(bundle, 'macos'))).filter((name) => name.endsWith('.app'))
  assert.equal(apps.length, 1, 'Expected one macOS application bundle')
  execFileSync(
    'ditto',
    [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      path.join(bundle, 'macos', apps[0]),
      path.join(output, `Lumi-${manifest.target}.app.zip`),
    ],
    { stdio: 'inherit' },
  )
}
for (const [source, name] of [
  ['LICENSE', 'LICENSE'],
  ['docs/LICENSING.md', 'LICENSING.md'],
  ['docs/DESKTOP_BUILDS.md', 'BUILD_INFO.md'],
  ['dist/sidecars/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
])
  await copyFile(path.join(root, source), path.join(output, name))

const revision =
  process.env.GITHUB_SHA ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const repository = process.env.GITHUB_REPOSITORY ?? 'LumiPlug/Lumi'
await writeFile(
  path.join(output, 'SOURCE.txt'),
  `Source for this build: https://github.com/${repository}/tree/${revision}\nSource archive: https://github.com/${repository}/archive/${revision}.tar.gz\nTarget: ${manifest.target}\nNode: ${manifest.nodeVersion}\n`,
)
const checksums = []
for (const name of (await readdir(output)).sort()) {
  if (name === 'SHA256SUMS.txt') continue
  const digest = createHash('sha256')
    .update(await readFile(path.join(output, name)))
    .digest('hex')
  checksums.push(`${digest}  ${name}`)
}
await writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
console.log(`Desktop distribution files collected in ${output}`)
