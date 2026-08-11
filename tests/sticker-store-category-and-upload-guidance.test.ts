import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('sticker store replaces the rendered pack list when server props change category', () => {
  const grid = read('app/stickers/StickerStoreGrid.tsx')

  assert.match(grid, /import \{ useEffect, useState \} from 'react'/)
  assert.match(grid, /useEffect\(\(\) => \{\s*setLocalPacks\(packs\)\s*\}, \[packs\]\)/)
})

test('sticker store count and list share the same category where clause', () => {
  const center = read('lib/sticker-center.ts')

  assert.match(center, /if \(opts\.category\) where\.category = opts\.category/)
  assert.match(center, /prisma\.stickerPack\.findMany\(\{\s*where,/)
  assert.match(center, /prisma\.stickerPack\.count\(\{ where \}\)/)
})

test('upload guidance recommends 12–24 without changing the 6–60 validation range', () => {
  const uploader = read('app/stickers/upload/StickerPackUploader.tsx')
  const submitStart = uploader.indexOf('async function submit')
  const submitEnd = uploader.indexOf("if (submitted)")
  const submit = uploader.slice(submitStart, submitEnd)

  assert.match(uploader, /const RECOMMENDED_MIN_FILES = 12/)
  assert.match(uploader, /const RECOMMENDED_MAX_FILES = 24/)
  assert.match(uploader, /const MIN_FILES = 6/)
  assert.match(uploader, /const MAX_FILES = 60/)
  assert.match(uploader, /非强制/)
  assert.match(uploader, /当前数量仍可提交/)
  assert.doesNotMatch(submit, /RECOMMENDED_(MIN|MAX)_FILES/)
})
