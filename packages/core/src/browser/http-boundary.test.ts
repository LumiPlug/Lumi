// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { CoreService } from '../service'

it('Browser User settings require desktop host credentials, not the shared MCP token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-browser-http-'))
  const token = 'fixture-browser-session-token-0123456789'
  const host = 'fixture-browser-host-token-0123456789012345'
  const service = new CoreService({
    userDataDir: root,
    host: '127.0.0.1',
    port: 0,
    sessionToken: token,
    hostToken: host,
  })
  try {
    await service.start()
    const base = `http://127.0.0.1:${service.port}`
    const headers = { 'x-lumiplug-session-token': token, 'content-type': 'application/json' }
    for (const route of ['status', 'action']) {
      const result = await fetch(`${base}/app/browser-user/${route}`, {
        headers,
        ...(route === 'action'
          ? {
              method: 'POST',
              body: JSON.stringify({
                action: 'enable',
                extensionId: 'a'.repeat(32),
                confirmed: true,
              }),
            }
          : {}),
      })
      expect(result.status).toBe(403)
    }
    const status = await fetch(`${base}/app/browser-user/status`, {
      headers: { ...headers, 'x-lumiplug-host-token': host },
    })
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      ok: true,
      data: { enabled: false, controlDomain: 'shared-lumi' },
    })
    const noConsent = await fetch(`${base}/app/browser-user/action`, {
      method: 'POST',
      headers: { ...headers, 'x-lumiplug-host-token': host },
      body: JSON.stringify({ action: 'enable', extensionId: 'a'.repeat(32) }),
    })
    expect(noConsent.status).toBe(400)
    expect(await noConsent.json()).toMatchObject({
      error: { code: 'browser_confirmation_required' },
    })
    for (const extra of [
      { autoRepair: 'true' },
      { migrateConfirmed: 'true' },
      { confirmed: 'true' },
    ]) {
      const invalid = await fetch(`${base}/app/browser-user/action`, {
        method: 'POST',
        headers: { ...headers, 'x-lumiplug-host-token': host },
        body: JSON.stringify({ action: 'enable', confirmed: true, ...extra }),
      })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ error: { code: 'browser_action_invalid' } })
    }
    const noScope = await fetch(`${base}/app/browser-user/action`, {
      method: 'POST',
      headers: { ...headers, 'x-lumiplug-host-token': host },
      body: JSON.stringify({ action: 'enable', confirmed: true }),
    })
    expect(noScope.status).toBe(400)
    expect(await noScope.json()).toMatchObject({
      error: { code: 'browser_scope_confirmation_required' },
    })
    for (const headersForRequest of [headers, { ...headers, 'x-lumiplug-host-token': host }]) {
      const deniedPolicy = await fetch(`${base}/app/browser-user/action`, {
        method: 'POST',
        headers: headersForRequest,
        body: JSON.stringify({
          action: 'setBlockedUrls',
          blockedUrls: ['https://example.com/private?secret=1'],
        }),
      })
      expect(deniedPolicy.status).toBe('x-lumiplug-host-token' in headersForRequest ? 400 : 403)
    }
    const policy = await fetch(`${base}/app/browser-user/action`, {
      method: 'POST',
      headers: { ...headers, 'x-lumiplug-host-token': host },
      body: JSON.stringify({
        action: 'setBlockedUrls',
        confirmed: true,
        blockedUrls: ['https://example.com/private?secret=1#fragment'],
      }),
    })
    expect(policy.status).toBe(200)
    expect(await policy.json()).toMatchObject({
      ok: true,
      data: { blockedUrls: ['https://example.com/private'], enabled: false },
    })
    const automaticWithoutConsent = await fetch(`${base}/app/browser-user/action`, {
      method: 'POST',
      headers: { ...headers, 'x-lumiplug-host-token': host },
      body: JSON.stringify({ action: 'enable', autoRepair: true, migrateConfirmed: true }),
    })
    expect(await automaticWithoutConsent.json()).toMatchObject({
      error: { code: 'browser_confirmation_required' },
    })
    expect(
      service.registry.listMcpTools().some((tool) => tool.name.startsWith('Lumi.browser_')),
    ).toBe(false)
    await expect(service.registry.invoke('Lumi.browser_list_sessions', {})).rejects.toMatchObject({
      code: 'ai_tool_not_found_or_disabled',
    })
  } finally {
    await service.stop()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
