// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import type { Server, Socket } from 'node:net'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  BrowserError,
  BrowserFrames,
  isRecord,
  validateBrowserArguments,
  writeBrowserFrame,
} from './protocol'
import type { BrowserMessage } from './protocol'
import { normalizeBrowserBlockedUrls, normalizeBrowserUrl } from '@lumiplug/shared'

export { BrowserError } from './protocol'
export interface BrowserSession {
  id: string
  tabId: number
  title: string
  url: string
  origin: string
  state: string
}
export interface BrowserStatus {
  enabled: boolean
  extensionId: string | null
  connectedHosts: number
  sessions: BrowserSession[]
  controlDomain: 'shared-lumi'
  blockedUrls: string[]
  policyEpoch: number
}
interface Host {
  socket: Socket
  authenticated: boolean
  sessions: Set<string>
}
interface Session {
  item: BrowserSession
  host: Host
  version: number
  blocked: boolean
  observedPause: boolean
}
interface Pending {
  id: string
  session: Session
  finish: (error?: BrowserError, result?: unknown) => void
}
export interface BrowserServiceOptions {
  userDataDir: string
  extensionId?: string
  requestTimeoutMs?: number
  serverFactory?: typeof net.createServer
}

/** One Lumi control domain. HTTP MCP request lifetimes are not agent identities. */
export class BrowserService {
  private enabled = false
  private extensionId: string | null
  private server?: Server
  private token: string | null = null
  private epoch = 0
  private policyEpoch = 1
  private blockedUrls: string[] = []
  private hosts = new Set<Host>()
  private sessions = new Map<string, Session>()
  private pending?: Pending
  private queue: Promise<unknown> = Promise.resolve()
  private queued = 0
  private lifecycle: Promise<void> = Promise.resolve()
  readonly runtimeFile: string
  private readonly directory: string
  private readonly address: string

  constructor(private readonly options: BrowserServiceOptions) {
    this.extensionId = options.extensionId ?? null
    this.directory = path.join(path.resolve(options.userDataDir), 'browser-user')
    this.runtimeFile = path.join(this.directory, 'runtime.json')
    const identity = createHash('sha256').update(this.directory).digest('hex').slice(0, 24)
    this.address =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\lumi-browser-user-${identity}`
        : path.join(this.directory, 'core.sock')
  }

  status(): BrowserStatus {
    return {
      enabled: this.enabled,
      extensionId: this.extensionId,
      connectedHosts: [...this.hosts].filter((host) => host.authenticated).length,
      sessions: [...this.sessions.values()]
        .filter((session) => this.allowed(session.item.url))
        .map((session) => ({ ...session.item })),
      controlDomain: 'shared-lumi',
      blockedUrls: [...this.blockedUrls],
      policyEpoch: this.policyEpoch,
    }
  }
  diagnose(): BrowserStatus {
    return this.status()
  }

  /** Host-only policy mutation; MCP tools cannot call this method. */
  setBlockedUrls(values: unknown): void {
    const normalized = normalizeBrowserBlockedUrls(values)
    if (JSON.stringify(normalized) === JSON.stringify(this.blockedUrls)) return
    this.blockedUrls = normalized
    this.policyEpoch++
    this.epoch++
    const pending = this.pending
    if (pending) {
      this.block(pending.session)
      this.send(pending.session.host, { type: 'cancel', id: pending.id })
      pending.finish(
        new BrowserError(
          'outcome_unknown',
          'Browser policy changed after dispatch; do not automatically retry',
        ),
      )
    }
    for (const [id, session] of this.sessions) {
      session.version++
      if (!this.allowed(session.item.url)) {
        this.sessions.delete(id)
        session.host.sessions.delete(id)
      }
    }
    for (const host of this.hosts) if (host.authenticated) this.sendPolicy(host)
  }

  private allowed(url: string): boolean {
    try {
      return !this.blockedUrls.includes(normalizeBrowserUrl(url))
    } catch {
      return false
    }
  }

  private sendPolicy(host: Host): void {
    this.send(host, { type: 'policy', epoch: this.policyEpoch, blockedUrls: [...this.blockedUrls] })
  }

  /** Called only by the host-confirmed settings lifecycle; never an MCP tool. */
  start(
    extensionId = this.extensionId ?? '',
    blockedUrls: string[] = this.blockedUrls,
  ): Promise<void> {
    const normalized = normalizeBrowserBlockedUrls(blockedUrls)
    if (!/^[a-p]{32}$/.test(extensionId))
      return Promise.reject(
        new BrowserError('invalid_extension_id', 'A concrete Chrome extension ID is required'),
      )
    const operation = this.lifecycle
      .catch(() => {})
      .then(async () => {
        this.setBlockedUrls(normalized)
        if (this.enabled && this.extensionId === extensionId) return
        await this.stopInternal()
        this.extensionId = extensionId
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
        const directory = fs.lstatSync(this.directory)
        if (
          !directory.isDirectory() ||
          directory.isSymbolicLink() ||
          (process.platform !== 'win32' &&
            (directory.uid !== process.getuid?.() || directory.mode & 0o077))
        )
          throw new BrowserError(
            'unsafe_ipc_directory',
            'Browser User requires an owner-private directory',
          )
        if (process.platform !== 'win32') await this.removeStaleSocket()
        const token = randomBytes(32).toString('hex')
        this.token = token
        const server = (this.options.serverFactory ?? net.createServer)((socket) =>
          this.accept(socket),
        )
        this.server = server
        server.on('error', () => {})
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(this.address, () => {
              server.removeListener('error', reject)
              resolve()
            })
          })
          if (process.platform !== 'win32') fs.chmodSync(this.address, 0o600)
          const temporary = path.join(this.directory, `runtime-${randomUUID()}.tmp`)
          try {
            fs.writeFileSync(
              temporary,
              JSON.stringify({ version: 1, address: this.address, token }),
              { flag: 'wx', mode: 0o600 },
            )
            if (fs.existsSync(this.runtimeFile) && fs.lstatSync(this.runtimeFile).isSymbolicLink())
              throw new BrowserError('unsafe_runtime', 'Refusing symlink runtime descriptor')
            fs.renameSync(temporary, this.runtimeFile)
          } finally {
            fs.rmSync(temporary, { force: true })
          }
          this.enabled = true
        } catch (error) {
          await this.stopInternal()
          throw error
        }
      })
    this.lifecycle = operation
    return operation
  }

  disable(): Promise<void> {
    // Cancel queued calls immediately, before waiting for a startup transition.
    this.epoch++
    this.enabled = false
    const operation = this.lifecycle.catch(() => {}).then(() => this.stopInternal())
    this.lifecycle = operation
    return operation
  }
  close(): Promise<void> {
    return this.disable()
  }

  /** Disconnecting a host makes the extension revoke every session it owns. */
  revoke(sessionId?: string): void {
    const hosts = sessionId
      ? [this.sessions.get(sessionId)?.host].filter((host): host is Host => !!host)
      : [...this.hosts]
    for (const host of hosts) this.disconnect(host, 'Browser authorization revoked by Lumi')
  }

  async call(
    tool: string,
    value: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    validateBrowserArguments(tool, value)
    if (!this.enabled)
      throw new BrowserError('browser_disabled', 'Enable Browser User in Lumi settings first')
    if (this.queued >= 128)
      throw new BrowserError('busy', 'Browser control queue is full; request not dispatched')
    const args = { ...value },
      epoch = this.epoch,
      session = typeof args.sessionId === 'string' ? this.sessions.get(args.sessionId) : undefined
    const version = session?.version
    this.queued++
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        if (options.signal?.aborted)
          throw new BrowserError('cancelled', 'Browser request cancelled before dispatch')
        if (!this.enabled || epoch !== this.epoch)
          throw new BrowserError('cancelled', 'Browser service changed before dispatch')
        if (tool === 'list_sessions')
          return { sessions: this.status().sessions, controlDomain: 'shared-lumi' }
        if (
          !session ||
          this.sessions.get(session.item.id) !== session ||
          session.host.socket.destroyed
        )
          throw new BrowserError(
            'disconnected',
            'Shared browser session unavailable; request not dispatched',
          )
        if (!this.allowed(session.item.url))
          throw new BrowserError(
            'url_blocked',
            'This link is excluded by the Browser User policy; request not dispatched',
          )
        if (session.version !== version || session.blocked || session.item.state !== 'active')
          throw new BrowserError(
            'session_inactive',
            'Browser session changed or is paused; request not dispatched',
          )
        return this.dispatch(session, tool, args, options.signal)
      })
    this.queue = operation.catch(() => {})
    try {
      return await operation
    } finally {
      this.queued--
    }
  }

  private dispatch(
    session: Session,
    tool: string,
    args: BrowserMessage,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      let sent = false,
        finished = false
      const finish = (error?: BrowserError, result?: unknown) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        if (this.pending?.id === id) this.pending = undefined
        if (error) reject(error)
        else resolve(result)
      }
      const unknown = (message: string) => {
        this.block(session)
        this.send(session.host, { type: 'cancel', id })
        finish(
          new BrowserError(
            'outcome_unknown',
            `${message} Operation may have occurred; do not automatically retry.`,
          ),
        )
      }
      const cancel = () => {
        if (sent) unknown('Browser request cancelled after dispatch.')
        else finish(new BrowserError('cancelled', 'Browser request cancelled before dispatch'))
      }
      const timer = setTimeout(
        () => unknown('Browser response timed out.'),
        Math.max(this.options.requestTimeoutMs ?? 35000, Number(args.timeoutMs ?? 0) + 1000),
      )
      this.pending = { id, session, finish }
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) {
        cancel()
        return
      }
      try {
        writeBrowserFrame(session.host.socket, {
          type: 'request',
          id,
          tool,
          args,
          policyEpoch: this.policyEpoch,
        })
        sent = true
      } catch {
        finish(new BrowserError('disconnected', 'Browser connection failed before dispatch'))
        session.host.socket.destroy()
      }
    })
  }

  private block(session: Session): void {
    if (!session.blocked) session.observedPause = session.item.state !== 'active'
    session.blocked = true
    session.version++
    session.item.state = 'paused'
  }

  private accept(socket: Socket): void {
    const host: Host = { socket, authenticated: false, sessions: new Set() }
    this.hosts.add(host)
    const frames = new BrowserFrames(),
      timer = setTimeout(() => socket.destroy(), 3000)
    socket.pipe(frames)
    socket.on('error', () => {})
    frames.on('error', () => socket.destroy())
    socket.on('close', () => {
      clearTimeout(timer)
      this.disconnect(host, 'Native host disconnected after dispatch')
    })
    frames.on('data', (message: BrowserMessage) => {
      if (!host.authenticated) {
        if (
          !this.enabled ||
          !this.token ||
          message.role !== 'native' ||
          message.origin !== `chrome-extension://${this.extensionId}/` ||
          typeof message.token !== 'string' ||
          Buffer.byteLength(message.token) !== Buffer.byteLength(this.token) ||
          !timingSafeEqual(Buffer.from(message.token), Buffer.from(this.token))
        ) {
          socket.destroy()
          return
        }
        host.authenticated = true
        clearTimeout(timer)
        this.send(host, { type: 'ready' })
        this.sendPolicy(host)
        return
      }
      if (message.type === 'sessions') {
        if (message.policyEpoch === this.policyEpoch) this.updateSessions(host, message.sessions)
      } else if (message.type === 'response' && typeof message.id === 'string') {
        const pending = this.pending
        if (!pending || pending.id !== message.id || pending.session.host !== host) return
        if (isRecord(message.error)) {
          const code = typeof message.error.code === 'string' ? message.error.code : 'browser_error'
          if (code === 'outcome_unknown') this.block(pending.session)
          pending.finish(
            new BrowserError(
              code,
              typeof message.error.message === 'string'
                ? message.error.message
                : 'Browser operation failed',
              message.error.details,
            ),
          )
        } else if (isRecord(message.result)) {
          pending.finish(undefined, message.result)
        } else {
          this.block(pending.session)
          pending.finish(
            new BrowserError(
              'outcome_unknown',
              'Malformed response after browser dispatch; do not automatically retry',
            ),
          )
        }
      } else socket.destroy()
    })
  }

  private updateSessions(host: Host, value: unknown): void {
    if (!Array.isArray(value) || value.length > 200) {
      host.socket.destroy()
      return
    }
    const next = new Set<string>()
    for (const item of value) {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        !item.id ||
        item.id.length > 256 ||
        typeof item.tabId !== 'number' ||
        !Number.isSafeInteger(item.tabId)
      )
        continue
      const previous = this.sessions.get(item.id)
      if (previous && previous.host !== host) continue
      const text = (key: string, maximum: number) =>
        typeof item[key] === 'string' ? (item[key] as string).slice(0, maximum) : ''
      const safe: BrowserSession = {
        id: item.id,
        tabId: item.tabId,
        title: text('title', 4096),
        url: text('url', 8192),
        origin: text('origin', 4096),
        state: text('state', 128),
      }
      if (!this.allowed(safe.url)) continue
      if (previous) {
        if (safe.state !== previous.item.state || safe.url !== previous.item.url) previous.version++
        if (previous.blocked && safe.state !== 'active') previous.observedPause = true
        if (previous.blocked && previous.observedPause && safe.state === 'active')
          previous.blocked = false
        previous.item = { ...safe, state: previous.blocked ? 'paused' : safe.state }
      } else
        this.sessions.set(item.id, {
          item: safe,
          host,
          version: 0,
          blocked: false,
          observedPause: false,
        })
      next.add(item.id)
    }
    for (const id of host.sessions)
      if (!next.has(id)) {
        const session = this.sessions.get(id)
        const pending = this.pending
        if (pending && pending.session === session)
          pending.finish(
            new BrowserError(
              'outcome_unknown',
              'Session revoked after dispatch; do not automatically retry',
            ),
          )
        this.sessions.delete(id)
      }
    host.sessions = next
  }

  private send(host: Host, message: BrowserMessage): void {
    try {
      writeBrowserFrame(host.socket, message)
    } catch {
      host.socket.destroy()
    }
  }
  private disconnect(host: Host, message: string): void {
    if (!this.hosts.delete(host)) return
    if (this.pending?.session.host === host)
      this.pending.finish(
        new BrowserError(
          'outcome_unknown',
          `${message}; operation may have occurred. Do not automatically retry.`,
        ),
      )
    for (const id of host.sessions) this.sessions.delete(id)
    host.socket.destroy()
  }
  private async stopInternal(): Promise<void> {
    this.enabled = false
    this.epoch++
    if (this.pending) this.send(this.pending.session.host, { type: 'cancel', id: this.pending.id })
    for (const host of [...this.hosts])
      this.disconnect(host, 'Browser User disabled after dispatch')
    this.sessions.clear()
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (this.token) {
      try {
        const item: unknown = JSON.parse(fs.readFileSync(this.runtimeFile, 'utf8'))
        if (isRecord(item) && item.token === this.token) fs.rmSync(this.runtimeFile)
      } catch {
        /* Missing or replaced descriptors are never removed blindly. */
      }
    }
    this.token = null
  }
  private async removeStaleSocket(): Promise<void> {
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(this.address)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!stat.isSocket() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
      throw new BrowserError('unsafe_ipc_socket', 'Refusing an unexpected browser IPC path')
    const active = await new Promise<boolean>((resolve, reject) => {
      const client = net.createConnection(this.address)
      const timer = setTimeout(() => {
        client.destroy()
        reject(new BrowserError('ipc_busy', 'Existing browser IPC could not be verified'))
      }, 1000)
      client.once('connect', () => {
        clearTimeout(timer)
        client.destroy()
        resolve(true)
      })
      client.once('error', (error) => {
        clearTimeout(timer)
        client.destroy()
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false)
        else reject(error)
      })
    })
    if (active)
      throw new BrowserError(
        'already_running',
        'Another Browser User Core service is already listening',
      )
    fs.unlinkSync(this.address)
  }
}
