import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStickerMimeAllowed, sanitizeStickerName } from '@/lib/sticker-upload'

test('isStickerMimeAllowed enforces static vs gif rules', () => {
  // GIF 合集仅接受 image/gif
  assert.equal(isStickerMimeAllowed('image/gif', 'GIF'), true)
  assert.equal(isStickerMimeAllowed('image/jpeg', 'GIF'), false)
  assert.equal(isStickerMimeAllowed('image/png', 'GIF'), false)
  assert.equal(isStickerMimeAllowed('image/webp', 'GIF'), false)

  // 静态合集仅接受 JPG / PNG / WebP
  assert.equal(isStickerMimeAllowed('image/jpeg', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/png', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/webp', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/gif', 'STATIC'), false)

  // 大小写不敏感
  assert.equal(isStickerMimeAllowed('IMAGE/GIF', 'GIF'), true)
  assert.equal(isStickerMimeAllowed('IMAGE/PNG', 'STATIC'), true)
})

test('sanitizeStickerName enforces max 4 characters', () => {
  assert.equal(sanitizeStickerName(null), null)
  assert.equal(sanitizeStickerName(undefined), null)
  assert.equal(sanitizeStickerName('   '), null)
  assert.equal(sanitizeStickerName('点赞'), '点赞')
  assert.equal(sanitizeStickerName('哈哈哈'), '哈哈哈')
  assert.throws(() => sanitizeStickerName('一二三四五'), /不能超过/)
})
