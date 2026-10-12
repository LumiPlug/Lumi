// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { HOME_CONTRACT } from '@lumiplug/shared'
import type { HomeBundle } from '@lumiplug/shared'
import { compatibleHome, decodeHomeFile } from './validation'
import type { WorkbenchRepository } from './repository'
import { HOME_TEMPLATE_FILES } from './template-files'

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
      const managed = ['lumi-sdk.js', 'theme.css'].includes(filename)
      if (!file && !managed) {
        response.writeHead(404)
        response.end()
        return
      }
      let bytes = managed ? Buffer.from(HOME_TEMPLATE_FILES[filename]!) : decodeHomeFile(file!)
      if (
        filename === 'index.html' &&
        !/<script\b[^>]*\bsrc\s*=\s*["'][^"']*lumi-sdk\.js["']/i.test(bytes.toString('utf8'))
      ) {
        const html = bytes.toString('utf8')
        const tag = '<script src="./lumi-sdk.js"></script>'
        bytes = Buffer.from(
          /<head(?:\s[^>]*)?>/i.test(html)
            ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${tag}`)
            : /<!doctype[^>]*>/i.test(html)
              ? html.replace(/<!doctype[^>]*>/i, `$&${tag}`)
              : `${tag}${html}`,
        )
      }
      const origin = `http://127.0.0.1:${this.port}`
      response.writeHead(200, {
        'content-type':
          mime[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream',
        'content-length': bytes.length,
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'camera=(), microphone=(), geolocation=()',
        'content-security-policy': `default-src 'none'; script-src ${origin}; style-src ${origin} 'unsafe-inline'; img-src ${origin} data: blob:; font-src ${origin} data:; media-src ${origin} data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; sandbox allow-scripts`,
      })
      response.end(request.method === 'HEAD' ? undefined : bytes)
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
