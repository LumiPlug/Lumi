// SPDX-License-Identifier: MPL-2.0

import { LumiError } from './protocol'
import type { Capability, HostInfo, Json, Reply, Theme, Tool } from './protocol'
import { createMock } from './mock'
import { SDK_CONTRACT } from './version'
export { LumiError }
export type { Capability, HostInfo, Json, Theme, Tool }

const listeners = new Set<(theme: Theme) => void>()
let theme: Theme = { mode: 'dark', reducedMotion: false, tokens: {} }
function applyTheme(next: Theme) {
  theme = next
  document.documentElement.dataset.theme = next.mode
  document.documentElement.style.colorScheme = next.mode
  for (const [key, value] of Object.entries(next.tokens)) {
    if (key.startsWith('--') && typeof value === 'string')
      document.documentElement.style.setProperty(key, value)
  }
  for (const listener of listeners) listener(next)
}

const localPreview =
  location.protocol === 'file:' ||
  (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname))
const mock = window.parent === window && localPreview ? createMock() : null
let port: MessagePort | null = null
let host: HostInfo | null = null
let sequence = 0
const pending = new Map<
  number,
  { resolve: (value: Json) => void; reject: (error: LumiError) => void; timer: number }
>()
let resolveReady: (value: HostInfo) => void
let rejectReady: (error: LumiError) => void
const ready = new Promise<HostInfo>((resolve, reject) => {
  resolveReady = resolve
  rejectReady = reject
})
// Initialization can precede App mount; the public promise still rejects to callers.
void ready.catch(() => {})
const instance = new URLSearchParams(location.hash.slice(1)).get('lumi')
const readyTimer = window.setTimeout(
  () =>
    rejectReady(
      new LumiError('host_unavailable', '没有连接到 Lumi 宿主。请在 Lumi 中加载构建包。'),
    ),
  10000,
)

if (mock) {
  host = mock.info
  applyTheme(mock.theme)
  clearTimeout(readyTimer)
  resolveReady!(host)
} else {
  const connect = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.data?.type !== 'lumi.home.connect' ||
      event.data.instance !== instance ||
      !event.ports[0] ||
      port
    )
      return
    // Application and SDK release numbers do not change the bridge contract.
    if (event.data.info?.bridgeVersion !== SDK_CONTRACT.bridgeVersion) {
      rejectReady(new LumiError('bridge_incompatible', '主页桥接协议不兼容。'))
      return
    }
    port = event.ports[0]
    host = event.data.info as HostInfo
    applyTheme(event.data.theme as Theme)
    port.onmessage = (message) => {
      if (message.data?.type === 'theme') {
        applyTheme(message.data.theme as Theme)
        return
      }
      const reply = message.data as Reply
      const request = pending.get(reply.id)
      if (!request) return
      pending.delete(reply.id)
      clearTimeout(request.timer)
      if (reply.ok) request.resolve(reply.data)
      else request.reject(new LumiError(reply.error.code, reply.error.message))
    }
    port.start()
    clearTimeout(readyTimer)
    resolveReady!(host)
    window.removeEventListener('message', connect)
  }
  window.addEventListener('message', connect)
  if (instance && window.parent !== window)
    window.parent.postMessage({ type: 'lumi.home.ready', bridgeVersion: 1, instance }, '*')
}

async function request<T>(method: string, args: Record<string, Json> = {}): Promise<T> {
  await ready
  if (mock) return (await mock.request(method, args)) as T
  if (!port) throw new LumiError('host_unavailable', '页面与 Lumi 的连接已关闭。')
  if (pending.size >= 64) throw new LumiError('too_many_requests', '请求过多，请稍后重试。')
  if (new TextEncoder().encode(JSON.stringify(args)).length > 64 * 1024)
    throw new LumiError('request_too_large', '请求超过 64 KiB。')
  const id = ++sequence
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new LumiError('request_timeout', 'Lumi 请求超时，请重试。'))
    }, 30000)
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
    port!.postMessage({ id, method, args })
  })
}

window.addEventListener('pagehide', () => {
  port?.close()
  port = null
  for (const item of pending.values()) {
    clearTimeout(item.timer)
    item.reject(new LumiError('page_closed', '页面连接已关闭。'))
  }
  pending.clear()
})

export const lumi = {
  ready: () => ready,
  context: { get: () => request<Record<string, Json>>('context.get') },
  capabilities: { list: () => request<Capability[]>('capabilities.list') },
  tools: {
    list: () => request<Tool[]>('tools.list'),
    call: (name: string, args: Record<string, Json> = {}) =>
      request<Record<string, Json>>('tools.call', { name, arguments: args }),
  },
  storage: {
    get: (key: string) => request<Json>('storage.get', { key }),
    set: (key: string, value: Json) => request<Json>('storage.set', { key, value }),
    delete: (key: string) => request<Json>('storage.delete', { key }),
  },
  theme: {
    get: () => theme,
    subscribe: (listener: (value: Theme) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  },
  toast: {
    show: (message: string, tone: 'success' | 'error' | 'info' = 'info') =>
      request<null>('toast.show', { message, tone }),
  },
}
