// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import type { TransformCallback } from 'node:stream'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { BrowserService } from './service'
import {
  BrowserFrames,
  MAX_BROWSER_FRAME,
  validateBrowserArguments,
  writeBrowserFrame,
} from './protocol'
import type { BrowserMessage } from './protocol'
import { BROWSER_TOOLS } from './tools'

const extensionId = 'a'.repeat(32)
const sample = {
  id: 'session-one',
  tabId: 1,
  title: 'Fixture',
  url: 'https://example.test',
  origin: 'https://example.test',
  state: 'active',
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function inbox(stream: NodeJS.EventEmitter) {
  const values: BrowserMessage[] = [],
    waiters: ((value: BrowserMessage) => void)[] = []
  stream.on('data', (value: BrowserMessage) => {
    const waiter = waiters.shift()
    if (waiter) waiter(value)
    else values.push(value)
  })
  return async (): Promise<BrowserMessage> => {
    const value = values.shift()
    if (value) return value
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture response timeout')), 1500)
      waiters.push((item) => {
        clearTimeout(timer)
        resolve(item)
      })
    })
  }
}
class FakeSocket extends Duplex {
  peer?: FakeSocket
  override _read(): void {}
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    if (!this.peer || this.peer.destroyed) {
      done(new Error('Fixture peer closed'))
      return
    }
    this.peer.push(Buffer.from(chunk))
    done()
  }
  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    if (this.peer && !this.peer.destroyed) this.peer.destroy()
    done(error)
  }
}
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-browser-core-'))
  let handler: (socket: Duplex) => void = () => {}
  let enrollmentCalls = 0
  const transport = {
    async start(listener: (socket: Duplex) => void) {
      handler = listener
    },
    async stop() {},
    status() {
      return { paired: true, enrollmentExpiresAt: null }
    },
    openEnrollment() {
      enrollmentCalls++
    },
    async resetPairing() {},
  }
  const service = new BrowserService({
    userDataDir: directory,
    transportFactory: () => transport,
    requestTimeoutMs: 20,
  })
  async function host() {
    const socket = new FakeSocket(),
      peer = new FakeSocket()
    socket.peer = peer
    peer.peer = socket
    socket.on('error', () => {})
    const frames = new BrowserFrames()
    socket.pipe(frames)
    const next = inbox(frames)
    handler(peer)
    return { socket, next }
  }
  return {
    service,
    get enrollmentCalls() {
      return enrollmentCalls
    },
    directory,
    host,
    async stop() {
      await service.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

async function readyFixture() {
  const context = await fixture()
  await context.service.start(extensionId)
  const host = await context.host()
  expect(await host.next()).toEqual({ type: 'ready' })
  expect(await host.next()).toMatchObject({
    type: 'policy',
    epoch: context.service.status().policyEpoch,
    blockedUrls: [],
  })
  writeBrowserFrame(host.socket, {
    type: 'sessions',
    policyEpoch: context.service.status().policyEpoch,
    sessions: [sample],
  })
  await tick()
  return { ...context, native: host }
}

describe('Browser User Core service', () => {
  it('constructs disabled, tools cannot enable it, and stop disconnects transport', async () => {
    const context = await fixture()
    try {
      expect(context.service.status()).toMatchObject({
        enabled: false,
        controlDomain: 'shared-lumi',
      })
      await expect(
        context.service.call('snapshot', { sessionId: sample.id }),
      ).rejects.toMatchObject({ code: 'browser_disabled' })
      await expect(context.service.call('authorize', {})).rejects.toMatchObject({
        code: 'unknown_tool',
      })
      await context.service.start(extensionId)
      await context.service.disable()
    } finally {
      await context.stop()
    }
  })
  it('serializes all tools in one shared control domain, preserving Unicode results', async () => {
    const context = await readyFixture()
    try {
      const first = context.service.call('fill', {
        sessionId: sample.id,
        ref: 'ref-1',
        text: '你好🙂',
      })
      const second = context.service.call('snapshot', { sessionId: sample.id })
      const request = await context.native.next()
      expect(request).toMatchObject({ tool: 'fill', args: { text: '你好🙂' } })
      writeBrowserFrame(context.native.socket, {
        type: 'response',
        id: request.id,
        result: { ok: true },
      })
      await expect(first).resolves.toEqual({ ok: true })
      const next = await context.native.next()
      expect(next.tool).toBe('snapshot')
      writeBrowserFrame(context.native.socket, {
        type: 'response',
        id: next.id,
        result: { text: '完成' },
      })
      await expect(second).resolves.toEqual({ text: '完成' })
    } finally {
      await context.stop()
    }
  })
  it('cancels dispatched work as unknown and blocks already queued calls on that session', async () => {
    const context = await readyFixture()
    try {
      const controller = new AbortController()
      const first = context.service.call(
        'click',
        { sessionId: sample.id, ref: 'ref-1' },
        { signal: controller.signal },
      )
      const second = context.service.call('click', { sessionId: sample.id, ref: 'ref-1' })
      const outcomes = Promise.allSettled([first, second])
      const request = await context.native.next()
      controller.abort()
      expect(await context.native.next()).toEqual({ type: 'cancel', id: request.id })
      const result = await outcomes
      expect(result[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'outcome_unknown', outcome: 'unknown' },
      })
      expect(result[1]).toMatchObject({ status: 'rejected', reason: { code: 'session_inactive' } })
      writeBrowserFrame(context.native.socket, {
        type: 'sessions',
        policyEpoch: context.service.status().policyEpoch,
        sessions: [sample],
      })
      await tick()
      expect(context.service.status().sessions[0]?.state).toBe('paused')
      writeBrowserFrame(context.native.socket, {
        type: 'sessions',
        policyEpoch: context.service.status().policyEpoch,
        sessions: [{ ...sample, state: 'paused' }],
      })
      writeBrowserFrame(context.native.socket, {
        type: 'sessions',
        policyEpoch: context.service.status().policyEpoch,
        sessions: [sample],
      })
      await tick()
      expect(context.service.status().sessions[0]?.state).toBe('active')
    } finally {
      await context.stop()
    }
  })
  it('revoke and disable invalidate queues and disconnect extension connection', async () => {
    const context = await readyFixture()
    try {
      const first = context.service.call('click', { sessionId: sample.id, ref: 'r' })
      const second = context.service.call('snapshot', { sessionId: sample.id })
      const outcomes = Promise.allSettled([first, second])
      await context.native.next()
      await context.service.disable()
      const result = await outcomes
      expect(result[0]).toMatchObject({ status: 'rejected', reason: { code: 'outcome_unknown' } })
      expect(result[1]).toMatchObject({ status: 'rejected', reason: { code: 'cancelled' } })
      expect(context.native.socket.destroyed).toBe(true)
      expect(context.service.status().sessions).toEqual([])
    } finally {
      await context.stop()
    }
  })
  it('a lost native connection is unknown after dispatch, disconnected before dispatch', async () => {
    const context = await readyFixture()
    try {
      const pending = context.service.call('click', { sessionId: sample.id, ref: 'r' })
      const outcome = Promise.allSettled([pending])
      await context.native.next()
      context.native.socket.destroy()
      expect((await outcome)[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'outcome_unknown' },
      })
      await expect(
        context.service.call('click', { sessionId: sample.id, ref: 'r' }),
      ).rejects.toMatchObject({ code: 'disconnected' })
    } finally {
      await context.stop()
    }
  })
  it('aborted calls are never dispatched and unauthorized tool arguments are rejected', async () => {
    const context = await readyFixture()
    try {
      await expect(
        context.service.call(
          'click',
          { sessionId: sample.id, ref: 'r' },
          { signal: AbortSignal.abort() },
        ),
      ).rejects.toMatchObject({ code: 'cancelled' })
      await expect(
        context.service.call('fill', { sessionId: sample.id, ref: 'r', value: 'bad' }),
      ).rejects.toMatchObject({ code: 'invalid_arguments' })
      expect(BROWSER_TOOLS).toHaveLength(7)
      expect(BROWSER_TOOLS.every((tool) => tool.name.startsWith('Lumi.browser_'))).toBe(true)
    } finally {
      await context.stop()
    }
  })
})

describe('Browser IPC frames', () => {
  it('parses fragmented Unicode objects and refuses oversized/invalid input', async () => {
    const stream = new PassThrough(),
      frames = new BrowserFrames()
    stream.pipe(frames)
    const next = inbox(frames),
      data = Buffer.from(JSON.stringify({ text: '你好🙂' }) + '\n')
    stream.write(data.subarray(0, 10))
    stream.end(data.subarray(10))
    expect(await next()).toEqual({ text: '你好🙂' })
    for (const data of [Buffer.alloc(MAX_BROWSER_FRAME + 1, 120), Buffer.from('null\n')]) {
      const invalid = new BrowserFrames(),
        error = once(invalid, 'error')
      invalid.resume()
      invalid.end(data)
      expect((await error)[0]).toBeInstanceOf(Error)
    }
    expect(() =>
      validateBrowserArguments('wait_for', { sessionId: 's', text: 'x', ref: 'r' }),
    ).toThrow()
  })
})

it('preserves pause acknowledgement when unknown response arrives after the paused publication', async () => {
  const context = await readyFixture()
  try {
    const pending = context.service.call('click', { sessionId: sample.id, ref: 'r' })
    const outcome = Promise.allSettled([pending])
    const request = await context.native.next()
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: context.service.status().policyEpoch,
      sessions: [{ ...sample, state: 'paused' }],
    })
    writeBrowserFrame(context.native.socket, {
      type: 'response',
      id: request.id,
      error: { code: 'outcome_unknown', message: 'Interrupted after input' },
    })
    expect((await outcome)[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'outcome_unknown' },
    })
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: context.service.status().policyEpoch,
      sessions: [sample],
    })
    await tick()
    expect(context.service.status().sessions[0]?.state).toBe('active')
  } finally {
    await context.stop()
  }
})

it('times out once, emits cancellation, and never replays the operation', async () => {
  const context = await readyFixture()
  try {
    const pending = context.service.call('click', { sessionId: sample.id, ref: 'r' })
    const outcome = Promise.allSettled([pending])
    const request = await context.native.next()
    expect(await context.native.next()).toEqual({ type: 'cancel', id: request.id })
    expect((await outcome)[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'outcome_unknown' },
    })
    expect(context.service.status().sessions[0]?.state).toBe('paused')
  } finally {
    await context.stop()
  }
})

it('revoke disconnects only the owning extension connection and a second host cannot steal its session ID', async () => {
  const context = await readyFixture()
  try {
    const second = await context.host()
    expect(await second.next()).toEqual({ type: 'ready' })
    expect(await second.next()).toMatchObject({ type: 'policy' })
    writeBrowserFrame(second.socket, {
      type: 'sessions',
      policyEpoch: context.service.status().policyEpoch,
      sessions: [
        { ...sample, title: 'Collision' },
        { ...sample, id: 'other-session' },
      ],
    })
    await tick()
    expect(
      context.service.status().sessions.find((session) => session.id === sample.id)?.title,
    ).toBe('Fixture')
    context.service.revoke(sample.id)
    expect(context.native.socket.destroyed).toBe(true)
    expect(second.socket.destroyed).toBe(false)
    expect(context.service.status().sessions.map((session) => session.id)).toEqual([
      'other-session',
    ])
    writeBrowserFrame(second.socket, {
      type: 'sessions',
      policyEpoch: context.service.status().policyEpoch,
      sessions: [],
    })
    await tick()
    expect(context.service.status().sessions).toEqual([])
  } finally {
    await context.stop()
  }
})

it('treats malformed post-dispatch replies as unknown rather than a successful empty result', async () => {
  const context = await readyFixture()
  try {
    const pending = context.service.call('click', { sessionId: sample.id, ref: 'r' })
    const outcome = Promise.allSettled([pending])
    const request = await context.native.next()
    writeBrowserFrame(context.native.socket, { type: 'response', id: request.id })
    expect((await outcome)[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'outcome_unknown' },
    })
    expect(context.service.status().sessions[0]?.state).toBe('paused')
  } finally {
    await context.stop()
  }
})

it('publishes policy after ready and requires the current policy epoch before accepting any session', async () => {
  const context = await fixture()
  try {
    await context.service.start(extensionId, ['https://example.test/private?secret=1'])
    const native = await context.host()
    expect(await native.next()).toEqual({ type: 'ready' })
    const policy = await native.next()
    expect(policy).toMatchObject({ type: 'policy', blockedUrls: ['https://example.test/private'] })
    writeBrowserFrame(native.socket, { type: 'sessions', sessions: [sample] })
    await tick()
    expect(context.service.status().sessions).toEqual([])
    writeBrowserFrame(native.socket, {
      type: 'sessions',
      policyEpoch: policy.epoch,
      sessions: [
        sample,
        {
          ...sample,
          id: 'private',
          url: 'https://example.test/private?secret=2',
          title: 'Secret title',
        },
        { ...sample, id: 'restricted', url: 'chrome://settings' },
      ],
    })
    await tick()
    const result = await context.service.call('list_sessions', {})
    expect(JSON.stringify(result)).not.toContain('Secret')
    expect(context.service.status().sessions.map((session) => session.id)).toEqual([sample.id])
    const pending = context.service.call('read_text', { sessionId: sample.id })
    const request = await native.next()
    expect(request.policyEpoch).toBe(policy.epoch)
    writeBrowserFrame(native.socket, {
      type: 'response',
      id: request.id,
      result: { text: 'allowed' },
    })
    await expect(pending).resolves.toEqual({ text: 'allowed' })
    await expect(context.service.call('read_text', { sessionId: 'private' })).rejects.toMatchObject(
      { code: 'disconnected' },
    )
  } finally {
    await context.stop()
  }
})

it('changing blocked links cancels all old-policy work and removes denied metadata immediately', async () => {
  const context = await readyFixture()
  try {
    const oldEpoch = context.service.status().policyEpoch
    const first = context.service.call('snapshot', { sessionId: sample.id })
    const second = context.service.call('read_text', { sessionId: sample.id })
    const outcomes = Promise.allSettled([first, second])
    const request = await context.native.next()
    context.service.setBlockedUrls(['https://example.test/?query=ignored#fragment'])
    expect(await context.native.next()).toEqual({ type: 'cancel', id: request.id })
    const policy = await context.native.next()
    expect(policy).toMatchObject({ type: 'policy', blockedUrls: ['https://example.test/'] })
    expect(policy.epoch).not.toBe(oldEpoch)
    expect((await outcomes)[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'outcome_unknown' },
    })
    expect((await outcomes)[1]).toMatchObject({ status: 'rejected', reason: { code: 'cancelled' } })
    expect(context.service.status().sessions).toEqual([])
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: oldEpoch,
      sessions: [sample],
    })
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: policy.epoch,
      sessions: [sample],
    })
    await tick()
    expect(await context.service.call('list_sessions', {})).toMatchObject({ sessions: [] })
    expect(context.native.socket.destroyed).toBe(false)
    context.service.setBlockedUrls([])
    const allowedPolicy = await context.native.next()
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: policy.epoch,
      sessions: [sample],
    })
    await tick()
    expect(context.service.status().sessions).toEqual([])
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: allowedPolicy.epoch,
      sessions: [{ ...sample, id: 'new-session' }],
    })
    await tick()
    expect(context.service.status().sessions.map((session) => session.id)).toEqual(['new-session'])
  } finally {
    await context.stop()
  }
})

it('same-origin navigation into a denied exact link revokes reads, without blocking a trailing-slash sibling', async () => {
  const context = await readyFixture()
  try {
    context.service.setBlockedUrls(['https://example.test/private'])
    const policy = await context.native.next()
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: policy.epoch,
      sessions: [{ ...sample, url: 'https://example.test/private/?a=1' }],
    })
    await tick()
    expect(context.service.status().sessions).toHaveLength(1)
    const pending = context.service.call('read_text', { sessionId: sample.id })
    const result = Promise.allSettled([pending])
    await context.native.next()
    writeBrowserFrame(context.native.socket, {
      type: 'sessions',
      policyEpoch: policy.epoch,
      sessions: [
        { ...sample, url: 'https://example.test/private?a=2', title: 'Hidden private page' },
      ],
    })
    expect((await result)[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'outcome_unknown' },
    })
    expect(JSON.stringify(context.service.status())).not.toContain('Hidden private')
  } finally {
    await context.stop()
  }
})

it('disabled service rejects late authenticated transport callbacks', async () => {
  const context = await readyFixture()
  try {
    await context.service.disable()
    expect(context.native.socket.destroyed).toBe(true)
    const late = await context.host()
    await tick()
    expect(late.socket.destroyed).toBe(true)
    expect(context.service.status()).toMatchObject({
      enabled: false,
      connectedHosts: 0,
      sessions: [],
    })
    await expect(
      context.service.call('click', { sessionId: sample.id, ref: 'old-ref' }),
    ).rejects.toMatchObject({ code: 'browser_disabled' })
  } finally {
    await context.stop()
  }
})

it('current-page contexts stay private, are socket bound and consumed once', async () => {
  const context = await readyFixture()
  try {
    const saved: unknown[] = []
    context.service.setPageRuleHandler(async (rule, guard) => {
      guard()
      saved.push(rule)
      return { rulesRevision: 1 }
    })
    const policyEpoch = context.service.status().policyEpoch
    writeBrowserFrame(context.native.socket, {
      type: 'page_context',
      id: 'c1',
      tabId: 99,
      url: 'https://private.test/secret',
      title: 'Private title',
      policyEpoch,
    })
    const response = await context.native.next()
    const contextId = (response.result as { contextId: string }).contextId
    expect(JSON.stringify(await context.service.call('list_sessions', {}))).not.toContain(
      'Private title',
    )
    const second = await context.host()
    await second.next()
    await second.next()
    writeBrowserFrame(second.socket, {
      type: 'page_rule',
      id: 'wrong',
      contextId,
      permission: 'block',
      policyEpoch,
    })
    expect(await second.next()).toMatchObject({ error: { code: 'context_expired' } })
    writeBrowserFrame(context.native.socket, {
      type: 'page_rule',
      id: 'right',
      contextId,
      permission: 'block',
      policyEpoch,
    })
    expect(await context.native.next()).toMatchObject({
      result: { permission: 'block', rulesRevision: 1 },
    })
    expect(saved).toEqual([
      { url: 'https://private.test/secret', label: 'Private title', permission: 'block' },
    ])
    writeBrowserFrame(context.native.socket, {
      type: 'page_rule',
      id: 'replay',
      contextId,
      permission: 'allow',
      policyEpoch,
    })
    expect(await context.native.next()).toMatchObject({ error: { code: 'context_expired' } })
  } finally {
    await context.stop()
  }
})

it('disable supersedes an already queued enable before it can accept transport input', async () => {
  const context = await fixture()
  try {
    const start = context.service.start(extensionId)
    const close = context.service.disable()
    await Promise.all([start, close])
    expect(context.service.status().enabled).toBe(false)
    expect(context.service.status().connectedHosts).toBe(0)
  } finally {
    await context.stop()
  }
})

it('opens enrollment only for explicit enable, including an already-running listener', async () => {
  const context = await fixture()
  try {
    await context.service.start(extensionId)
    expect(context.enrollmentCalls).toBe(0)
    await context.service.start(extensionId, [], { enroll: true })
    expect(context.enrollmentCalls).toBe(1)
    const start = context.service.start(extensionId, [], { enroll: true })
    const close = context.service.disable()
    await Promise.all([start, close])
    expect(context.enrollmentCalls).toBe(1)
  } finally {
    await context.stop()
  }
})

it('corrupt private pin isolates Browser User without preventing Core diagnostics', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-bad-pin-'))
  fs.mkdirSync(path.join(directory, 'browser-user'), { mode: 0o700 })
  const file = path.join(directory, 'browser-user', 'pairing.json')
  fs.writeFileSync(file, '{invalid', { mode: 0o600 })
  const service = new BrowserService({ userDataDir: directory })
  try {
    expect(service.diagnose()).toMatchObject({
      enabled: false,
      paired: false,
      enrollmentExpiresAt: null,
    })
    await expect(service.start(extensionId, [], { enroll: true })).rejects.toMatchObject({
      code: 'pairing_storage_unsafe',
    })
    expect(service.diagnose()).toMatchObject({ enabled: false, enrollmentExpiresAt: null })
    await service.resetPairing()
    expect(fs.existsSync(file)).toBe(false)
    expect(service.diagnose().enabled).toBe(false)
  } finally {
    await service.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
