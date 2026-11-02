// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import type net from 'node:net'
import { discover, MAX_FRAME_BYTES, startNativeHost } from './index'

const dirs: string[] = []
const id = 'a'.repeat(32)
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lumi-native-test-'))
  dirs.push(dir)
  await chmod(dir, 0o700)
  const runtimeFile = path.join(dir, 'runtime.json')
  const configFile = path.join(dir, 'browser-native.json')
  const address =
    process.platform === 'win32' ? '\\\\.\\pipe\\lumi-test' : path.join(dir, 'core.sock')
  await writeFile(runtimeFile, JSON.stringify({ version: 1, address, token: 'a'.repeat(64) }), {
    mode: 0o600,
  })
  await writeFile(configFile, JSON.stringify({ version: 1, extensionId: id, runtimeFile }), {
    mode: 0o600,
  })
  return { dir, runtimeFile, configFile, address }
}
function frame(value: unknown) {
  const data = Buffer.from(JSON.stringify(value))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(data.length)
  return Buffer.concat([header, data])
}

describe('Chrome native host connects only to existing Core', () => {
  it('discovers exact registered origin and does not create a missing runtime', async () => {
    const f = await fixture()
    await expect(discover(`chrome-extension://${id}/`, f.configFile)).resolves.toEqual({
      address: f.address,
      token: 'a'.repeat(64),
    })
    await expect(discover(`chrome-extension://${'b'.repeat(32)}/`, f.configFile)).rejects.toThrow(
      'not_registered',
    )
    await rm(f.runtimeFile)
    await expect(discover(`chrome-extension://${id}/`, f.configFile)).rejects.toThrow()
    await expect(readFile(f.runtimeFile)).rejects.toThrow()
  })
  it('handshakes before forwarding, supports fragmented Unicode frames and returns Core requests', async () => {
    const f = await fixture()
    const writes: string[] = []
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        writes.push(chunk.toString())
        callback()
      },
    })
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const received: Buffer[] = []
    stdout.on('data', (chunk) => received.push(chunk))
    const close = await startNativeHost(`chrome-extension://${id}/`, {
      configFile: f.configFile,
      streams: { stdin, stdout, stderr },
      connect: () => socket as net.Socket,
    })
    socket.emit('connect')
    expect(JSON.parse(writes[0]!)).toEqual({
      role: 'native',
      token: 'a'.repeat(64),
      origin: `chrome-extension://${id}/`,
    })
    const message = frame({ type: 'sessions', sessions: [{ title: '中文' }] })
    stdin.write(message.subarray(0, 3))
    stdin.write(message.subarray(3))
    expect(writes).toHaveLength(1)
    socket.push('{"type":"ready"}\n')
    await new Promise((resolve) => setImmediate(resolve))
    expect(JSON.parse(writes[1]!)).toEqual({ type: 'sessions', sessions: [{ title: '中文' }] })
    const request = { type: 'request', id: '1', tool: 'browser_list_sessions', args: {} }
    socket.push(JSON.stringify(request) + '\n')
    await new Promise((resolve) => setImmediate(resolve))
    const output = Buffer.concat(received)
    expect(output.readUInt32LE()).toBe(output.length - 4)
    expect(JSON.parse(output.subarray(4).toString())).toEqual(request)
    close()
    expect(socket.destroyed).toBe(true)
  })
  it('oversized Chrome frame closes the existing connection without replay', async () => {
    const f = await fixture()
    const socket = new Duplex({
      read() {},
      write(_chunk, _encoding, cb) {
        cb()
      },
    })
    const stdin = new PassThrough()
    const close = await startNativeHost(`chrome-extension://${id}/`, {
      configFile: f.configFile,
      streams: { stdin, stdout: new PassThrough(), stderr: new PassThrough() },
      connect: () => socket as net.Socket,
    })
    const header = Buffer.alloc(4)
    header.writeUInt32LE(MAX_FRAME_BYTES + 1)
    stdin.write(header)
    expect(socket.destroyed).toBe(true)
    close()
  })
  it('rejects loose Unix credential permissions', async () => {
    if (process.platform === 'win32') return
    const f = await fixture()
    await chmod(f.runtimeFile, 0o644)
    await expect(discover(`chrome-extension://${id}/`, f.configFile)).rejects.toThrow('permissions')
  })
})
