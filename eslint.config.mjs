import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      '.next-editor-interaction/**',
      '.next_bak/**',
      '.next_old_*/**',
      'node_modules/**',
      '.prisma-local/**',
      'coverage/**',
      'dist/**',
      'scripts/database-migration/.generated/**',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // These explicit .cjs release utilities execute under Node's CommonJS
    // loader. Keep the exception limited to the three files that must retain
    // require() for local helpers and pinned CommonJS dependencies.
    files: [
      '.github/release/production-anywhere-door-diagnostic-v2.cjs',
      '.github/release/test-production-anywhere-door-diagnostic-v2.cjs',
      '.github/release/test-production-anywhere-door-manual-trace.cjs',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]

export default eslintConfig
