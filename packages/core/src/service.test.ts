// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoreService } from './service'

describe('Core HTTP boundary', () => {
  it('serves health and protects app routes with host, origin and session checks', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumiplug-core-test-'))
    const service = new CoreService({
      host: '127.0.0.1',
      port: 0,
      sessionToken: '0123456789abcdef0123456789abcdef',
      userDataDir,
      parentPid: process.ppid,
    })

    try {
      await service.start()
      const baseUrl = `http://127.0.0.1:${service.port}`

      const healthResponse = await fetch(`${baseUrl}/healthz`)
      expect(healthResponse.status).toBe(200)
      await expect(healthResponse.json()).resolves.toMatchObject({ status: 'ok' })

      const missingToken = await fetch(`${baseUrl}/app/status`)
      expect(missingToken.status).toBe(401)

      const untrustedMcp = await fetch(`${baseUrl}/mcp`, { method: 'POST' })
      expect(untrustedMcp.status).toBe(401)

      const invalidOrigin = await fetch(`${baseUrl}/app/status`, {
        headers: {
          origin: 'https://unexpected.example',
          'x-lumiplug-session-token': '0123456789abcdef0123456789abcdef',
        },
      })
      expect(invalidOrigin.status).toBe(403)

      const statusResponse = await fetch(`${baseUrl}/app/status`, {
        headers: {
          origin: 'http://127.0.0.1:1420',
          'x-lumiplug-session-token': '0123456789abcdef0123456789abcdef',
        },
      })
      expect(statusResponse.status).toBe(200)
      await expect(statusResponse.json()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ready', userDataPathAvailable: true },
      })

      const eventsResponse = await fetch(`${baseUrl}/events`, {
        headers: {
          origin: 'http://127.0.0.1:1420',
          'x-lumiplug-session-token': '0123456789abcdef0123456789abcdef',
        },
      })
      expect(eventsResponse.status).toBe(200)
      expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream')
      const reader = eventsResponse.body?.getReader()
      const firstChunk = await reader?.read()
      expect(Buffer.from(firstChunk?.value ?? []).toString('utf8')).toContain('core.status')
      await reader?.cancel()
    } finally {
      await service.stop()
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
