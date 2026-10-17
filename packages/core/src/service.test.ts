// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createConnection } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { CoreService } from './service'
import { parseRuntimeConfig } from './config'
import { DEFAULT_MCP_PORT } from '@lumiplug/shared'

describe('Core HTTP boundary', () => {
  it('serves health and protects app routes with host, origin and session checks', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumiplug-core-test-'))
    const service = new CoreService({
      host: '127.0.0.1',
      port: 0,
      sessionToken: '0123456789abcdef0123456789abcdef',
      hostToken: 'host-fixture-token-0123456789abcdef',
      userDataDir,
    })

    try {
      await service.start()
      const baseUrl = `http://127.0.0.1:${service.port}`

      const healthResponse = await fetch(`${baseUrl}/healthz`)
      expect(healthResponse.status).toBe(200)
      await expect(healthResponse.json()).resolves.toMatchObject({ status: 'ok' })

      const missingToken = await fetch(`${baseUrl}/app/capabilities`)
      expect(missingToken.status).toBe(401)

      const skillHeaders = {
        'content-type': 'application/json',
        'x-lumiplug-session-token': '0123456789abcdef0123456789abcdef',
      }
      const untrustedSkills = await fetch(`${baseUrl}/app/skills/scan`, { method: 'POST' })
      expect(untrustedSkills.status).toBe(401)
      const skillsList = await fetch(`${baseUrl}/app/skills`, { headers: skillHeaders })
      await expect(skillsList.json()).resolves.toMatchObject({
        ok: true,
        data: { skills: [], scannedAt: null },
      })
      const skillDirectory = path.join(userDataDir, 'skill')
      fs.mkdirSync(skillDirectory)
      fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), '# Local skill')
      const skillId = 'a'.repeat(64)
      service.database.raw
        .prepare('INSERT INTO skill_inventory (id, metadata_json, archived) VALUES (?, ?, 0)')
        .run(
          skillId,
          JSON.stringify({
            id: skillId,
            name: 'fixture',
            path: await fs.promises.realpath(path.join(skillDirectory, 'SKILL.md')),
            present: true,
            sources: [],
            archived: false,
          }),
        )
      const archivedSkill = await fetch(`${baseUrl}/app/skills/archive`, {
        method: 'POST',
        headers: skillHeaders,
        body: JSON.stringify({ id: skillId, archived: true }),
      })
      await expect(archivedSkill.json()).resolves.toMatchObject({
        ok: true,
        data: { skills: [{ id: skillId, archived: true }] },
      })
      const privateFile = await fetch(`${baseUrl}/app/skills/file`, {
        method: 'POST',
        body: JSON.stringify({ id: skillId, path: 'SKILL.md' }),
      })
      expect(privateFile.status).toBe(401)
      const fileTree = await fetch(`${baseUrl}/app/skills/directory`, {
        method: 'POST',
        headers: skillHeaders,
        body: JSON.stringify({ id: skillId }),
      })
      await expect(fileTree.json()).resolves.toMatchObject({
        ok: true,
        data: { entries: [{ path: 'SKILL.md', kind: 'file' }] },
      })
      const localFile = await fetch(`${baseUrl}/app/skills/file`, {
        method: 'POST',
        headers: skillHeaders,
        body: JSON.stringify({ id: skillId, path: 'SKILL.md' }),
      })
      await expect(localFile.json()).resolves.toMatchObject({
        ok: true,
        data: { kind: 'markdown', content: '# Local skill' },
      })
      const outsideFile = await fetch(`${baseUrl}/app/skills/file`, {
        method: 'POST',
        headers: skillHeaders,
        body: JSON.stringify({ id: skillId, path: '../outside' }),
      })
      expect(outsideFile.status).toBe(400)
      await expect(outsideFile.json()).resolves.toMatchObject({
        error: { code: 'invalid_skill_file' },
      })
      const badSkill = await fetch(`${baseUrl}/app/skills/archive`, {
        method: 'POST',
        headers: skillHeaders,
        body: JSON.stringify({ id: '../escape', archived: true }),
      })
      expect(badSkill.status).toBe(400)

      const invalidProject = await fetch(`${baseUrl}/app/skills/project`, {
        method: 'POST',
        headers: skillHeaders,
        body: JSON.stringify({ path: 'relative' }),
      })
      expect(invalidProject.status).toBe(400)
      await expect(invalidProject.json()).resolves.toMatchObject({
        error: { code: 'invalid_skill_project' },
      })
      const projectFailure = vi
        .spyOn(service.skills, 'addProject')
        .mockRejectedValue(new Error('storage_unavailable'))
      try {
        const unavailable = await fetch(`${baseUrl}/app/skills/project`, {
          method: 'POST',
          headers: skillHeaders,
          body: JSON.stringify({ path: userDataDir }),
        })
        expect(unavailable.status).toBe(500)
        await expect(unavailable.json()).resolves.toMatchObject({
          error: { code: 'skill_project_failed' },
        })
      } finally {
        projectFailure.mockRestore()
      }

      const untrustedMcp = await fetch(`${baseUrl}/mcp`, { method: 'POST' })
      expect(untrustedMcp.status).toBe(401)

      const invalidOrigin = await fetch(`${baseUrl}/app/capabilities`, {
        headers: {
          origin: 'https://unexpected.example',
          'x-lumiplug-session-token': '0123456789abcdef0123456789abcdef',
        },
      })
      expect(invalidOrigin.status).toBe(403)

      // Desktop IPC reads the raw body as JSON, without a chunked transfer decoder.
      const rawResponse = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: service.port })
        let raw = ''
        socket.setTimeout(3000, () => socket.destroy(new Error('response timeout')))
        socket.on('connect', () =>
          socket.write(
            `GET /app/mcp/check HTTP/1.1\r\nHost: 127.0.0.1:${service.port}\r\nOrigin: tauri://localhost\r\nx-lumiplug-session-token: 0123456789abcdef0123456789abcdef\r\nConnection: close\r\n\r\n`,
          ),
        )
        socket.on('data', (chunk) => {
          raw += chunk.toString()
        })
        socket.on('end', () => resolve(raw))
        socket.on('error', reject)
      })
      const boundary = rawResponse.indexOf('\r\n\r\n')
      const rawHeaders = rawResponse.slice(0, boundary).toLowerCase()
      const rawBody = rawResponse.slice(boundary + 4)
      expect(rawHeaders).not.toContain('transfer-encoding: chunked')
      expect(rawHeaders).toContain(`content-length: ${Buffer.byteLength(rawBody)}`)
      expect(JSON.parse(rawBody)).toMatchObject({
        data: { ok: true, lastExternalActivityAt: null },
      })

      const statusResponse = await fetch(`${baseUrl}/app/capabilities`, {
        headers: {
          origin: 'http://127.0.0.1:1420',
          'x-lumiplug-host-token': 'host-fixture-token-0123456789abcdef',
          'x-lumiplug-session-token': '0123456789abcdef0123456789abcdef',
        },
      })
      expect(statusResponse.status).toBe(200)
      await expect(statusResponse.json()).resolves.toMatchObject({
        ok: true,
        data: { capabilities: [] },
      })
    } finally {
      await service.stop()
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})

describe('persistent desktop MCP connection', () => {
  it('uses a fixed default port while allowing explicit ephemeral ports for isolated tests', () => {
    expect(parseRuntimeConfig([], {}).port).toBe(DEFAULT_MCP_PORT)
    expect(parseRuntimeConfig(['--port', '0'], {}).port).toBe(0)
    expect(parseRuntimeConfig(['--port', '38492'], {}).port).toBe(38492)
    expect(() => parseRuntimeConfig(['--port', '65536'], {})).toThrow('invalid_port')
  })
  it('requires host authorization to rotate, persists the new token and rejects the old token after restart', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-token-test-'))
    const oldToken = 'test-old-mcp-token-0123456789abcdef'
    const hostToken = 'test-private-host-token-0123456789abcdef'
    let service = new CoreService({
      host: '127.0.0.1',
      port: 0,
      sessionToken: oldToken,
      hostToken,
      userDataDir,
    })
    try {
      await service.start()
      let base = `http://127.0.0.1:${service.port}`
      const unauthorized = await fetch(`${base}/app/mcp/token`, {
        method: 'POST',
        headers: { 'x-lumiplug-session-token': oldToken },
      })
      expect(unauthorized.status).toBe(403)
      expect(fs.existsSync(path.join(userDataDir, 'mcp-token'))).toBe(false)
      const rotated = await fetch(`${base}/app/mcp/token`, {
        method: 'POST',
        headers: { 'x-lumiplug-session-token': oldToken, 'x-lumiplug-host-token': hostToken },
      })
      expect(rotated.status).toBe(200)
      const result = (await rotated.json()) as { data: { sessionToken: string } }
      const newToken = result.data.sessionToken
      expect(newToken).toMatch(/^[a-f0-9]{64}$/)
      expect(newToken).not.toBe(oldToken)
      expect(fs.readFileSync(path.join(userDataDir, 'mcp-token'), 'utf8')).toBe(newToken)
      if (process.platform !== 'win32')
        expect(fs.statSync(path.join(userDataDir, 'mcp-token')).mode & 0o777).toBe(0o600)
      expect(
        (
          await fetch(`${base}/app/capabilities`, {
            headers: { 'x-lumiplug-session-token': oldToken },
          })
        ).status,
      ).toBe(401)
      expect(
        (
          await fetch(`${base}/app/capabilities`, {
            headers: { 'x-lumiplug-session-token': newToken, 'x-lumiplug-host-token': hostToken },
          })
        ).status,
      ).toBe(200)
      await service.stop()
      service = new CoreService({
        host: '127.0.0.1',
        port: 0,
        sessionToken: fs.readFileSync(path.join(userDataDir, 'mcp-token'), 'utf8'),
        hostToken,
        userDataDir,
      })
      await service.start()
      base = `http://127.0.0.1:${service.port}`
      expect(
        (
          await fetch(`${base}/mcp`, {
            method: 'POST',
            headers: { 'x-lumiplug-session-token': oldToken },
          })
        ).status,
      ).toBe(401)
      expect(
        (
          await fetch(`${base}/app/capabilities`, {
            headers: { 'x-lumiplug-session-token': newToken, 'x-lumiplug-host-token': hostToken },
          })
        ).status,
      ).toBe(200)
    } finally {
      await service.stop()
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
