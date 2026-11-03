// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { expect, it } from 'vitest'
import { BrowserWebSocketTransport } from './websocket-transport'
import {
  createPairingHello,
  commitPairingHello,
  verifyPairingCommitment,
  finishPairing,
  createNonce,
  verifyServerProof,
  createClientProof,
  createSecureChannel,
} from './secure-crypto'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'

async function connectSession() {
  const ws = new WebSocket('ws://127.0.0.1:43128/ws', {
    origin: `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`,
  })
  const inbox: Record<string, unknown>[] = []
  const waiters: ((v: Record<string, unknown>) => void)[] = []
  ws.on('message', (data) => {
    const value = JSON.parse(String(data))
    const resolve = waiters.shift()
    if (resolve) resolve(value)
    else inbox.push(value)
  })
  const next = async () =>
    inbox.shift() ??
    (await new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve)))
  await once(ws, 'open')
  const client = await createPairingHello('client')
  ws.send(
    JSON.stringify({
      type: 'enroll_commit',
      commitment: await commitPairingHello(client.hello, 'client'),
    }),
  )
  const commitment = await next()
  ws.send(JSON.stringify({ type: 'enroll_hello', hello: client.hello }))
  const offer = await next()
  expect(await verifyPairingCommitment(offer.hello, 'server', commitment.commitment)).toBe(true)
  const derived = await finishPairing(client.state, offer.hello)
  ws.send(JSON.stringify({ type: 'enroll_accept', enrollmentId: derived.pairingId }))
  expect((await next()).type).toBe('enroll_complete')
  const nonce = createNonce()
  ws.send(JSON.stringify({ type: 'auth_hello', clientNonce: nonce }))
  const challenge = await next()
  expect(
    await verifyServerProof(
      derived.sharedSecret,
      nonce,
      challenge.serverNonce as string,
      challenge.proof,
    ),
  ).toBe(true)
  ws.send(
    JSON.stringify({
      type: 'auth_proof',
      proof: await createClientProof(derived.sharedSecret, nonce, challenge.serverNonce as string),
    }),
  )
  const channel = await createSecureChannel(
    derived.sharedSecret,
    nonce,
    challenge.serverNonce as string,
    'client',
  )
  const ready = await next()
  expect(await channel.open({ seq: ready.seq, data: ready.data })).toEqual({ type: 'ready' })
  return { ws, channel, secret: derived.sharedSecret }
}

it('retires old credentials and reconnects automatically with fresh ephemeral keys across restarts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-direct-'))
  fs.mkdirSync(path.join(directory, 'browser-user'), { mode: 0o700 })
  fs.writeFileSync(path.join(directory, 'browser-user', 'pairing.json'), 'obsolete', {
    mode: 0o600,
  })
  let previous: string | undefined
  try {
    for (let i = 0; i < 2; i++) {
      const transport = new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 })
      try {
        await transport.start((stream) => {
          stream.write('{"type":"ready"}\n')
          stream.on('data', () => {})
        })
        const { ws, channel, secret } = await connectSession()
        expect(secret).not.toBe(previous)
        previous = secret
        expect(transport.status()).toEqual({ paired: false, enrollmentExpiresAt: null })
        expect(fs.existsSync(path.join(directory, 'browser-user', 'pairing.json'))).toBe(false)
        channel.close()
        const closed = once(ws, 'close')
        ws.close()
        await closed
      } finally {
        await transport.stop()
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
it('rejects foreign Origin and URL paths before any pairing state exists', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ws-origin-'))
  const transport = new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 })
  try {
    await transport.start(() => {
      throw new Error('unauthorized accept')
    })
    for (const [url, origin] of [
      ['ws://127.0.0.1:43128/ws', 'https://evil.test'],
      ['ws://127.0.0.1:43128/wrong', `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`],
      [
        'ws://127.0.0.1:43128/ws?token=anything',
        `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`,
      ],
    ]) {
      const ws = new WebSocket(url!, { origin })
      ws.on('error', () => {})
      await new Promise<void>((resolve) => ws.once('close', () => resolve()))
      expect(transport.status()).toEqual({ paired: false, enrollmentExpiresAt: null })
    }
  } finally {
    await transport.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')(
  'refuses symlinked pairing storage without reading or deleting the target',
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ws-storage-'))
    try {
      fs.mkdirSync(path.join(directory, 'browser-user'), { mode: 0o700 })
      const target = path.join(directory, 'target')
      fs.writeFileSync(target, '{}')
      fs.symlinkSync(target, path.join(directory, 'browser-user', 'pairing.json'))
      const transport = new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 })
      await expect(transport.start(() => {})).rejects.toMatchObject({
        code: 'pairing_storage_unsafe',
      })
      await expect(transport.resetPairing()).rejects.toMatchObject({ code: 'pairing_reset_failed' })
      expect(fs.readFileSync(target, 'utf8')).toBe('{}')
      expect(
        fs.lstatSync(path.join(directory, 'browser-user', 'pairing.json')).isSymbolicLink(),
      ).toBe(true)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  },
)
