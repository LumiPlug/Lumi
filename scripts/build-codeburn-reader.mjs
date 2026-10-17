// SPDX-License-Identifier: MPL-2.0
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'packages/core/vendor/codeburn')
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(base, 'entry.ts')],
  outfile: path.join(base, 'reader.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node26',
  define: { 'import.meta.url': '__lumiCodeburnModuleUrl' },
  banner: {
    js: 'const __lumiCodeburnModuleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  legalComments: 'eof',
  metafile: true,
  plugins: [
    {
      name: 'lumi-private-provider-cache',
      setup(build) {
        build.onLoad(
          { filter: /[/\\](cache-dir|cursor-cache|codex-cache|antigravity|vercel-gateway)\.ts$/ },
          async ({ path: filename }) => {
            let contents = await readFile(filename, 'utf8')
            if (filename.endsWith('cache-dir.ts')) {
              contents = contents.replace(
                "process.env['CODEBURN_CACHE_DIR']",
                "process.env['LUMI_CODEBURN_CACHE_DIR']",
              )
              contents = contents.replace(
                "join(homedir(), '.cache', 'codeburn')",
                "join(homedir(), '.cache', 'Lumi', 'usage-readers')",
              )
            } else if (filename.endsWith('vercel-gateway.ts')) {
              contents = contents
                .replace('      return []', '      throw new Error("gateway_report_unavailable")')
                .replace(
                  '    return []\n  }\n}',
                  '    throw new Error("gateway_report_unavailable")\n  }\n}',
                )
            } else {
              // These are display/behavioral fields, never token or de-duplication fields.
              // Resume checkpoints can retain an interrupted prompt and pending commands.
              // Only prompt length participates in fallback token estimates.
              const redact =
                '(key, value) => key === "userMessage" ? "" : key === "pendingUserMessage" && typeof value === "string" ? " ".repeat(value.length) : ["bashCommands", "tools", "skills", "subagentTypes", "toolSequence", "pendingTools", "pendingToolSequence", "pendingSkills", "mcpInventory", "prRefs", "prLinks"].includes(key) ? [] : value'
              for (const name of ['memCache', 'cache'])
                contents = contents.replaceAll(
                  `JSON.stringify(${name})`,
                  `JSON.stringify(${name}, ${redact})`,
                )
            }
            return { contents, loader: 'ts' }
          },
        )
      },
    },
  ],
})
await writeFile(
  path.join(base, 'bundle-inputs.json'),
  JSON.stringify(
    Object.keys(result.metafile.inputs)
      .filter((name) => name.includes('vendor/codeburn/src/'))
      .sort(),
    null,
    2,
  ) + '\n',
)
