// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

export async function validateUploadFiles(paths: string[]): Promise<string[]> {
  for (const file of paths) {
    if (!path.isAbsolute(file) || file.includes('\0')) throw new Error('upload_path_invalid')
    const real = await fs.realpath(file)
    const stat = await fs.lstat(file)
    if (
      path.normalize(real) !== path.normalize(file) ||
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > 100 * 1024 * 1024
    )
      throw new Error('upload_file_invalid')
  }
  return paths
}

export async function saveBrowserArtifact(
  userDataDir: string,
  descriptor: { artifactId: string; size: number; mimeType: string },
  read: (offset: number) => Promise<{ data: string; eof: boolean }>,
): Promise<{ path: string; size: number; sha256: string; mimeType: string }> {
  if (
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size < 1 ||
    descriptor.size > 20 * 1024 * 1024 ||
    !['image/png', 'application/pdf'].includes(descriptor.mimeType)
  )
    throw new Error('artifact_invalid')
  const directory = path.join(userDataDir, 'browser-artifacts')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const dirStat = await fs.lstat(directory)
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory())
    throw new Error('artifact_directory_invalid')
  if ((await fs.readdir(directory)).length >= 100) throw new Error('artifact_quota_exceeded')
  const destination = path.join(
    directory,
    `${randomUUID()}.${descriptor.mimeType === 'image/png' ? 'png' : 'pdf'}`,
  )
  const handle = await fs.open(destination, 'wx', 0o600)
  const hash = createHash('sha256')
  let offset = 0
  let complete = false
  try {
    while (offset < descriptor.size) {
      const chunk = await read(offset)
      if (typeof chunk.data !== 'string' || chunk.data.length > 131072)
        throw new Error('artifact_chunk_invalid')
      const data = Buffer.from(chunk.data, 'base64')
      if (
        !data.length ||
        data.toString('base64') !== chunk.data ||
        offset + data.length > descriptor.size
      )
        throw new Error('artifact_chunk_invalid')
      if (
        offset === 0 &&
        !(descriptor.mimeType === 'application/pdf'
          ? data.subarray(0, 5).equals(Buffer.from('%PDF-'))
          : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      )
        throw new Error('artifact_signature_invalid')
      await handle.writeFile(data)
      hash.update(data)
      offset += data.length
      if (chunk.eof !== (offset === descriptor.size)) throw new Error('artifact_size_invalid')
    }
    complete = true
    return {
      path: destination,
      size: offset,
      sha256: hash.digest('hex'),
      mimeType: descriptor.mimeType,
    }
  } finally {
    await handle.close()
    if (!complete) await fs.unlink(destination).catch(() => {})
  }
}
