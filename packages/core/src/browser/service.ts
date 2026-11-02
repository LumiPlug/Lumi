// SPDX-License-Identifier: MPL-2.0

import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { BrowserWebSocketTransport } from './websocket-transport'
import { BROWSER_WEBSOCKET_ENDPOINT } from './transport-types'
import type { BrowserTransport, BrowserPairing } from './transport-types'
import {
  BrowserError,
  BrowserFrames,
  isRecord,
  validateBrowserArguments,
  writeBrowserFrame,
} from './protocol'
import type { BrowserMessage } from './protocol'
import type { BrowserPageRule } from '@lumiplug/shared'
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
  transport: 'loopback-websocket'
  endpoint: string
  paired: boolean
  pairing: BrowserPairing | null
}
interface PageContext {
  tabId: number
  url: string
  label: string
  policyEpoch: number
  serviceEpoch: number
  expiresAt: number
}
interface Host {
  socket: Duplex
  authenticated: boolean
  sessions: Set<string>
  contexts: Map<string, PageContext>
  rulePending: boolean
}
export type BrowserPageRuleHandler = (
  rule: BrowserPageRule,
  guard: () => void,
) => Promise<{ rulesRevision: number }>

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
  transportFactory?: () => BrowserTransport
}

/** One Lumi control domain. HTTP MCP request lifetimes are not agent identities. */
export class BrowserService {
  private enabled = false
  private extensionId: string | null
  private readonly transport: BrowserTransport
  private epoch = 0
  private activationEpoch = 0
  private policyEpoch = 1
  private blockedUrls: string[] = []
  private pageRuleHandler?: BrowserPageRuleHandler
  private hosts = new Set<Host>()
  private sessions = new Map<string, Session>()
  private pending?: Pending
  private queue: Promise<unknown> = Promise.resolve()
  private queued = 0
  private lifecycle: Promise<void> = Promise.resolve()
  constructor(private readonly options: BrowserServiceOptions) {
    this.extensionId = options.extensionId ?? null
    this.transport =
      options.transportFactory?.() ??
      new BrowserWebSocketTransport({ userDataDir: options.userDataDir })
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
      transport: 'loopback-websocket',
      endpoint: BROWSER_WEBSOCKET_ENDPOINT,
      ...this.transport.status(),
    }
  }
  async resetPairing(): Promise<void> {
    this.epoch++
    for (const host of [...this.hosts])
      this.disconnect(host, 'Browser pairing reset after dispatch')
    await this.transport.resetPairing()
  }

  async approvePairing(id: string, code: string): Promise<void> {
    if (!this.enabled) throw new BrowserError('browser_disabled', 'Browser User is closed')
    await this.transport.approvePairing(id, code)
  }

  diagnose(): BrowserStatus {
    return this.status()
  }

  /** Persistence is owned by the host-authorized controller, never an MCP tool. */
  setPageRuleHandler(handler: BrowserPageRuleHandler): void {
    this.pageRuleHandler = handler
  }

  /** Host-only policy mutation; MCP tools cannot call this method. */
  setBlockedUrls(values: unknown): void {
    const normalized = normalizeBrowserBlockedUrls(values)
    if (JSON.stringify(normalized) === JSON.stringify(this.blockedUrls)) return
    this.blockedUrls = normalized
    this.policyEpoch++
    this.epoch++
    for (const host of this.hosts) host.contexts.clear()
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
    const activation = this.activationEpoch
    if (!/^[a-p]{32}$/.test(extensionId))
      return Promise.reject(
        new BrowserError('invalid_extension_id', 'A concrete Chrome extension ID is required'),
      )
    const operation = this.lifecycle
      .catch(() => {})
      .then(async () => {
        if (activation !== this.activationEpoch) return
        this.setBlockedUrls(normalized)
        if (this.enabled && this.extensionId === extensionId) return
        await this.stopInternal()
        if (activation !== this.activationEpoch) return
        this.extensionId = extensionId
        try {
          const generation = this.epoch
          await this.transport.start((socket) => {
            if (generation !== this.epoch) socket.destroy()
            else this.accept(socket)
          })
          if (generation !== this.epoch || activation !== this.activationEpoch) {
            await this.transport.stop()
            return
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
    this.activationEpoch++
    // Cancel queued calls immediately, before waiting for a startup transition.
    this.epoch++
    this.enabled = false
    for (const host of [...this.hosts])
      this.disconnect(host, 'Browser control disabled after dispatch')
    const stopping = this.transport.stop()
    void stopping.catch(() => {})
    const operation = this.lifecycle
      .catch(() => {})
      .then(async () => {
        await stopping
        await this.stopInternal()
      })
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

  private accept(socket: Duplex): void {
    if (!this.enabled) {
      socket.destroy()
      return
    }
    const host: Host = {
      socket,
      authenticated: true,
      sessions: new Set(),
      contexts: new Map(),
      rulePending: false,
    }
    this.hosts.add(host)
    const frames = new BrowserFrames()
    socket.pipe(frames)
    socket.on('error', () => {})
    frames.on('error', () => socket.destroy())
    socket.on('close', () =>
      this.disconnect(host, 'Authenticated browser connection closed after dispatch'),
    )
    this.send(host, { type: 'ready' })
    this.sendPolicy(host)
    frames.on('data', (message: BrowserMessage) => {
      if (!this.enabled || !this.hosts.has(host)) {
        socket.destroy()
        return
      }
      if (message.type === 'page_context' || message.type === 'page_rule') {
        void this.handlePageRuleMessage(host, message)
      } else if (message.type === 'sessions') {
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

  private async handlePageRuleMessage(host: Host, message: BrowserMessage): Promise<void> {
    const id =
      typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 128
        ? message.id
        : null
    const type = message.type === 'page_context' ? 'page_context_result' : 'page_rule_result'
    if (id === null) {
      host.socket.destroy()
      return
    }
    try {
      if (!this.enabled || !host.authenticated || host.socket.destroyed || !this.hosts.has(host))
        throw new BrowserError('browser_disabled', 'Browser User is closed')
      if (message.policyEpoch !== this.policyEpoch)
        throw new BrowserError('policy_changed', 'Refresh the current page policy')
      if (message.type === 'page_context') {
        if (
          Object.keys(message).some(
            (key) => !['type', 'id', 'tabId', 'url', 'title', 'policyEpoch'].includes(key),
          ) ||
          !Number.isSafeInteger(message.tabId) ||
          (message.tabId as number) < 0 ||
          typeof message.url !== 'string' ||
          message.url.length > 2048 ||
          (message.title !== undefined &&
            (typeof message.title !== 'string' || message.title.length > 4096))
        )
          throw new BrowserError('invalid_arguments', 'Invalid current-page context')
        const url = normalizeBrowserUrl(message.url)
        if (url !== message.url)
          throw new BrowserError('invalid_arguments', 'Current-page URL must already be normalized')
        for (const [key, context] of host.contexts)
          if (context.expiresAt < Date.now()) host.contexts.delete(key)
        if (host.contexts.size >= 8)
          throw new BrowserError('busy', 'Too many current-page contexts')
        const contextId = randomUUID()
        host.contexts.set(contextId, {
          tabId: message.tabId as number,
          url,
          label:
            typeof message.title === 'string'
              ? message.title.replace(/\s+/g, ' ').trim().slice(0, 120)
              : '',
          policyEpoch: this.policyEpoch,
          serviceEpoch: this.epoch,
          expiresAt: Date.now() + 30000,
        })
        this.send(host, { type, id, result: { contextId, url, policyEpoch: this.policyEpoch } })
        return
      }
      if (
        Object.keys(message).some(
          (key) => !['type', 'id', 'contextId', 'permission', 'policyEpoch'].includes(key),
        ) ||
        typeof message.contextId !== 'string' ||
        typeof message.permission !== 'string' ||
        !['allow', 'block'].includes(message.permission)
      )
        throw new BrowserError('invalid_arguments', 'Invalid current-page rule')
      const context = host.contexts.get(message.contextId)
      host.contexts.delete(message.contextId)
      if (!context)
        throw new BrowserError('context_expired', 'Current-page context is absent or already used')
      const guard = () => {
        if (!this.enabled || !host.authenticated || host.socket.destroyed || !this.hosts.has(host))
          throw new BrowserError('browser_disabled', 'Browser User is closed')
        if (
          context.expiresAt < Date.now() ||
          context.policyEpoch !== this.policyEpoch ||
          context.serviceEpoch !== this.epoch
        )
          throw new BrowserError(
            'context_expired',
            'Current-page context expired or policy changed',
          )
      }
      guard()
      if (host.rulePending) throw new BrowserError('busy', 'Another page rule is being saved')
      if (!this.pageRuleHandler)
        throw new BrowserError('page_rules_unavailable', 'Page rule persistence is unavailable')
      host.rulePending = true
      try {
        const result = await this.pageRuleHandler(
          {
            url: context.url,
            label: context.label,
            permission: message.permission as 'allow' | 'block',
          },
          guard,
        )
        // Successful persistence may change policy epoch and broadcasts policy before this ACK.
        if (this.enabled && this.hosts.has(host) && !host.socket.destroyed)
          this.send(host, {
            type,
            id,
            result: {
              url: context.url,
              permission: message.permission,
              policyEpoch: this.policyEpoch,
              rulesRevision: result.rulesRevision,
            },
          })
      } finally {
        host.rulePending = false
      }
    } catch (error) {
      const code =
        error instanceof BrowserError
          ? error.code
          : error instanceof Error && /^browser_[a-z_]+$/.test(error.message)
            ? error.message
            : 'page_rule_failed'
      this.send(host, {
        type,
        id,
        error: {
          code,
          message: 'Page rule was not confirmed. Refresh the page state before trying again.',
        },
      })
    }
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
    host.contexts.clear()
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
    await this.transport.stop()
  }
}
