import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStickerMimeAllowed, sanitizeStickerName } from '@/lib/sticker-upload'

test('isStickerMimeAllowed accepts supported upload candidates regardless of UI hint', () => {
  assert.equal(isStickerMimeAllowed('image/gif', 'GIF'), true)
  assert.equal(isStickerMimeAllowed('image/gif', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/jpeg', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/png', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/webp', 'STATIC'), true)
  assert.equal(isStickerMimeAllowed('image/apng', 'GIF'), true)
  assert.equal(isStickerMimeAllowed('image/apng', 'STATIC'), true)

  // 大小写不敏感；服务端仍会继续校验真实文件内容
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
