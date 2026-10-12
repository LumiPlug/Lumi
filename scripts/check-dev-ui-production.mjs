// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(import.meta.dirname, '..')
const files = (await fs.readdir(path.join(root, 'dist/assets'))).filter((name) =>
  name.endsWith('.js'),
)
assert(files.length > 0, 'Production frontend must be built first')
const forbidden = [
  '__LUMI_DEV_UI_PRESET__',
  'lumi_dev_ui_record',
  'dispatchDevelopmentUiAction',
  '[lumi-development-ui]',
]
for (const file of files) {
  const text = await fs.readFile(path.join(root, 'dist/assets', file), 'utf8')
  for (const marker of forbidden)
    assert(!text.includes(marker), `${file} contains development-only marker ${marker}`)
}
if (process.argv[2]) {
  const bytes = await fs.readFile(path.resolve(process.argv[2]))
  for (const marker of ['lumi_dev_ui_record', '--lumi-dev-ui-action=', '__LUMI_DEV_UI_PRESET__'])
    assert(!bytes.includes(Buffer.from(marker)), `Release binary contains ${marker}`)
}
console.log('Production frontend and supplied release binary contain no development UI entry.')
