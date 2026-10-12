// SPDX-License-Identifier: MPL-2.0

import Ajv from 'ajv/dist/2020.js'
import { isDeepStrictEqual } from 'node:util'
import { HOME_CONTRACT, HOME_LIMITS, homeBundleSchema } from '@lumiplug/shared'
import type { HomeBundle, HomeFile, HomeManifest } from '@lumiplug/shared'

export class WorkbenchError extends Error {
  public constructor(public readonly code: string) {
    super(code)
    this.name = 'WorkbenchError'
  }
}
const validate = new Ajv({ strict: false }).compile<HomeBundle>(homeBundleSchema)
const safePath = (name: string) =>
  name.length <= 240 &&
  !name.includes('\\') &&
  !name.includes('\0') &&
  !name.startsWith('/') &&
  /^[A-Za-z0-9_./@-]+$/.test(name) &&
  name
    .split('/')
    .every(
      (part) =>
        part &&
        part !== '..' &&
        !part.startsWith('.') &&
        !['node_modules', 'output', 'dist'].includes(part),
    )
export function decodeHomeFile(file: HomeFile): Buffer {
  if (file.encoding === 'utf8') return Buffer.from(file.content, 'utf8')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))
    throw new WorkbenchError('invalid_home_bundle')
  const bytes = Buffer.from(file.content, 'base64')
  if (bytes.toString('base64') !== file.content) throw new WorkbenchError('invalid_home_bundle')
  return bytes
}
export function compatibleHome(manifest: HomeManifest): boolean {
  return (
    manifest.lumiVersion === HOME_CONTRACT.lumiVersion &&
    manifest.sdkVersion === HOME_CONTRACT.sdkVersion &&
    manifest.bridgeVersion === HOME_CONTRACT.bridgeVersion &&
    manifest.template === 'lumi-html-home' &&
    manifest.formatVersion === HOME_CONTRACT.formatVersion
  )
}
export function validateHomeBundle(input: unknown): HomeBundle {
  if (!validate(input)) throw new WorkbenchError('invalid_home_bundle')
  if (!compatibleHome(input.manifest)) throw new WorkbenchError('home_version_incompatible')
  let total = 0
  if (input.files.length + input.sourceFiles.length > HOME_LIMITS.fileCount)
    throw new WorkbenchError('home_bundle_too_large')
  for (const tree of [input.files, input.sourceFiles]) {
    const paths = new Set<string>()
    for (const file of tree) {
      if (!safePath(file.path) || paths.has(file.path))
        throw new WorkbenchError('invalid_home_path')
      paths.add(file.path)
      const size = decodeHomeFile(file).length
      if (size > HOME_LIMITS.fileBytes) throw new WorkbenchError('home_bundle_too_large')
      total += size
    }
  }
  if (total > HOME_LIMITS.totalBytes) throw new WorkbenchError('home_bundle_too_large')
  for (const required of ['index.html', 'app.js', 'style.css']) {
    if (!input.files.some((file) => file.path === required))
      throw new WorkbenchError('invalid_home_bundle')
  }
  if (input.files.some((file) => ['lumi-sdk.js', 'theme.css'].includes(file.path)))
    throw new WorkbenchError('invalid_home_bundle')
  const source = new Map(input.sourceFiles.map((file) => [file.path, file]))
  for (const required of ['index.html', 'app.js', 'style.css', 'lumi.home.json']) {
    if (!source.has(required)) throw new WorkbenchError('home_source_missing')
  }
  try {
    const manifest = JSON.parse(
      decodeHomeFile(source.get('lumi.home.json')!).toString('utf8'),
    ) as HomeManifest
    if (!isDeepStrictEqual(manifest, input.manifest))
      throw new WorkbenchError('invalid_home_bundle')
  } catch (error) {
    if (error instanceof WorkbenchError) throw error
    throw new WorkbenchError('invalid_home_bundle')
  }
  return input
}
