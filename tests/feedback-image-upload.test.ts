import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { FEEDBACK_ALLOWED_IMAGE_TYPES, FEEDBACK_MAX_ATTACHMENTS, FEEDBACK_MAX_FILE_SIZE } from '../lib/feedback'
import { normalizeImageToWebp } from '../lib/image-webp'

const read = (path: string) => readFileSync(path, 'utf8')
const route = read('app/api/uploads/feedback-image/route.ts')
const uploader = read('components/FeedbackImageUploader.tsx')

test('反馈图片接口复用当前 COS 存储链路并返回公开 URL', () => {
  assert.match(route, /formData\?\.get\('file'\)/)
  assert.match(route, /uploadImageVariantFamily/)
  assert.match(route, /const objectPath = `feedback\/\$\{guard\.user\.id\}\/feedback-\$\{randomUUID\(\)\}\/source\.webp`/)
  assert.match(route, /original: input/)
  assert.match(route, /variants: \['thumb-md', 'card', 'large'\]/)
  assert.doesNotMatch(route, /SUPABASE_URL|storage\/v1\/object|supabasePublicObjectUrl/)
  assert.match(route, /const uploadMeta = \{ filename: file\.name, size: file\.size, type: file\.type \}/)
  assert.match(route, /console\.log\('\[feedback-image\.upload\]'[\s\S]*uploadResult/)
})

test('反馈图片前端使用 file 字段并保留开发环境错误原因', () => {
  assert.match(uploader, /body\.append\('file', item\.file\)/)
  assert.match(uploader, /multiple onChange=\{selectFiles\}/)
  assert.match(uploader, /files\.slice\(0, Math\.max\(0, remaining\)\)/)
  assert.match(uploader, /data\?\.message/)
  assert.match(uploader, /data\?\.detail/)
  assert.match(uploader, /HTTP \$\{response\.status\}/)
})

test('反馈图片仍共享 JPG/PNG/WebP 白名单、5 张与 10MB 限制', () => {
  assert.ok(FEEDBACK_ALLOWED_IMAGE_TYPES.includes('image/jpeg'))
  assert.ok(FEEDBACK_ALLOWED_IMAGE_TYPES.includes('image/png'))
  assert.ok(FEEDBACK_ALLOWED_IMAGE_TYPES.includes('image/webp'))
  assert.equal(FEEDBACK_MAX_ATTACHMENTS, 5)
  assert.equal(FEEDBACK_MAX_FILE_SIZE, 10 * 1024 * 1024)
})

test('JPG、PNG、WebP 输入都能被服务端统一转换为 WebP', async () => {
  const create = { width: 4, height: 4, channels: 3 as const, background: { r: 32, g: 96, b: 160 } }
  const sources = [
    await sharp({ create }).jpeg().toBuffer(),
    await sharp({ create }).png().toBuffer(),
    await sharp({ create }).webp().toBuffer(),
  ]

  for (const source of sources) {
    const output = await normalizeImageToWebp(source, { maxWidth: 1600, quality: 82 })
    assert.equal((await sharp(output).metadata()).format, 'webp')
  }
})
