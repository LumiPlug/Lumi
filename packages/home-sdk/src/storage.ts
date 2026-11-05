// SPDX-License-Identifier: MPL-2.0

import { HOME_STORAGE_LIMITS as limits } from '../../shared/src/workbench-storage'
import type { HomeStorageMutation, HomeStorageSnapshot } from '../../shared/src/workbench-storage'
import { LumiError } from './protocol'

export type StorageBridge = {
  connect: (
    write: (operation: HomeStorageMutation) => Promise<unknown>,
    onError: (error: unknown) => void,
  ) => void
  flush: () => Promise<void>
  disconnect: () => void
}
declare global {
  interface Window {
    __LUMI_STORAGE_BRIDGE__?: StorageBridge
  }
}

export function installStorageBridge(
  target: Window & typeof globalThis,
  snapshot: HomeStorageSnapshot,
): StorageBridge {
  if (target.__LUMI_STORAGE_BRIDGE__) return target.__LUMI_STORAGE_BRIDGE__
  const encoder = new TextEncoder()
  const bytes = (text: string) => encoder.encode(text).byteLength
  const string = (value: unknown) => {
    if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string')
    return String(value)
  }
  let write: ((operation: HomeStorageMutation) => Promise<unknown>) | null = null
  let report: (error: unknown) => void = () => {}
  let resolveConnected: () => void
  let rejectConnected: (error: unknown) => void
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve
    rejectConnected = reject
  })
  void connected.catch(() => {})
  let queue: HomeStorageMutation[] = []
  let pumping: Promise<void> | null = null
  let inFlight = false
  let scheduled = false
  let closed = false
  let reported = false

  async function flush(): Promise<void> {
    await connected
    if (closed || !write) throw new LumiError('page_closed', '页面存储连接已关闭。')
    if (pumping) return pumping
    const pending = (async () => {
      try {
        while (queue.length) {
          inFlight = true
          await write!(queue[0]!)
          inFlight = false
          queue.shift()
        }
        reported = false
      } catch (error) {
        if (!reported) {
          reported = true
          report(error)
        }
        throw error
      } finally {
        inFlight = false
      }
    })()
    pumping = pending
    void pending
      .finally(() => {
        if (pumping === pending) pumping = null
      })
      .catch(() => {})
    return pending
  }

  function enqueue(operation: HomeStorageMutation) {
    // Coalesce unsent writes so repeated edits cannot grow an unbounded queue.
    // Never replace the operation that is currently waiting for acknowledgement.
    queue = queue.filter(
      (item, index) =>
        (inFlight && index === 0) ||
        item.area !== operation.area ||
        (operation.operation !== 'clear' &&
          (item.operation === 'clear' || item.key !== operation.key)),
    )
    queue.push(operation)
    if (write && !scheduled) {
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        void flush().catch(() => {})
      })
    }
  }

  function storage(area: 'local' | 'session', entries: [string, string][]): Storage {
    const values = new Map(entries)
    let size = [...values].reduce((total, [key, value]) => total + bytes(key) + bytes(value), 0)
    const object = Object.create(target.Storage.prototype) as Storage
    const required = (count: number, expected: number) => {
      if (count < expected) throw new TypeError(`Storage requires ${expected} argument(s)`)
      if (closed) throw new LumiError('page_closed', '页面存储连接已关闭。')
    }
    const methods = {
      getItem(key: string) {
        required(arguments.length, 1)
        return values.get(string(key)) ?? null
      },
      setItem(key: string, value: string) {
        required(arguments.length, 2)
        const name = string(key)
        const text = string(value)
        const old = values.get(name)
        const nextSize =
          size - (old === undefined ? 0 : bytes(name) + bytes(old)) + bytes(name) + bytes(text)
        if (
          bytes(name) > limits.keyBytes ||
          bytes(text) > limits.valueBytes ||
          nextSize > limits.totalBytes ||
          (old === undefined && values.size >= limits.keys)
        )
          throw new target.DOMException('工作台存储空间不足。', 'QuotaExceededError')
        if (old === text) return
        values.set(name, text)
        size = nextSize
        enqueue({ area, operation: 'set', key: name, value: text })
      },
      removeItem(key: string) {
        required(arguments.length, 1)
        const name = string(key)
        const old = values.get(name)
        if (old === undefined) return
        size -= bytes(name) + bytes(old)
        values.delete(name)
        enqueue({ area, operation: 'delete', key: name })
      },
      clear() {
        required(arguments.length, 0)
        if (!values.size) return
        values.clear()
        size = 0
        enqueue({ area, operation: 'clear' })
      },
      key(index: number) {
        required(arguments.length, 1)
        if (typeof index === 'bigint' || typeof index === 'symbol')
          throw new TypeError('Invalid index')
        return [...values.keys()][Number(index) >>> 0] ?? null
      },
    }
    for (const [key, value] of Object.entries(methods))
      Object.defineProperty(object, key, { value, configurable: true })
    Object.defineProperty(object, 'length', { get: () => values.size, configurable: true })
    return new Proxy(object, {
      get: (obj, key, receiver) =>
        typeof key === 'string' && !(key in obj)
          ? values.get(key)
          : Reflect.get(obj, key, receiver),
      set: (_obj, key, value) => {
        if (typeof key !== 'string') return false
        methods.setItem(key, value)
        return true
      },
      deleteProperty: (_obj, key) => {
        if (typeof key === 'string') methods.removeItem(key)
        return true
      },
      has: (obj, key) => Reflect.has(obj, key) || (typeof key === 'string' && values.has(key)),
      ownKeys: (obj) => [...new Set([...Reflect.ownKeys(obj), ...values.keys()])],
      getOwnPropertyDescriptor: (obj, key) =>
        Reflect.getOwnPropertyDescriptor(obj, key) ??
        (typeof key === 'string' && values.has(key)
          ? { value: values.get(key), enumerable: true, configurable: true, writable: true }
          : undefined),
      defineProperty: (_obj, key, descriptor) => {
        if (
          typeof key !== 'string' ||
          !('value' in descriptor) ||
          descriptor.configurable === false
        )
          return false
        methods.setItem(key, descriptor.value)
        return true
      },
      preventExtensions: () => false,
    })
  }

  const local = storage('local', snapshot.local)
  const session = storage('session', snapshot.session)
  const controller: StorageBridge = {
    connect(transport, onError) {
      if (write || closed) return
      write = transport
      report = onError
      resolveConnected!()
      void flush().catch(() => {})
    },
    flush,
    disconnect() {
      closed = true
      rejectConnected!(new LumiError('page_closed', '页面存储连接已关闭。'))
    },
  }
  Object.defineProperties(target, {
    localStorage: { get: () => local, enumerable: true, configurable: true },
    sessionStorage: { get: () => session, enumerable: true, configurable: true },
    __LUMI_STORAGE_BRIDGE__: { value: controller, configurable: false },
  })
  return controller
}
