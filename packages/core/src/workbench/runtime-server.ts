// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { HOME_CONTENT_SECURITY_POLICY, HOME_CONTRACT } from '@lumiplug/shared'
import type { HomeBundle } from '@lumiplug/shared'
import { compatibleHome, decodeHomeFile } from './validation'
import type { WorkbenchRepository } from './repository'
import { HOME_TEMPLATE_FILES } from './template-files'
import { HOME_STORAGE_RUNTIME } from './storage-runtime'

const mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
}
export class HomeRuntimeServer {
  private readonly server: Server
  private readonly token = randomUUID()
  private port = 0
  private loadedVersion = 0
  private bundle: HomeBundle | null = null
  public constructor(private readonly repository: WorkbenchRepository) {
    this.server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const parts = url.pathname.split('/')
        const allowedHost = request.headers.host === `127.0.0.1:${this.port}`
        const version = Number(parts[3])
        let filename = ''
        try {
          filename = decodeURIComponent(parts.slice(4).join('/'))
        } catch {
          /* Invalid URI stays unavailable. */
        }
        if (
          !allowedHost ||
          !['GET', 'HEAD'].includes(request.method ?? '') ||
          parts[1] !== 'home' ||
          parts[2] !== this.token ||
          version !== this.loadedVersion ||
          !this.bundle ||
          !compatibleHome(this.bundle.manifest)
        ) {
          response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
          response.end('Not found')
          return
        }
        const file = this.bundle.files.find((item) => item.path === filename)
        const managed = ['lumi-sdk.js', 'lumi-storage.js', 'theme.css'].includes(filename)
        if (!file && !managed) {
          response.writeHead(404)
          response.end()
          return
        }
        let bytes: Buffer
        const session = url.searchParams.get('storageSession')
        const sessionId =
          session && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session)
            ? session
            : randomUUID()
        if (filename === 'lumi-storage.js') {
          const snapshot = this.repository.browserStorage.snapshot(
            this.bundle.manifest.projectId,
            sessionId,
          )
          bytes = Buffer.from(
            `(function(){${HOME_STORAGE_RUNTIME}\nLumiStorageCompat.installStorageBridge(window,${JSON.stringify(snapshot)});})();`,
          )
        } else bytes = managed ? Buffer.from(HOME_TEMPLATE_FILES[filename]!) : decodeHomeFile(file!)
        if (filename === 'index.html') {
          const html = bytes.toString('utf8')
          const storagePath = `${url.pathname.slice(0, -'index.html'.length)}lumi-storage.js?storageSession=${sessionId}`
          // The controlled SDK is idempotent, including when the source project
          // references it again or contains misleading commented-out references.
          const sdk = '<script src="./lumi-sdk.js"></script>'
          const tags = `<script src="${storagePath}"></script>${sdk}`
          // A blocking script before all user markup also covers inline scripts
          // preceding <head>. Keep an existing leading doctype in standards mode.
          const doctype = /^(?:\uFEFF)?(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html)
          const offset = doctype?.[0].length ?? 0
          bytes = Buffer.from(`${html.slice(0, offset)}${tags}${html.slice(offset)}`)
        }
        response.writeHead(200, {
          'content-type':
            mime[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream',
          'content-length': bytes.length,
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': HOME_CONTENT_SECURITY_POLICY,
        })
        response.end(request.method === 'HEAD' ? undefined : bytes)
      } catch {
        response.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        response.end('Home resource unavailable')
      }
    })
  }
  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('home_runtime_unavailable')
    this.port = address.port
  }
  public view() {
    const snapshot = this.repository.get()
    this.loadedVersion = snapshot.version
    this.bundle = snapshot.bundle
    const compatible = !snapshot.bundle || compatibleHome(snapshot.bundle.manifest)
    return {
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      manifest: snapshot.bundle?.manifest ?? null,
      compatible,
      runtimeUrl:
        compatible && snapshot.bundle && this.port
          ? `http://127.0.0.1:${this.port}/home/${this.token}/${snapshot.version}/index.html`
          : null,
      lumiVersion: HOME_CONTRACT.lumiVersion,
    }
  }
  public async close(): Promise<void> {
    if (!this.port) return
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    this.port = 0
    this.bundle = null
  }
}
