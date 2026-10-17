// SPDX-License-Identifier: MPL-2.0
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: [
      'packages/core/vendor/codeburn/tests/providers/*.test.ts',
      'packages/core/vendor/codeburn/tests/*.test.ts',
    ],
    setupFiles: ['packages/core/vendor/codeburn/tests/setup/env-isolation.ts'],
    testTimeout: 30000,
    maxWorkers: 4,
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/codeburn-upstream-tests.json' },
  },
})
