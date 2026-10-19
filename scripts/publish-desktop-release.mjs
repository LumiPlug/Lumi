// SPDX-License-Identifier: MPL-2.0

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const {
  GITHUB_REPOSITORY: repository,
  GITHUB_SHA: revision,
  GITHUB_RUN_NUMBER: runNumber,
} = process.env
assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Only main can publish desktop builds')
assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/)
assert.match(revision ?? '', /^[a-f0-9]{40}$/)
assert.match(runNumber ?? '', /^\d+$/)
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
assert.match(version, /^\d+\.\d+\.\d+$/)
const tag = `v${version}-preview.${runNumber}`
const input = path.join(root, 'dist/release-input')
const output = path.join(root, 'dist/release-assets')
const targets = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc']
assert.deepEqual((await readdir(input)).sort(), targets.map((target) => `Lumi-${target}`).sort())
await mkdir(output, { recursive: true })
const assets = []
const digest = (data) => createHash('sha256').update(data).digest('hex')
for (const target of targets) {
  const directory = path.join(input, `Lumi-${target}`)
  const files = (await readdir(directory)).sort()
  const source = await readFile(path.join(directory, 'SOURCE.txt'), 'utf8')
  assert.ok(source.includes(`https://github.com/${repository}/tree/${revision}\n`))
  assert.ok(source.includes(`Target: ${target}\n`))
  for (const required of ['LICENSE', 'LICENSING.md', 'BUILD_INFO.md', 'THIRD_PARTY_NOTICES.txt'])
    assert.ok(files.includes(required), `Missing ${required} for ${target}`)
  const checksums = await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  const verified = new Set()
  for (const line of checksums.trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/.exec(line)
    assert.ok(match, `Invalid checksum entry for ${target}`)
    const [, expected, name] = match
    assert.ok(!verified.has(name), `Duplicate checksum for ${name}`)
    assert.equal(digest(await readFile(path.join(directory, name))), expected, name)
    verified.add(name)
  }
  assert.deepEqual(
    [...verified].sort(),
    files.filter((name) => name !== 'SHA256SUMS.txt'),
  )
  const extensions = target.includes('windows') ? ['.exe', '.msi'] : ['.dmg', '.app.zip']
  for (const extension of extensions) {
    const matches = files.filter((name) => name.endsWith(extension))
    assert.equal(matches.length, 1, `Expected one ${extension} for ${target}`)
    const name = matches[0]
    assert.ok(!assets.some((asset) => path.basename(asset) === name), `Duplicate asset ${name}`)
    const destination = path.join(output, name)
    await copyFile(path.join(directory, name), destination)
    assets.push(destination)
  }
  const archive = path.join(output, `Lumi-${version}-${target}.zip`)
  execFileSync('zip', ['-q', '-r', archive, ...files], { cwd: directory })
  assets.push(archive)
}
const sums = path.join(output, 'SHA256SUMS.txt')
await writeFile(
  sums,
  (
    await Promise.all(
      assets.map(async (file) => `${digest(await readFile(file))}  ${path.basename(file)}`),
    )
  )
    .sort()
    .join('\n') + '\n',
)
assets.push(sums)
const notes = path.join(output, 'release-notes.md')
// Publish version-specific limitations with the release, before it becomes public.
const productNotes = (await readFile(path.join(root, `docs/releases/${version}.md`), 'utf8'))
  .replace(/^<!-- SPDX-License-Identifier: MPL-2\.0 -->\s*/, '')
  .replace(/\]\(\.\.\/([^\s)]+)\)/g, `](https://github.com/${repository}/blob/${revision}/docs/$1)`)
  .trim()
await writeFile(
  notes,
  `${productNotes}\n\n---\n\nLumi ${version} preview build ${runNumber}\n\n` +
    `Built from main: https://github.com/${repository}/tree/${revision}\n` +
    `Build and verification: https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}\n\n` +
    '- macOS Apple Silicon: aarch64 DMG or APP ZIP; macOS 13.5 or newer.\n' +
    '- macOS Intel: x64 DMG or APP ZIP; macOS 13.5 or newer.\n' +
    '- Windows x64: setup EXE or MSI. WebView2 may require an internet connection during installation.\n' +
    '- Platform ZIP archives include the installers, licenses, source information and checksums.\n' +
    '- All three native runners passed source checks and standalone sidecar smoke tests, including sidecars extracted from the macOS APP and Windows MSI.\n\n' +
    'This is a test distribution. macOS uses ad-hoc signing and is not notarized; Windows binaries and installers have no publisher signature. System security warnings may appear. Automatic updates are not configured. Full interactive installation and upgrade testing on user machines is still required.\n',
)
const args = ['--repo', repository]
const existing = spawnSync('gh', ['release', 'view', tag, ...args, '--json', 'isDraft'], {
  encoding: 'utf8',
})
if (existing.status === 0) {
  assert.equal(
    JSON.parse(existing.stdout).isDraft,
    true,
    'Published releases are immutable; nothing overwritten',
  )
} else {
  execFileSync(
    'gh',
    [
      'release',
      'create',
      tag,
      ...args,
      '--target',
      revision,
      '--title',
      `Lumi ${tag}`,
      '--notes-file',
      notes,
      '--prerelease',
      '--draft',
    ],
    { stdio: 'inherit' },
  )
}
execFileSync('gh', ['release', 'upload', tag, ...args, ...assets, '--clobber'], {
  stdio: 'inherit',
})
execFileSync('gh', ['release', 'edit', tag, ...args, '--draft=false'], { stdio: 'inherit' })
console.log(`Published https://github.com/${repository}/releases/tag/${tag}`)
