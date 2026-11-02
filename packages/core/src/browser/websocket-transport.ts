// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
import { BrowserError, isRecord } from './protocol'
import type { BrowserTransport } from './transport-types'
import {
  createNonce,
  createPairingHello,
  finishPairing,
  createServerProof,
  verifyClientProof,
  createSecureChannel,
  type SecureChannel,
  type PairingState,
  commitPairingHello,
  verifyPairingCommitment,
} from './secure-crypto'

const ORIGIN = `chrome-extension://${OFFICIAL_BROWSER_EXTENSION_ID}`
interface Peer {
  ws: WebSocket
  phase: 'hello' | 'committed' | 'pairing' | 'auth' | 'secure'
  pairingState?: PairingState
  commitment?: string
  clientNonce?: string
  serverNonce?: string
  channel?: SecureChannel
  stream?: Duplex
  queue: Promise<void>
  queued: number
  alive: number
  lastPing: number
  timer: NodeJS.Timeout
}
interface Candidate {
  peer: Peer
  id: string
  secret: string
  expiresAt: number
  generation: number
}

/** Fixed-loopback listener. Origin filtering is defense in depth, not local-user authentication. */
export class BrowserWebSocketTransport implements BrowserTransport {
  private server?: Server
  private wss?: WebSocketServer
  private readonly peers = new Set<Peer>()
  private candidate?: Candidate
  private secret?: string
  private storageError?: BrowserError
  private generation = 0
  private lastPairAt = 0
  private enrollmentDeadline = 0
  private enrollmentGeneration = 0
  private accept?: (stream: Duplex) => void
  private readonly directory: string
  private readonly file: string
  private readonly port: number

  constructor(options: { userDataDir: string; testPort?: number }) {
    this.port = options.testPort ?? 43127
    this.directory = path.join(options.userDataDir, 'browser-user')
    this.file = path.join(this.directory, 'pairing.json')
    try {
      this.checkPrivate(this.directory, true)
      this.checkPrivate(this.file, false)
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as {
        version?: number
        secret?: unknown
      }
      if (
        data.version !== 1 ||
        typeof data.secret !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(data.secret)
      )
        throw new Error('invalid pairing')
      this.secret = data.secret
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.storageError = new BrowserError(
          'pairing_storage_unsafe',
          'Browser pairing storage is invalid or unsafe',
        )
    }
  }

  private checkPrivate(file: string, directory: boolean): void {
    const stat = fs.lstatSync(file)
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (!directory && stat.size > 4096)
    )
      throw new Error('unsafe file')
    if (
      process.platform !== 'win32' &&
      (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    )
      throw new Error('unsafe permissions')
  }

  status(): { paired: boolean; enrollmentExpiresAt: string | null } {
    return {
      paired: Boolean(this.secret),
      enrollmentExpiresAt:
        this.enrollmentDeadline > Date.now() && !this.secret
          ? new Date(this.enrollmentDeadline).toISOString()
          : null,
    }
  }

  /** Explicit host enable only. TOFU cannot authenticate the first local peer's identity. */
  openEnrollment(): void {
    if (this.storageError) throw this.storageError
    if (this.secret) return
    if (!this.server?.listening)
      throw new BrowserError('browser_disabled', 'Browser listener is closed')
    // A fresh explicit action invalidates any older unauthenticated candidate.
    for (const peer of [...this.peers]) if (peer.phase !== 'secure') this.drop(peer)
    this.enrollmentGeneration++
    this.enrollmentDeadline = Date.now() + 120_000
    this.lastPairAt = 0
  }

  async start(accept: (stream: Duplex) => void): Promise<void> {
    if (this.storageError) throw this.storageError
    if (this.server) return
    this.accept = accept
    const generation = ++this.generation
    const server = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    })
    this.server = server
    this.wss = wss
    server.on('upgrade', (req, socket, head) => {
      if (
        generation !== this.generation ||
        req.url !== '/ws' ||
        req.headers.host !== `127.0.0.1:${this.port}` ||
        req.headers.origin !== ORIGIN ||
        req.headers['sec-websocket-protocol'] !== undefined ||
        this.peers.size >= 4 ||
        [...this.peers].some((p) => p.phase !== 'secure')
      ) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, generation))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      server.on('error', () => {
        void this.stop()
      })
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    ++this.generation
    this.candidate = undefined
    this.enrollmentDeadline = 0
    this.enrollmentGeneration++
    this.accept = undefined
    for (const peer of [...this.peers]) this.drop(peer)
    const server = this.server
    this.server = undefined
    this.wss?.close()
    this.wss = undefined
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  async resetPairing(): Promise<void> {
    // A host-confirmed local operation only: never automatic on authentication failure.
    this.enrollmentDeadline = 0
    this.enrollmentGeneration++
    this.candidate = undefined
    for (const peer of [...this.peers]) this.drop(peer)
    try {
      this.checkPrivate(this.directory, true)
      this.checkPrivate(this.file, false)
      fs.unlinkSync(this.file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new BrowserError('pairing_reset_failed', 'Unable to remove private browser pairing')
    }
    this.secret = undefined
    this.storageError = undefined
    this.lastPairAt = 0
  }

  private completePair(c: Candidate): void {
    if (
      this.candidate !== c ||
      this.secret !== undefined ||
      this.enrollmentDeadline <= Date.now() ||
      c.generation !== this.enrollmentGeneration ||
      c.expiresAt <= Date.now() ||
      !this.peers.has(c.peer) ||
      c.peer.ws.readyState !== WebSocket.OPEN
    )
      throw new Error('pair expired')
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.checkPrivate(this.directory, true)
    if (fs.existsSync(this.file)) this.checkPrivate(this.file, false)
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, secret: c.secret }), {
        flag: 'wx',
        mode: 0o600,
      })
      fs.renameSync(temporary, this.file)
    } finally {
      try {
        fs.unlinkSync(temporary)
      } catch {
        /* already renamed */
      }
    }
    this.secret = c.secret
    this.enrollmentDeadline = 0
    this.candidate = undefined
    c.peer.phase = 'hello'
    c.peer.alive = Date.now()
    this.send(c.peer, { type: 'enroll_complete', enrollmentId: c.id })
  }

  private connect(ws: WebSocket, generation: number): void {
    if (generation !== this.generation) {
      ws.terminate()
      return
    }
    const peer: Peer = {
      ws,
      phase: 'hello',
      queue: Promise.resolve(),
      queued: 0,
      alive: Date.now(),
      lastPing: Date.now(),
      timer: setInterval(() => {
        if (peer.phase !== 'secure') {
          if (Date.now() - peer.alive > 5000) this.drop(peer)
        } else if (Date.now() - peer.alive > 30_000) this.drop(peer)
        else if (Date.now() - peer.lastPing >= 20_000) {
          peer.lastPing = Date.now()
          this.sendSecure(peer, { type: 'ping' })
        }
      }, 1000),
    }
    this.peers.add(peer)
    ws.on('close', () => this.drop(peer))
    ws.on('error', () => this.drop(peer))
    ws.on('message', (data, binary) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      if (
        binary ||
        bytes.length > (peer.phase === 'secure' ? 1024 * 1024 : 4096) ||
        peer.queued >= 16
      ) {
        this.drop(peer)
        return
      }
      peer.queued++
      peer.queue = peer.queue
        .then(async () => {
          if (!this.peers.has(peer) || generation !== this.generation) return
          await this.message(peer, JSON.parse(bytes.toString()))
        })
        .catch(() => this.drop(peer))
        .finally(() => {
          peer.queued--
        })
    })
  }

  private send(peer: Peer, value: unknown): void {
    if (peer.ws.readyState !== WebSocket.OPEN || peer.ws.bufferedAmount > 2 * 1024 * 1024) {
      this.drop(peer)
      return
    }
    peer.ws.send(JSON.stringify(value))
  }
  private sendSecure(peer: Peer, value: unknown): void {
    // Output serialization is provided by the Duplex writable stream, except heartbeat.
    peer.stream?.write(`${JSON.stringify(value)}\n`)
  }
  private drop(peer: Peer): void {
    if (!this.peers.delete(peer)) return
    if (this.candidate?.peer === peer) this.candidate = undefined
    clearInterval(peer.timer)
    peer.channel?.close()
    peer.stream?.destroy()
    peer.ws.terminate()
  }

  private async message(peer: Peer, message: unknown): Promise<void> {
    if (!isRecord(message)) throw new Error('invalid message')
    if (peer.phase === 'secure') {
      if (message.type !== 'secure' || !peer.channel) throw new Error('encryption required')
      const value = await peer.channel.open({ seq: message.seq, data: message.data })
      if (!this.peers.has(peer)) return
      if (!isRecord(value)) throw new Error('object required')
      peer.alive = Date.now()
      if (value.type === 'pong') return
      if (!peer.stream?.push(`${JSON.stringify(value)}\n`)) throw new Error('input backpressure')
      return
    }
    if (
      peer.phase === 'hello' &&
      ((message.type === 'enroll_commit' && this.secret) ||
        (message.type === 'auth_hello' && !this.secret))
    ) {
      peer.ws.send(JSON.stringify({ type: 'auth_error', code: 'pairing_required' }), () =>
        this.drop(peer),
      )
      return
    }
    if (peer.phase === 'hello' && message.type === 'enroll_commit') {
      if (
        this.secret ||
        this.enrollmentDeadline <= Date.now() ||
        this.candidate ||
        Date.now() - this.lastPairAt < 5000 ||
        typeof message.commitment !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(message.commitment)
      )
        throw new Error('pairing unavailable')
      this.lastPairAt = Date.now()
      const local = await createPairingHello('server')
      const commitment = await commitPairingHello(local.hello, 'server')
      if (!this.peers.has(peer)) return
      peer.commitment = message.commitment
      peer.pairingState = local.state
      peer.phase = 'committed'
      this.send(peer, { type: 'enroll_commit', commitment })
      return
    }
    if (
      peer.phase === 'committed' &&
      message.type === 'enroll_hello' &&
      peer.pairingState &&
      peer.commitment
    ) {
      if (!(await verifyPairingCommitment(message.hello, 'client', peer.commitment)))
        throw new Error('commitment mismatch')
      const local = peer.pairingState
      const derived = await finishPairing(local, message.hello)
      if (!this.peers.has(peer)) return
      const c: Candidate = {
        peer,
        id: derived.pairingId,
        secret: derived.sharedSecret,
        expiresAt: Math.min(Date.now() + 5000, this.enrollmentDeadline),
        generation: this.enrollmentGeneration,
      }
      this.candidate = c
      peer.phase = 'pairing'
      this.send(peer, {
        type: 'enroll_offer',
        hello: local.hello,
        enrollmentId: c.id,
        expiresAt: c.expiresAt,
      })
      return
    }
    if (peer.phase === 'pairing' && message.type === 'enroll_accept') {
      const c = this.candidate
      if (!c || c.peer !== peer || c.id !== message.enrollmentId || c.expiresAt <= Date.now())
        throw new Error('pair expired')
      this.completePair(c)
      return
    }
    if (
      peer.phase === 'hello' &&
      message.type === 'auth_hello' &&
      this.secret &&
      typeof message.clientNonce === 'string'
    ) {
      peer.clientNonce = message.clientNonce
      peer.serverNonce = createNonce()
      const proof = await createServerProof(this.secret, peer.clientNonce, peer.serverNonce)
      if (!this.peers.has(peer)) return
      peer.phase = 'auth'
      this.send(peer, { type: 'auth_challenge', serverNonce: peer.serverNonce, proof })
      return
    }
    if (
      peer.phase === 'auth' &&
      message.type === 'auth_proof' &&
      this.secret &&
      peer.clientNonce &&
      peer.serverNonce
    ) {
      if (
        !(await verifyClientProof(this.secret, peer.clientNonce, peer.serverNonce, message.proof))
      )
        throw new Error('authentication failed')
      const channel = await createSecureChannel(
        this.secret,
        peer.clientNonce,
        peer.serverNonce,
        'server',
      )
      if (!this.peers.has(peer)) {
        channel.close()
        return
      }
      peer.channel = channel
      peer.phase = 'secure'
      peer.alive = Date.now()
      const stream = new Duplex({
        read() {},
        write: (chunk: Buffer, _encoding, callback) => {
          if (chunk.length > 512 * 1024 + 1 || !chunk.toString().endsWith('\n')) {
            callback(new Error('invalid frame'))
            return
          }
          try {
            const value: unknown = JSON.parse(chunk.toString())
            void channel.seal(value).then(
              (envelope) => {
                this.send(peer, { type: 'secure', ...envelope })
                callback()
              },
              (error) => callback(error as Error),
            )
          } catch (error) {
            callback(error as Error)
          }
        },
        destroy: (error, callback) => {
          this.drop(peer)
          callback(error)
        },
      })
      stream.on('error', () => this.drop(peer))
      peer.stream = stream
      this.accept?.(stream)
      return
    }
    throw new Error('unexpected handshake')
  }
}
