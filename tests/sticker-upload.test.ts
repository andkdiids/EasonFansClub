import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStickerMimeAllowed, sanitizeStickerName } from '@/lib/sticker-upload'
import {
  normalizeImageMime,
  normalizeStickerMime,
  isSupportedStickerFile,
} from '@/lib/sticker-upload-constraints'

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
  assert.equal(isStickerMimeAllowed('image/jpg', 'STATIC'), true)
})

test('normalizes static image MIME with empty-browser-MIME extension fallback', () => {
  assert.equal(normalizeImageMime({ name: 'cover.jpg', type: 'image/jpeg' }), 'image/jpeg')
  assert.equal(normalizeImageMime({ name: 'cover.jpeg', type: 'image/jpeg' }), 'image/jpeg')
  assert.equal(normalizeImageMime({ name: 'cover.jpg', type: 'image/jpg' }), 'image/jpeg')
  assert.equal(normalizeImageMime({ name: 'cover.jpg', type: '' }), 'image/jpeg')
  assert.equal(normalizeImageMime({ name: 'cover.jpg', type: 'application/octet-stream' }), 'image/jpeg')
  assert.equal(normalizeImageMime({ name: 'cover.png', type: '' }), 'image/png')
  assert.equal(normalizeImageMime({ name: 'cover.webp', type: 'image/webp' }), 'image/webp')
  assert.equal(normalizeImageMime({ name: 'cover.gif', type: '' }), null)
  assert.equal(normalizeImageMime({ name: 'cover.jpg', type: 'image/gif' }), null)
})

test('normalizes animated sticker MIME without restricting it to cover formats', () => {
  assert.equal(normalizeStickerMime({ name: 'sticker.gif', type: '' }), 'image/gif')
  assert.equal(normalizeStickerMime({ name: 'sticker.apng', type: '' }), 'image/apng')
  assert.equal(normalizeStickerMime({ name: 'sticker.jpg', type: 'image/jpg' }), 'image/jpeg')
  assert.equal(isSupportedStickerFile({ name: 'sticker.webp', type: '' }), true)
  assert.equal(isSupportedStickerFile({ name: 'sticker.txt', type: '' }), false)
})

test('sanitizeStickerName enforces max 4 characters', () => {
  assert.equal(sanitizeStickerName(null), null)
  assert.equal(sanitizeStickerName(undefined), null)
  assert.equal(sanitizeStickerName('   '), null)
  assert.equal(sanitizeStickerName('点赞'), '点赞')
  assert.equal(sanitizeStickerName('哈哈哈'), '哈哈哈')
  assert.throws(() => sanitizeStickerName('一二三四五'), /不能超过/)
})
