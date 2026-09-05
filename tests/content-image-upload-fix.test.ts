import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CONTENT_IMAGE_COMPRESSION_TARGET,
  CONTENT_IMAGE_COMPRESSION_THRESHOLD,
  CONTENT_IMAGE_MAX_FILE_SIZE,
  validateContentImageFileMetadata,
} from '../lib/content-image-upload'

const root = process.cwd()
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('帖子图片共享 20MB 单图限制并允许空 MIME 的常见扩展名', () => {
  assert.equal(CONTENT_IMAGE_MAX_FILE_SIZE, 20 * 1024 * 1024)
  assert.equal(CONTENT_IMAGE_COMPRESSION_THRESHOLD, 5 * 1024 * 1024)
  assert.equal(CONTENT_IMAGE_COMPRESSION_TARGET, 4 * 1024 * 1024)
  assert.equal(validateContentImageFileMetadata({ name: 'IMG_1234.JPG', type: '', size: 8 * 1024 * 1024 }).ok, true)
  assert.equal(validateContentImageFileMetadata({ name: 'photo.heic', type: '', size: 2 * 1024 * 1024 }).ok, true)
  assert.equal(validateContentImageFileMetadata({ name: 'photo.png', type: 'application/octet-stream', size: 1 }).ok, true)
  assert.equal(validateContentImageFileMetadata({ name: 'photo.txt', type: '', size: 1 }).code, 'UNSUPPORTED_FORMAT')
  assert.equal(validateContentImageFileMetadata({ name: 'photo.jpg', type: '', size: CONTENT_IMAGE_MAX_FILE_SIZE + 1 }).code, 'FILE_TOO_LARGE')
})

test('JPG/PNG/WebP/HEIC/HEIF 的 MIME 和扩展名提示均可进入处理链路', () => {
  for (const [name, type] of [
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['photo.webp', 'image/webp'],
    ['photo.heic', 'image/heic'],
    ['photo.heif', 'image/heif'],
  ] as const) {
    assert.equal(validateContentImageFileMetadata({ name, type, size: 1024 }).ok, true, name)
  }
})

test('前后端图片上传字段、multipart 边界和逐图状态保持一致', () => {
  const uploader = read('components/ContentImageUploader.tsx')
  const browser = read('lib/content-image-browser.ts')
  const route = read('app/api/uploads/content-image/route.ts')
  const config = read('next.config.ts')

  assert.match(uploader, /form\.set\('file', file\)/)
  assert.match(uploader, /accept=\{CONTENT_IMAGE_ACCEPT\}/)
  assert.match(uploader, /URL\.createObjectURL\(file\)/)
  assert.match(uploader, /phase: 'processing'/)
  assert.match(uploader, /正在压缩/)
  assert.match(uploader, /重试/)
  assert.match(uploader, /for \(const item of newItems\) await uploadItem\(item\)/)
  assert.doesNotMatch(uploader, /headers:\s*\{[^}]*Content-Type/i)
  assert.match(browser, /CONTENT_IMAGE_COMPRESSION_THRESHOLD/)
  assert.match(browser, /CONTENT_IMAGE_COMPRESSION_TARGET/)
  assert.match(browser, /isContentImageHeic/)
  assert.match(route, /request\.headers\.get\('content-type'\)/)
  assert.match(route, /form\?\.get\('file'\)/)
  assert.match(route, /CONTENT_IMAGE_MAX_FILE_SIZE_BYTES/)
  assert.match(route, /preserveOriginal: false/)
  assert.match(route, /remove: deleteFromCos/)
  assert.match(config, /middlewareClientMaxBodySize: '256mb'/)
})
