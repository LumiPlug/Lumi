// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
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
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect, it, vi } from 'vitest'
import { CoreService } from '../service'

/** Real HTTP MCP + encrypted loopback WebSocket; Chrome itself is a fixture. */
it('routes two MCP clients through the existing Lumi Core WebSocket in one serial control domain', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-brow-'))
  const extensionId = OFFICIAL_BROWSER_EXTENSION_ID,
    token = 'fixture-browser-token-01234567890123456789'
  const core = new CoreService({
    userDataDir: root,
    host: '127.0.0.1',
    port: 0,
    sessionToken: token,
  })
  const clients: Client[] = []
  let socket: WebSocket | undefined
  let active = 0,
    maximum = 0
  let policyEpoch: number | undefined
  let channel: Awaited<ReturnType<typeof createSecureChannel>> | undefined
  const send = async (message: unknown) => {
    socket!.send(JSON.stringify({ type: 'secure', ...(await channel!.seal(message)) }))
  }
  try {
    await core.start()
    try {
      await core.browserUser.browser.start(extensionId, [], { enroll: true }) // Explicit fixture consent; no OS registration.
    } catch (error) {
      if (!process.env.CI && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip() // This cloud sandbox may deny loopback sockets; CI must execute it.
        return
      }
      throw error
    }
    socket = new WebSocket('ws://127.0.0.1:43127/ws', {
      origin: `chrome-extension://${extensionId}`,
    })
    const inbox: Record<string, unknown>[] = []
    const waiters: ((value: Record<string, unknown>) => void)[] = []
    let processing = Promise.resolve()
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>
      if (frame.type !== 'secure') {
        const waiter = waiters.shift()
        if (waiter) waiter(frame)
        else inbox.push(frame)
        return
      }
      processing = processing.then(async () => {
        const request = (await channel!.open({ seq: frame.seq, data: frame.data })) as Record<
          string,
          unknown
        >
        if (request.type === 'ping') {
          await send({ type: 'pong' })
          return
        }
        if (request.type === 'policy') {
          policyEpoch = request.epoch as number
          return
        }
        if (request.type !== 'request') return
        expect(request.policyEpoch).toBe(policyEpoch)
        active++
        maximum = Math.max(maximum, active)
        setTimeout(() => {
          active--
          void send({
            type: 'response',
            id: request.id,
            result: { text: 'ORDER-1024', tool: request.tool },
          })
        }, 15)
      })
    })
    const next = async (): Promise<Record<string, unknown>> =>
      inbox.length ? inbox.shift()! : new Promise((resolve) => waiters.push(resolve))
    await once(socket, 'open')
    const pairing = await createPairingHello('client')
    socket.send(
      JSON.stringify({
        type: 'enroll_commit',
        commitment: await commitPairingHello(pairing.hello, 'client'),
      }),
    )
    const commitment = await next()
    socket.send(JSON.stringify({ type: 'enroll_hello', hello: pairing.hello }))
    const offer = await next()
    expect(await verifyPairingCommitment(offer.hello, 'server', commitment.commitment)).toBe(true)
    const derived = await finishPairing(pairing.state, offer.hello)
    socket.send(JSON.stringify({ type: 'enroll_accept', enrollmentId: derived.pairingId }))
    expect((await next()).type).toBe('enroll_complete')
    const nonce = createNonce()
    socket.send(JSON.stringify({ type: 'auth_hello', clientNonce: nonce }))
    const challenge = await next()
    expect(
      await verifyServerProof(
        derived.sharedSecret,
        nonce,
        challenge.serverNonce as string,
        challenge.proof,
      ),
    ).toBe(true)
    channel = await createSecureChannel(
      derived.sharedSecret,
      nonce,
      challenge.serverNonce as string,
      'client',
    )
    socket.send(
      JSON.stringify({
        type: 'auth_proof',
        proof: await createClientProof(
          derived.sharedSecret,
          nonce,
          challenge.serverNonce as string,
        ),
      }),
    )
    await vi.waitFor(() => expect(policyEpoch).toBeTypeOf('number'))
    await send({
      type: 'sessions',
      policyEpoch,
      sessions: [
        {
          id: 'fixture-tab',
          tabId: 1,
          title: 'Orders',
          url: 'https://example.test',
          origin: 'https://example.test',
          state: 'active',
        },
      ],
    })
    await vi.waitFor(() => expect(core.browserUser.browser.status().sessions).toHaveLength(1))
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: `fixture-agent-${i}`, version: '1' })
      clients.push(client)
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${core.port}/mcp`), {
          requestInit: { headers: { 'x-lumiplug-session-token': token } },
        }),
      )
    }
    expect(
      (await clients[0]!.listTools()).tools.filter((tool) => tool.name.startsWith('Lumi.browser_')),
    ).toHaveLength(12)
    const sessions = await clients[0]!.callTool({
      name: 'Lumi.browser_list_sessions',
      arguments: {},
    })
    expect(sessions.structuredContent).toMatchObject({
      controlDomain: 'shared-lumi',
      sessions: [{ id: 'fixture-tab' }],
    })
    const result = await Promise.all(
      clients.map((client) =>
        client.callTool({
          name: 'Lumi.browser_read_text',
          arguments: { sessionId: 'fixture-tab' },
        }),
      ),
    )
    expect(result.map((value) => value.structuredContent)).toEqual([
      { text: 'ORDER-1024', tool: 'read_text' },
      { text: 'ORDER-1024', tool: 'read_text' },
    ])
    expect(maximum).toBe(1)
    const oldEpoch = policyEpoch
    core.browserUser.browser.setBlockedUrls(['https://example.test/?private=1#section'])
    await vi.waitFor(() => expect(policyEpoch).not.toBe(oldEpoch))
    const filtered = await clients[0]!.callTool({
      name: 'Lumi.browser_list_sessions',
      arguments: {},
    })
    expect(filtered.structuredContent).toMatchObject({ sessions: [] })
    const blocked = await clients[0]!.callTool({
      name: 'Lumi.browser_read_text',
      arguments: { sessionId: 'fixture-tab' },
    })
    expect(blocked.isError).toBe(true)
    await core.browserUser.browser.disable()
    expect(
      (await clients[0]!.listTools()).tools.some((tool) => tool.name.startsWith('Lumi.browser_')),
    ).toBe(false)
  } finally {
    socket?.terminate()
    channel?.close()
    await Promise.all(clients.map((client) => client.close()))
    await core.stop()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
