// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { HOME_CONTRACT } from '@lumiplug/shared'
import type { HomeBundle, HomeFile, HomeManifest } from '@lumiplug/shared'
import { HOME_TEMPLATE_FILES } from './template-files'
import { compatibleHome, decodeHomeFile, WorkbenchError } from './validation'

export function homeTemplate() {
  const files = { ...HOME_TEMPLATE_FILES }
  const manifest = JSON.parse(files['lumi.home.json']!) as HomeManifest
  manifest.projectId = randomUUID()
  files['lumi.home.json'] = `${JSON.stringify(manifest, null, 2)}\n`
  return {
    contract: HOME_CONTRACT,
    files: Object.entries(files).map(([name, content]) => ({
      path: name,
      encoding: 'utf8' as const,
      content,
    })),
  }
}
export function homeSourceForExport(bundle: HomeBundle | null): HomeFile[] {
  if (!bundle) return homeTemplate().files
  if (!compatibleHome(bundle.manifest)) throw new WorkbenchError('home_version_incompatible')
  const files = new Map(bundle.sourceFiles.map((file) => [file.path, file]))
  for (const item of homeTemplate().files) {
    if (['lumi-sdk.js', 'theme.css'].includes(item.path) ||
      item.path === 'LUMI_DEVELOPMENT.md' ||
      item.path.startsWith('knowledge/')) {
      if (!files.has(item.path) || ['lumi-sdk.js', 'theme.css'].includes(item.path))
        files.set(item.path, item)
    }
  }
  return [...files.values()]
}
export function exportHomeProject(directory: string, files: HomeFile[]) {
  if (!path.isAbsolute(directory)) throw new WorkbenchError('invalid_export_directory')
  const target = path.resolve(directory)
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target)
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.readdirSync(target).length)
      throw new WorkbenchError('export_directory_not_empty')
  } else fs.mkdirSync(target, { recursive: true })
  // Each path is from the official template or the already validated source tree.
  for (const file of files) {
    const destination = path.join(target, file.path)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, decodeHomeFile(file), { flag: 'wx' })
  }
  return { directory: target, fileCount: files.length, lumiVersion: HOME_CONTRACT.lumiVersion }
}
