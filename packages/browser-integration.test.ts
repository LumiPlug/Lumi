// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect, it, vi } from 'vitest'
import { CoreService } from './core/src/service'
import { startNativeHost } from './browser-native-host/src/index'

/** Real HTTP MCP + OS IPC + Native Messaging framing; Chrome itself is a fixture. */
it('routes two MCP clients through the existing Lumi Core/native host in one serial control domain', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-brow-'))
  const extensionId = 'a'.repeat(32),
    token = 'fixture-browser-token-01234567890123456789'
  const core = new CoreService({
    userDataDir: root,
    host: '127.0.0.1',
    port: 0,
    sessionToken: token,
  })
  const input = new PassThrough(),
    output = new PassThrough(),
    stderr = new PassThrough()
  const clients: Client[] = []
  let closeNative: (() => void) | undefined,
    active = 0,
    maximum = 0
  let policyEpoch: number | undefined
  const send = (message: unknown) => {
    const json = Buffer.from(JSON.stringify(message)),
      head = Buffer.alloc(4)
    head.writeUInt32LE(json.length)
    input.write(Buffer.concat([head, json]))
  }
  let buffer: Buffer = Buffer.alloc(0)
  output.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const length = buffer.readUInt32LE(0)
      const request = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')) as {
        type: string
        id: string
        tool: string
        epoch?: number
        policyEpoch?: number
      }
      buffer = buffer.subarray(4 + length)
      if (request.type === 'policy') {
        policyEpoch = request.epoch
        continue
      }
      if (request.type !== 'request') continue
      expect(request.policyEpoch).toBe(policyEpoch)
      active++
      maximum = Math.max(maximum, active)
      setTimeout(() => {
        active--
        send({
          type: 'response',
          id: request.id,
          result: { text: 'ORDER-1024', tool: request.tool },
        })
      }, 15)
    }
  })
  try {
    await core.start()
    try {
      await core.browserUser.browser.start(extensionId) // Explicit test setup; no OS registration.
    } catch (error) {
      if (!process.env.CI && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip() // This cloud sandbox denies Unix sockets; CI must execute it.
        return
      }
      throw error
    }
    const locator = path.join(root, 'locator.json')
    fs.writeFileSync(
      locator,
      JSON.stringify({
        version: 1,
        extensionId,
        runtimeFile: core.browserUser.browser.runtimeFile,
      }),
      { mode: 0o600 },
    )
    closeNative = await startNativeHost(`chrome-extension://${extensionId}/`, {
      configFile: locator,
      streams: { stdin: input, stdout: output, stderr },
    })
    await vi.waitFor(() => expect(policyEpoch).toBeTypeOf('number'))
    send({
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
    ).toHaveLength(7)
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
    closeNative?.()
    input.destroy()
    output.destroy()
    stderr.destroy()
    await Promise.all(clients.map((client) => client.close()))
    await core.stop()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
