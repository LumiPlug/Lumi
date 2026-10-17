// SPDX-License-Identifier: MPL-2.0

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'packages/core/vendor/codeburn/**',
      '**/node_modules/**',
      '**/target/**',
      'src-tauri/binaries/**',
      'templates/html-home/lumi-sdk.js',
      'pnpm-lock.yaml',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: [
      'src/components/ui/**',
      'src/components/WorkbenchPage.tsx',
      'src/components/WorkbenchContent.tsx',
      '**/*.test.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^(button|input|select|textarea|dialog)$/]",
          message:
            '首页工作台之外请复用 src/components/ui 的共用组件；现有组件不足时先向用户确认。',
        },
      ],
    },
  },
  {
    files: ['templates/html-home/**/app.js'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly' } },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
)
