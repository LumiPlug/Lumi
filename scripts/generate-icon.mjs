// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const icons = path.join(root, 'src-tauri/icons')
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js')
const logo = readFileSync(path.join(root, 'src/assets/lumi-logo-transparent.svg'), 'utf8')
const flatLogo = logo
  .replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/g, '')
  .replace(/ filter="url\(#[^)]+\)"/g, '')
  .replace(/^[ \t]*\n/gm, '')
writeFileSync(path.join(root, 'src/assets/lumi-mark.svg'), flatLogo)

const mark = logo
  .replace(/<svg\b[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title\b[^>]*>[\s\S]*?<\/title>/, '')

// A 448px tile on a 512px canvas keeps the Dock footprint and logo padding balanced.
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Lumi 应用图标</title>
  <defs>
    <linearGradient id="iconChassis" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#25252d"/>
      <stop offset="45%" stop-color="#111115"/>
      <stop offset="100%" stop-color="#050507"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="100" fill="url(#iconChassis)" stroke="#2b2b33" stroke-width="1"/>
  <g transform="translate(256 256) scale(1.12) translate(-272.5 -238)">
    ${mark}
  </g>
</svg>
`
const traySvg = logo
  .replace('viewBox="140 84 252 304"', 'viewBox="170 104 204 272"')
  .replace('width="252" height="304"', 'width="44" height="44"')
  .replace(/<defs>[\s\S]*?<\/defs>/, '')
  .replace(/ filter="url\(#[^)]+\)"/g, '')
  .replace(/fill="[^"]+"/g, 'fill="#ffffff"')

function generate(input, output, sizes = []) {
  const result = spawnSync(
    process.execPath,
    [cli, 'icon', input, '--output', output, ...sizes.flatMap((size) => ['--png', String(size)])],
    { cwd: root, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Icon generation failed (${result.status})`)
}

const temporary = mkdtempSync(path.join(tmpdir(), 'lumi-desktop-icons-'))
try {
  const appSource = path.join(temporary, 'app.svg')
  const traySource = path.join(temporary, 'tray.svg')
  const appOutput = path.join(temporary, 'app')
  const trayOutput = path.join(temporary, 'tray')
  writeFileSync(appSource, appSvg)
  writeFileSync(traySource, traySvg)
  generate(appSource, appOutput)
  const desktopIcons = JSON.parse(
    readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
  ).bundle.icon
  for (const icon of desktopIcons) {
    copyFileSync(path.join(appOutput, path.basename(icon)), path.join(root, 'src-tauri', icon))
  }
  generate(traySource, trayOutput, [44])
  copyFileSync(path.join(trayOutput, '44x44.png'), path.join(icons, 'tray-icon.png'))
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

console.log(
  'Generated Lumi gradient app icon and transparent white tray icon from the shared SVG logo.',
)
