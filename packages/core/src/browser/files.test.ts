// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { saveBrowserArtifact, validateUploadFiles } from './files'
import { validateAdvanced, ADVANCED_TOOLS } from './advanced-tools'

it('uploads accept explicit regular files but reject relative paths, directories and missing files', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-upload-')))
  try {
    const file = path.join(root, 'data.txt')
    await fs.writeFile(file, 'fixture')
    expect(await validateUploadFiles([file])).toEqual([file])
    await expect(validateUploadFiles(['relative.txt'])).rejects.toThrow()
    await expect(validateUploadFiles([root])).rejects.toThrow()
    await expect(validateUploadFiles([path.join(root, 'missing')])).rejects.toThrow()
    if (process.platform !== 'win32') {
      const link = path.join(root, 'link')
      await fs.symlink(file, link)
      await expect(validateUploadFiles([link])).rejects.toThrow()
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
it('artifacts validate signature, chunk size and completion; partial failures leave no files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-artifact-'))
  try {
    const bytes = Buffer.from('%PDF-fixture')
    const descriptor = { artifactId: 'a', size: bytes.length, mimeType: 'application/pdf' }
    const saved = await saveBrowserArtifact(root, descriptor, async () => ({
      data: bytes.toString('base64'),
      eof: true,
    }))
    expect(await fs.readFile(saved.path)).toEqual(bytes)
    expect(saved.sha256).toHaveLength(64)
    await expect(
      saveBrowserArtifact(root, descriptor, async () => ({
        data: bytes.toString('base64'),
        eof: false,
      })),
    ).rejects.toThrow()
    await expect(
      saveBrowserArtifact(root, descriptor, async () => ({
        data: Buffer.alloc(bytes.length).toString('base64'),
        eof: true,
      })),
    ).rejects.toThrow()
    expect(await fs.readdir(path.join(root, 'browser-artifacts'))).toHaveLength(1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
it('advanced catalog rejects malicious operation shapes at the Core boundary', () => {
  expect(ADVANCED_TOOLS).toHaveLength(19)
  expect(validateAdvanced('not_a_tool', {})).toBeUndefined()
  expect(validateAdvanced('upload_files', { sessionId: 's', ref: 'r', paths: ['/file'] })).toBe(
    true,
  )
  expect(validateAdvanced('upload_files', { sessionId: 's', ref: 'r', paths: [] })).toBe(false)
  expect(
    validateAdvanced('frame_action', { sessionId: 's', frameToken: 'f', action: 'eval' }),
  ).toBe(false)
  expect(validateAdvanced('emulate', { sessionId: 's', action: 'set', width: 99999 })).toBe(false)
  expect(validateAdvanced('dialog', { sessionId: 's', action: 'accept', code: 'anything' })).toBe(
    false,
  )
})
