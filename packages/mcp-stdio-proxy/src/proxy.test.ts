// SPDX-License-Identifier: MPL-2.0
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as McpClientSdk from '@modelcontextprotocol/client'
import type { JSONRPCMessage } from '@modelcontextprotocol/client'
import { DEFAULT_REQUEST_TIMEOUT_MS, parseConfig, startProxy } from './index'
const state = vi.hoisted(() => ({ aborted: [] as (string | number)[], delay: 35000 }))
vi.mock('@modelcontextprotocol/client', async (importOriginal) => {
  const actual = await importOriginal<typeof McpClientSdk>()
  return {
    ...actual,
    StreamableHTTPClientTransport: class {
      onmessage?: (m: JSONRPCMessage) => void
      async start() {}
      async close() {}
      setProtocolVersion() {}
      send(message: JSONRPCMessage, options: { requestSignal: AbortSignal }) {
        if (!('id' in message) || message.id === undefined || message.id === null)
          return Promise.resolve()
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer)
            state.aborted.push(message.id as string | number)
            reject(new Error('fixture abort'))
          }
          const timer = setTimeout(() => {
            options.requestSignal.removeEventListener('abort', abort)
            this.onmessage?.({
              jsonrpc: '2.0',
              id: message.id as string | number,
              result: { content: [{ type: 'text', text: 'fixture completed' }] },
            })
            resolve()
          }, state.delay)
          options.requestSignal.addEventListener('abort', abort, { once: true })
        })
      }
    },
  }
})
afterEach(() => {
  vi.useRealTimers()
  state.aborted = []
})
async function open(requestTimeoutMs: number) {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough()
  let output = '',
    diagnostics = ''
  stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  stderr.on('data', (chunk) => {
    diagnostics += chunk.toString()
  })
  const close = await startProxy(
    { coreUrl: 'http://127.0.0.1:1', sessionToken: 'dummy-token-0123456789', requestTimeoutMs },
    { stdin, stdout, stderr },
  )
  return {
    stdin,
    close,
    messages: () =>
      output.trim()
        ? output
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [],
    diagnostics: () => diagnostics,
  }
}
describe('proxy request budget and cancellation', () => {
  it('keeps a healthy 35-second response beyond the former 30-second deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = await open(DEFAULT_REQUEST_TIMEOUT_MS)
    try {
      p.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'fixture' },
        }) + '\n',
      )
      await vi.advanceTimersByTimeAsync(30001)
      expect(p.messages()).toEqual([])
      expect(state.aborted).toEqual([])
      await vi.advanceTimersByTimeAsync(5000)
      expect(p.messages()[0]?.result.content[0].text).toBe('fixture completed')
      expect(p.diagnostics()).not.toContain('dummy-token')
    } finally {
      await p.close()
    }
  })
  it('reports an explicit request timeout rather than falsely claiming Core is unavailable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = await open(100)
    try {
      p.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'timeout',
          method: 'tools/call',
          params: { name: 'fixture' },
        }) + '\n',
      )
      await vi.advanceTimersByTimeAsync(101)
      expect(p.messages()[0]?.error).toMatchObject({ data: { reason: 'request_timeout' } })
      expect(p.messages()[0]?.error.message).toContain('timed out')
      expect(p.messages()[0]?.error.message).not.toContain('unavailable')
      expect(state.aborted).toContain('timeout')
    } finally {
      await p.close()
    }
  })
  it('cancels the matching request without interrupting another request or synthesizing a cancellation reply', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = await open(DEFAULT_REQUEST_TIMEOUT_MS)
    try {
      for (const id of ['a', 'b'])
        p.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name: 'fixture' },
          }) + '\n',
        )
      p.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 'a' },
        }) + '\n',
      )
      await vi.advanceTimersByTimeAsync(35001)
      expect(state.aborted).toEqual(['a'])
      expect(p.messages().map((m) => m.id)).toEqual(['b'])
    } finally {
      await p.close()
    }
  })
  it('uses a configurable bounded timeout without accepting invalid settings', () => {
    const base = ['--core-url', 'http://127.0.0.1:1']
    const env = { LUMIPLUG_SESSION_TOKEN: 'dummy-token-0123456789' }
    expect(parseConfig(base, env).requestTimeoutMs).toBe(310000)
    expect(parseConfig([...base, '--request-timeout-ms', '60000'], env).requestTimeoutMs).toBe(
      60000,
    )
    expect(
      parseConfig(base, { ...env, LUMIPLUG_REQUEST_TIMEOUT_MS: '90000' }).requestTimeoutMs,
    ).toBe(90000)
    for (const value of ['NaN', '', '99', '3600001', '2.5'])
      expect(() => parseConfig([...base, '--request-timeout-ms', value], env)).toThrow(
        'proxy_invalid_request_timeout',
      )
  })
})
