// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function setup() {
  const handlers = new Map<string, (event: MessageEvent) => void>()
  const parent = { postMessage: vi.fn() }
  const port = {
    onmessage: null as ((message: { data: unknown }) => void) | null,
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn<(message: { id: number; method: string }) => void>(),
  }
  vi.stubGlobal('window', {
    parent,
    setTimeout,
    addEventListener: (name: string, handler: (event: MessageEvent) => void) =>
      handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name),
  })
  vi.stubGlobal('location', { protocol: 'http:', hostname: '127.0.0.1', hash: '#lumi=test' })
  vi.stubGlobal('document', {
    documentElement: { dataset: {}, style: { setProperty: vi.fn() } },
  })
  const { lumi } = await import('./index')
  const connect = handlers.get('message')!
  return {
    lumi,
    parent,
    port,
    connect(info: Record<string, unknown>, source: unknown = parent, instance = 'test') {
      connect({
        source,
        ports: [port],
        data: {
          type: 'lumi.home.connect',
          instance,
          info,
          theme: { mode: 'dark', reducedMotion: false, tokens: {} },
        },
      } as unknown as MessageEvent)
    },
  }
}

describe('homepage SDK protocol compatibility', () => {
  it.each([
    { lumiVersion: '0.1.0', sdkVersion: '0.0.1' },
    { lumiVersion: '9.0.0', sdkVersion: '8.2.1' },
  ])('connects and calls the host regardless of release metadata: %j', async (release) => {
    const { lumi, connect, port } = await setup()
    const info = { ...release, bridgeVersion: 1, projectId: 'existing-project', mode: 'lumi' }
    connect(info)
    await expect(lumi.ready()).resolves.toEqual(info)
    expect(port.start).toHaveBeenCalledOnce()
    const context = lumi.context.get()
    await Promise.resolve()
    const request = port.postMessage.mock.calls[0]![0]
    expect(request.method).toBe('context.get')
    port.onmessage!({ data: { id: request.id, ok: true, data: { features: {} } } })
    await expect(context).resolves.toEqual({ features: {} })
  })

  it('still rejects a genuinely unsupported bridge protocol', async () => {
    const { lumi, connect, port } = await setup()
    connect({ lumiVersion: '0.1.1', sdkVersion: '0.1.1', bridgeVersion: 2 })
    await expect(lumi.ready()).rejects.toMatchObject({ code: 'bridge_incompatible' })
    expect(port.start).not.toHaveBeenCalled()
  })

  it('keeps source and instance checks when release equality is removed', async () => {
    const { lumi, connect, port } = await setup()
    const info = { lumiVersion: '0.1.0', sdkVersion: '0.1.0', bridgeVersion: 1 }
    connect(info, {})
    connect(info, undefined, 'different-instance')
    expect(port.start).not.toHaveBeenCalled()
    connect(info)
    await expect(lumi.ready()).resolves.toEqual(info)
  })
})
