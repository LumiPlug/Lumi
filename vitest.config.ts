// SPDX-License-Identifier: MPL-2.0

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@lumiplug/shared': fileURLToPath(new URL('./packages/shared/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'src/lib/**/*.test.ts'],
    reporters: ['default'],
  },
})
