// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { CoreService } from '../service'
import { standardRoots } from './discovery'
it('restricts every usage action to the desktop host and survives isolated Core restart', async () => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-usage-http-'))),
    roots = standardRoots(home)
  const config = {
    host: '127.0.0.1' as const,
    port: 0,
    sessionToken: 'synthetic-session-token-only-usage',
    hostToken: 'synthetic-host-token-only-usage-0123456789',
    userDataDir: path.join(home, 'data'),
    usageRoots: roots,
  }
  let core = new CoreService(config)
  const headers = {
    'content-type': 'application/json',
    'x-lumiplug-session-token': config.sessionToken,
    'x-lumiplug-host-token': config.hostToken,
  }
  const payload = { start: '2026-10-09T00:00:00Z', end: '2026-10-12T00:00:00Z', timezone: 'UTC' }
  try {
    await fs.mkdir(roots[0]!.directory, { recursive: true })
    await fs.copyFile(
      path.join(__dirname, 'fixtures/codex.jsonl'),
      path.join(roots[0]!.directory, 'session.jsonl'),
    )
    const index = path.join(home, '.codex/session_index.jsonl')
    await fs.writeFile(
      index,
      JSON.stringify({ id: 'synthetic-session', thread_name: 'Original session' }) + '\n',
    )
    await core.start()
    let url = `http://127.0.0.1:${core.port}/app/usage`
    for (const action of ['query', 'sessions', 'export', 'scan', 'pause']) {
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'x-lumiplug-host-token': '' },
            body: JSON.stringify({ action, payload: { ...payload, paused: true } }),
          })
        ).status,
      ).toBe(403)
    }
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'x-lumiplug-session-token': '' },
          body: '{}',
        })
      ).status,
    ).toBe(401)
    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'scan', payload }),
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        totals: { total: 160 },
        matched: 2,
        records: [
          expect.objectContaining({ sessionName: 'Original session' }),
          expect.objectContaining({ sessionName: 'Original session' }),
        ],
      },
    })
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'sessions', payload }),
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        matched: 1,
        truncated: false,
        sessions: [
          expect.objectContaining({ sessionName: 'Original session', total: 160, count: 2 }),
        ],
      },
    })
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'query', payload: { start: 'invalid' } }),
        })
      ).status,
    ).toBe(400)
    for (const action of ['scan', 'pause']) {
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              action,
              payload: { ...payload, start: 'invalid', paused: true },
            }),
          })
        ).status,
      ).toBe(400)
      expect(core.usage.paused).toBe(false)
    }
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, origin: 'https://untrusted.invalid' },
          body: JSON.stringify({ action: 'query', payload }),
        })
      ).status,
    ).toBe(403)
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'pause', payload: { ...payload, paused: true } }),
    })
    expect(await response.json()).toMatchObject({ ok: true, data: { paused: true } })
    await core.stop()
    core = new CoreService(config)
    await core.start()
    url = `http://127.0.0.1:${core.port}/app/usage`
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'query', payload }),
    })
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, data: { paused: true, totals: { total: 160 } } })
    expect(JSON.stringify(body)).not.toContain(home)
    await fs.appendFile(
      index,
      JSON.stringify({ id: 'synthetic-session', thread_name: 'Renamed session' }) + '\n',
    )
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'scan', payload }),
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        paused: false,
        totals: { total: 160 },
        records: [
          expect.objectContaining({ sessionName: 'Renamed session' }),
          expect.objectContaining({ sessionName: 'Renamed session' }),
        ],
      },
    })
  } finally {
    await core.stop()
    await fs.rm(home, { recursive: true, force: true })
  }
})
