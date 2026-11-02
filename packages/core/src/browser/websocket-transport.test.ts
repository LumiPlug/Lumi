// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { expect, it, vi } from 'vitest'
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

it('requires both matching confirmations, authenticates reconnect and encrypts business frames', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ws-'))
  const transport = new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 })
  let accepted = 0
  try {
    await transport.start((stream) => {
      accepted++
      stream.write('{"type":"ready"}\n')
      stream.on('data', () => {})
    })
    const ws = new WebSocket('ws://127.0.0.1:43128/ws', {
      origin: `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`,
    })
    const inbox: unknown[] = []
    const waiters: ((v: unknown) => void)[] = []
    ws.on('message', (data) => {
      const value: unknown = JSON.parse(data.toString())
      const waiter = waiters.shift()
      if (waiter) waiter(value)
      else inbox.push(value)
    })
    const next = async (): Promise<Record<string, unknown>> =>
      (inbox.length
        ? inbox.shift()
        : await new Promise<unknown>((resolve) => waiters.push(resolve))) as Record<string, unknown>
    await once(ws, 'open')
    const client = await createPairingHello('client')
    ws.send(
      JSON.stringify({
        type: 'pair_commit',
        commitment: await commitPairingHello(client.hello, 'client'),
      }),
    )
    const commitment = await next()
    ws.send(JSON.stringify({ type: 'pair_hello', hello: client.hello }))
    const offer = await next()
    expect(await verifyPairingCommitment(offer.hello, 'server', commitment.commitment)).toBe(true)
    const derived = await finishPairing(client.state, offer.hello)
    expect(transport.status().pairing?.code).toBe(derived.sas)
    await expect(transport.approvePairing(derived.pairingId, '000000')).rejects.toThrow()
    await transport.approvePairing(derived.pairingId, derived.sas)
    expect(accepted).toBe(0)
    expect(transport.status().paired).toBe(false)
    expect(fs.existsSync(path.join(directory, 'browser-user', 'pairing.json'))).toBe(false)
    await expect(transport.approvePairing('different-candidate', derived.sas)).rejects.toThrow()
    // Human code comparison may take longer than the initial 5-second handshake window.
    await new Promise((resolve) => setTimeout(resolve, 5100))
    ws.send(JSON.stringify({ type: 'pair_confirm', pairingId: derived.pairingId }))
    expect((await next()).type).toBe('pair_complete')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    expect(transport.status().paired).toBe(true)
    const c = createNonce()
    ws.send(JSON.stringify({ type: 'auth_hello', clientNonce: c }))
    const challenge = await next()
    expect(
      await verifyServerProof(
        derived.sharedSecret,
        c,
        challenge.serverNonce as string,
        challenge.proof,
      ),
    ).toBe(true)
    const channel = await createSecureChannel(
      derived.sharedSecret,
      c,
      challenge.serverNonce as string,
      'client',
    )
    ws.send(
      JSON.stringify({
        type: 'auth_proof',
        proof: await createClientProof(derived.sharedSecret, c, challenge.serverNonce as string),
      }),
    )
    const ready = await next()
    expect(ready.type).toBe('secure')
    expect(await channel.open({ seq: ready.seq, data: ready.data })).toEqual({ type: 'ready' })
    expect(accepted).toBe(1)
    const firstClosed = once(ws, 'close')
    ws.close()
    await firstClosed
    const reconnect = new WebSocket('ws://127.0.0.1:43128/ws', {
      origin: `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`,
    })
    await once(reconnect, 'open')
    const c2 = createNonce()
    const challengePending = once(reconnect, 'message')
    reconnect.send(JSON.stringify({ type: 'auth_hello', clientNonce: c2 }))
    const challenge2 = JSON.parse(String((await challengePending)[0])) as {
      serverNonce: string
      proof: string
    }
    expect(
      await verifyServerProof(derived.sharedSecret, c2, challenge2.serverNonce, challenge2.proof),
    ).toBe(true)
    const readyPending = once(reconnect, 'message')
    reconnect.send(
      JSON.stringify({
        type: 'auth_proof',
        proof: await createClientProof(derived.sharedSecret, c2, challenge2.serverNonce),
      }),
    )
    const channel2 = await createSecureChannel(
      derived.sharedSecret,
      c2,
      challenge2.serverNonce,
      'client',
    )
    const ready2 = JSON.parse(String((await readyPending)[0])) as { seq: number; data: string }
    expect(await channel2.open({ seq: ready2.seq, data: ready2.data })).toEqual({ type: 'ready' })
    expect(accepted).toBe(2)
    const closed = once(reconnect, 'close')
    await transport.resetPairing()
    expect(transport.status().paired).toBe(false)
    expect(fs.existsSync(path.join(directory, 'browser-user', 'pairing.json'))).toBe(false)
    await transport.stop()
    await closed
    expect(transport.status().pairing).toBe(null)
    await expect(transport.approvePairing(derived.pairingId, derived.sas)).rejects.toThrow()
  } finally {
    await transport.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}, 10_000)

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
      expect(transport.status()).toEqual({ paired: false, pairing: null })
    }
  } finally {
    await transport.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')(
  'refuses symlinked pairing storage without reading the target',
  () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ws-storage-'))
    try {
      fs.mkdirSync(path.join(directory, 'browser-user'), { mode: 0o700 })
      const target = path.join(directory, 'target')
      fs.writeFileSync(target, '{}')
      fs.symlinkSync(target, path.join(directory, 'browser-user', 'pairing.json'))
      expect(
        () => new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 }),
      ).toThrow('unsafe')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  },
)

it('rejects wrong, reflected and previous-connection client proofs without accepting business', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ws-auth-'))
  fs.mkdirSync(path.join(directory, 'browser-user'), { mode: 0o700 })
  const secret = Buffer.alloc(32, 11).toString('base64url')
  fs.writeFileSync(
    path.join(directory, 'browser-user', 'pairing.json'),
    JSON.stringify({ version: 1, secret }),
    { mode: 0o600 },
  )
  const transport = new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 })
  let accepted = 0
  try {
    await transport.start(() => {
      accepted++
    })
    let previousProof = ''
    for (const variant of ['wrong', 'reflection', 'replay']) {
      const ws = new WebSocket('ws://127.0.0.1:43128/ws', {
        origin: `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`,
      })
      await once(ws, 'open')
      const nonce = createNonce()
      const pending = once(ws, 'message')
      ws.send(JSON.stringify({ type: 'auth_hello', clientNonce: nonce }))
      const challenge = JSON.parse(String((await pending)[0])) as {
        serverNonce: string
        proof: string
      }
      const correct = await createClientProof(secret, nonce, challenge.serverNonce)
      const proof =
        variant === 'wrong'
          ? 'A'.repeat(43)
          : variant === 'reflection'
            ? challenge.proof
            : previousProof
      previousProof = correct
      const closed = once(ws, 'close')
      ws.send(JSON.stringify({ type: 'auth_proof', proof }))
      await closed
      expect(accepted).toBe(0)
    }
  } finally {
    await transport.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

it('expired pairing approval and disconnected candidate cannot persist credentials', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ws-expiry-'))
  const transport = new BrowserWebSocketTransport({ userDataDir: directory, testPort: 43128 })
  try {
    await transport.start(() => {
      throw new Error('unexpected authentication')
    })
    const ws = new WebSocket('ws://127.0.0.1:43128/ws', {
      origin: `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`,
    })
    await once(ws, 'open')
    const client = await createPairingHello('client')
    let pending = once(ws, 'message')
    ws.send(
      JSON.stringify({
        type: 'pair_commit',
        commitment: await commitPairingHello(client.hello, 'client'),
      }),
    )
    await pending
    pending = once(ws, 'message')
    ws.send(JSON.stringify({ type: 'pair_hello', hello: client.hello }))
    const offer = JSON.parse(String((await pending)[0])) as { hello: unknown; expiresAt: number }
    const derived = await finishPairing(client.state, offer.hello)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(offer.expiresAt + 1)
    try {
      await expect(transport.approvePairing(derived.pairingId, derived.sas)).rejects.toThrow()
    } finally {
      clock.mockRestore()
    }
    const closed = once(ws, 'close')
    ws.close()
    await closed
    // The client's close event can precede the server's FIN/close callback.
    await vi.waitFor(() => expect(transport.status().pairing).toBe(null))
    await expect(transport.approvePairing(derived.pairingId, derived.sas)).rejects.toThrow()
    expect(fs.existsSync(path.join(directory, 'browser-user', 'pairing.json'))).toBe(false)
  } finally {
    await transport.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
