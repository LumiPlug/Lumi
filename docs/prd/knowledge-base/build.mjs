// SPDX-License-Identifier: MPL-2.0
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../KNOWLEDGE_BASE_PRD.html')
const html = await readFile(join(here, 'index.html'), 'utf8')
const result = await build({
  entryPoints: [join(here, 'main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  target: ['es2022'],
  outfile: join(here, 'bundle.js'),
  write: false,
  legalComments: 'none',
})
const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? ''
const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
const embedded = html
  .replace('<script type="module" src="./main.tsx"></script>', () => `<style>${css}</style><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`)
await writeFile(out, embedded)
console.log(`Built ${out}`)
