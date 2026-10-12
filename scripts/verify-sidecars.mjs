// SPDX-License-Identifier: MPL-2.0

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout, clearTimeout } from 'node:timers'
import { fileURLToPath, URL } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { SESSION_TOKEN_HEADER } from '../packages/shared/dist/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directoryIndex = process.argv.indexOf('--directory')
const extension = process.platform === 'win32' ? '.exe' : ''
let directory
let suffix
if (directoryIndex >= 0) {
  assert.ok(process.argv[directoryIndex + 1], '--directory requires an absolute or relative path')
  directory = path.resolve(process.argv[directoryIndex + 1])
  suffix = extension
} else {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'dist/sidecars/manifest.json'), 'utf8'),
  )
  directory = path.join(root, 'src-tauri/binaries')
  suffix = `-${manifest.target}${extension}`
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lumi-sidecar-smoke-'))
const token = randomUUID()
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && !['PATH', 'NODE_PATH', 'NODE_OPTIONS'].includes(key.toUpperCase()),
  ),
)
environment.PATH = ''
environment.NODE_PATH = ''
environment.NODE_OPTIONS = ''
const core = spawn(
  path.join(directory, `lumi-core${suffix}`),
  [
    '--port',
    '0',
    '--parent-pid',
    String(process.pid),
    '--session-token',
    token,
    '--user-data-dir',
    temporary,
  ],
  { cwd: temporary, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
)
let diagnostic = ''
core.stderr.on('data', (chunk) => {
  diagnostic = (diagnostic + chunk.toString()).slice(-8000)
})
const lines = createInterface({ input: core.stdout })
const ready = new Promise((resolve, reject) => {
  core.once('error', reject)
  core.once('exit', (code, signal) =>
    reject(
      new Error(
        `Core exited before readiness (code=${code}, signal=${signal}): ${diagnostic.replaceAll(token, '[redacted]')}`,
      ),
    ),
  )
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line)
      if (message.kind === 'sidecar.ready') resolve(message)
    } catch {
      // Other diagnostic lines must not be mistaken for a handshake.
    }
  })
})
const httpClient = new Client({ name: 'lumi-package-http-smoke', version: '1.0.0' })
const stdioClient = new Client({ name: 'lumi-package-stdio-smoke', version: '1.0.0' })
let timeout
try {
  await Promise.race([
    (async () => {
      const handshake = await ready
      assert.equal(handshake.mcpAvailable, true)
      const url = `http://127.0.0.1:${handshake.port}`
      const health = await globalThis.fetch(`${url}/healthz`)
      assert.equal(health.status, 200)
      await httpClient.connect(
        new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
          requestInit: { headers: { [SESSION_TOKEN_HEADER]: token } },
        }),
      )
      await stdioClient.connect(
        new StdioClientTransport({
          command: path.join(directory, `mcp-stdio-proxy${suffix}`),
          args: ['--core-url', url],
          env: { ...environment, LUMIPLUG_SESSION_TOKEN: token },
          cwd: temporary,
          stderr: 'pipe',
        }),
      )
      const httpTools = (await httpClient.listTools()).tools.map((tool) => tool.name).sort()
      const stdioTools = (await stdioClient.listTools()).tools.map((tool) => tool.name).sort()
      assert.ok(httpTools.includes('Lumi.get_context'))
      assert.deepEqual(stdioTools, httpTools)
      const result = await stdioClient.callTool({ name: 'Lumi.get_context', arguments: {} })
      assert.notEqual(result.isError, true)
      assert.ok(result.content.length > 0)
      console.log(
        `Sidecars verified with empty PATH and working directory (${httpTools.length} MCP tools).`,
      )
    })(),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Sidecar smoke test timed out after 30 seconds')),
        30_000,
      )
    }),
  ])
} finally {
  clearTimeout(timeout)
  await Promise.allSettled([stdioClient.close(), httpClient.close()])
  lines.close()
  if (core.pid && core.exitCode === null && core.signalCode === null) {
    const exited = once(core, 'exit')
    core.kill()
    await exited
  }
  await rm(temporary, { recursive: true, force: true })
}
