// SPDX-License-Identifier: MPL-2.0

import { lstat, readFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { isSea } from 'node:sea'
import type { Readable, Writable } from 'node:stream'

export const MAX_FRAME_BYTES = 1024 * 1024 - 1
export const HOST_NAME = 'com.lumiplug.browser'
export function locatorPath(
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
): string {
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'Lumi', 'browser-native.json')
  if (platform === 'win32' && env.LOCALAPPDATA)
    return path.join(env.LOCALAPPDATA, 'Lumi', 'browser-native.json')
  throw new Error('browser_platform_unsupported')
}

export async function privateJSON(file: string): Promise<Record<string, unknown>> {
  for (const target of [path.dirname(file), file]) {
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || (target === file ? !stat.isFile() : !stat.isDirectory()))
      throw new Error('browser_private_file_invalid')
    if (
      process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    )
      throw new Error('browser_private_file_permissions')
    if (target === file && stat.size > 16 * 1024) throw new Error('browser_private_file_too_large')
  }
  const value: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('browser_private_file_invalid')
  return value as Record<string, unknown>
}

export async function discover(
  origin: string,
  configFile = locatorPath(),
): Promise<{ address: string; token: string }> {
  if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)) throw new Error('browser_origin_invalid')
  const locator = await privateJSON(configFile)
  if (
    locator.version !== 1 ||
    origin !== `chrome-extension://${locator.extensionId}/` ||
    typeof locator.runtimeFile !== 'string' ||
    !path.isAbsolute(locator.runtimeFile)
  )
    throw new Error('browser_origin_not_registered')
  const runtime = await privateJSON(locator.runtimeFile)
  if (
    runtime.version !== 1 ||
    typeof runtime.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(runtime.token) ||
    typeof runtime.address !== 'string'
  )
    throw new Error('browser_core_unavailable')
  if (
    process.platform === 'win32'
      ? !runtime.address.startsWith('\\\\.\\pipe\\')
      : !path.isAbsolute(runtime.address)
  )
    throw new Error('browser_ipc_address_invalid')
  return { address: runtime.address, token: runtime.token }
}

/** Only connects to Core. No child processes, listeners, runtime creation, or retry. */
export async function startNativeHost(
  origin: string,
  options: {
    configFile?: string
    streams?: { stdin: Readable; stdout: Writable; stderr: Writable }
    connect?: (address: string) => net.Socket
  } = {},
): Promise<() => void> {
  const streams = options.streams ?? process
  const runtime = await discover(origin, options.configFile)
  const socket = (options.connect ?? ((address) => net.createConnection(address)))(runtime.address)
  let stopped = false
  let ready = false
  let chrome = Buffer.alloc(0)
  let core = Buffer.alloc(0)
  const pending: string[] = []
  let pendingBytes = 0
  const close = (): void => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    socket.destroy()
    streams.stdin.off('data', onChrome)
    streams.stdin.pause()
  }
  const fail = (): void => {
    streams.stderr.write(
      'Lumi browser: Core connection closed or invalid frame; reconnect from Chrome after enabling Lumi.\n',
    )
    close()
  }
  const sendChrome = (message: unknown): void => {
    const bytes = Buffer.from(JSON.stringify(message))
    if (bytes.length > MAX_FRAME_BYTES) {
      fail()
      return
    }
    const header = Buffer.alloc(4)
    header.writeUInt32LE(bytes.length)
    if (streams.stdout.writableLength > MAX_FRAME_BYTES * 2) {
      fail()
      return
    }
    streams.stdout.write(Buffer.concat([header, bytes]))
  }
  const onChrome = (chunk: Buffer): void => {
    chrome = Buffer.concat([chrome, chunk])
    while (chrome.length >= 4) {
      const length = chrome.readUInt32LE(0)
      if (!length || length > MAX_FRAME_BYTES) {
        fail()
        return
      }
      if (chrome.length < length + 4) break
      try {
        const message = JSON.parse(chrome.subarray(4, length + 4).toString('utf8')) as {
          type?: string
        }
        if (!message || !['sessions', 'response'].includes(message.type ?? ''))
          throw new Error('invalid_message')
        const line = `${JSON.stringify(message)}\n`
        if (ready) {
          if (socket.writableLength > MAX_FRAME_BYTES * 2) throw new Error('backpressure')
          socket.write(line)
        } else {
          pendingBytes += Buffer.byteLength(line)
          if (pendingBytes > MAX_FRAME_BYTES || pending.length >= 32)
            throw new Error('pending_overflow')
          pending.push(line)
        }
      } catch {
        fail()
        return
      }
      chrome = chrome.subarray(length + 4)
    }
    if (chrome.length > MAX_FRAME_BYTES + 4) fail()
  }
  const timer = setTimeout(fail, 5000)
  socket.once('connect', () =>
    socket.write(`${JSON.stringify({ role: 'native', token: runtime.token, origin })}\n`),
  )
  socket.on('data', (chunk: Buffer) => {
    core = Buffer.concat([core, chunk])
    let newline: number
    while ((newline = core.indexOf(10)) >= 0) {
      if (newline > MAX_FRAME_BYTES) {
        fail()
        return
      }
      try {
        const message = JSON.parse(core.subarray(0, newline).toString('utf8')) as { type?: string }
        if (!ready) {
          if (message.type !== 'ready') throw new Error('not_ready')
          ready = true
          sendChrome({ type: 'ready' })
          clearTimeout(timer)
          for (const line of pending) socket.write(line)
          pending.length = 0
          pendingBytes = 0
        } else {
          if (!['request', 'cancel'].includes(message.type ?? ''))
            throw new Error('invalid_message')
          sendChrome(message)
        }
      } catch {
        fail()
        return
      }
      core = core.subarray(newline + 1)
    }
    if (core.length > MAX_FRAME_BYTES) fail()
  })
  socket.once('error', fail)
  socket.once('close', close)
  streams.stdin.on('data', onChrome)
  streams.stdin.once('end', close)
  streams.stdin.once('error', close)
  streams.stdout.once('error', close)
  return close
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Lumi Chrome Native Messaging host; connects only to an already running, enabled Lumi Core.\n',
    )
    return
  }
  try {
    const origin = process.argv.find((arg) => arg.startsWith('chrome-extension://')) ?? ''
    const close = await startNativeHost(origin)
    process.once('SIGTERM', close)
    process.once('SIGINT', close)
  } catch {
    process.stderr.write(
      'Lumi browser: open Lumi, enable browser integration, and repair its registration if the app moved.\n',
    )
    process.exitCode = 1
  }
}
if (isSea() || require.main === module) void main()
