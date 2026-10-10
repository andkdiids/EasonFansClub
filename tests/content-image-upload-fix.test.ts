import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CONTENT_IMAGE_ERROR_MESSAGES,
  CONTENT_IMAGE_COMPRESSION_TARGET,
  CONTENT_IMAGE_COMPRESSION_THRESHOLD,
  CONTENT_IMAGE_MAX_RETRIES,
  CONTENT_IMAGE_MAX_FILE_SIZE,
  CONTENT_IMAGE_UPLOAD_TIMEOUT_MS,
  validateContentImageFileMetadata,
} from '../lib/content-image-upload'
import { ContentImageClientError, prepareContentImageFile, uploadContentImage } from '../lib/content-image-browser'

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
  const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
  const replyForm = read('components/ReplyForm.tsx')
  const config = read('next.config.ts')

  assert.equal(CONTENT_IMAGE_UPLOAD_TIMEOUT_MS, 60_000)
  assert.equal(CONTENT_IMAGE_MAX_RETRIES, 3)
  assert.equal(CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_TIMEOUT, '图片处理或上传超时，请检查网络后重试')
  assert.match(uploader, /form\.set\('file', file\)/)
  assert.match(uploader, /accept=\{CONTENT_IMAGE_ACCEPT\}/)
  assert.match(uploader, /URL\.createObjectURL\(file\)/)
  assert.match(uploader, /phase: 'processing'/)
  assert.match(uploader, /phase: 'queued'/)
  assert.match(uploader, /getUploadState/)
  assert.match(uploader, /CONTENT_IMAGE_MAX_RETRIES/)
  assert.match(uploader, /uploadControllersRef\.current\.has\(item\.id\)/)
  assert.match(uploader, /retryCapacityFull/)
  assert.match(uploader, /已达到图片数量上限，请先删除图片后再重试/)
  assert.match(uploader, /上传成功/)
  assert.match(uploader, /正在压缩/)
  assert.match(uploader, /重试/)
  assert.match(uploader, /for \(const item of newItems\) await uploadItem\(item\)/)
  assert.doesNotMatch(uploader, /headers:\s*\{[^}]*Content-Type/i)
  assert.match(browser, /CONTENT_IMAGE_COMPRESSION_THRESHOLD/)
  assert.match(browser, /CONTENT_IMAGE_COMPRESSION_TARGET/)
  assert.match(browser, /isContentImageHeic/)
  assert.match(browser, /allowServerHeicDecode: true/)
  assert.match(browser, /signal/)
  assert.match(browser, /UPLOAD_TIMEOUT/)
  assert.match(browser, /canvas\.toBlob/)
  assert.match(route, /request\.headers\.get\('content-type'\)/)
  assert.match(route, /form\?\.get\('file'\)/)
  assert.match(route, /CONTENT_IMAGE_MAX_FILE_SIZE_BYTES/)
  assert.match(route, /requireRequestUser/)
  assert.match(route, /sharp\(buffer[\s\S]*metadata\(\)/)
  assert.match(route, /ALLOWED_IMAGE_FORMATS/)
  assert.match(route, /isContentImageHeic/)
  assert.match(route, /preserveOriginal: false/)
  assert.match(route, /remove: deleteFromCos/)
  assert.match(replyForm, /onUploadStateChange=\{setImageUploadState\}/)
  assert.match(replyForm, /图片尚未上传完成。/)
  assert.match(replyForm, /latestImageUploadState/)
  assert.match(replyRoute, /allowImageAttachments === false/)
  assert.match(replyRoute, /TOPIC_COMMENT_ATTACHMENTS_DISABLED/)
  assert.match(config, /middlewareClientMaxBodySize: '256mb'/)
})

test('评论图片上传的准备与 fetch 都有可中断的有限时限', async () => {
  const originalFetch = globalThis.fetch
  const phases: string[] = []
  let requestSignal: AbortSignal | undefined
  globalThis.fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init?.signal ?? undefined
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })) as typeof fetch
  try {
    const file = new File([Buffer.from('png')], 'tiny.png', { type: 'image/png' })
    await assert.rejects(
      uploadContentImage(file, (phase) => phases.push(phase), { timeoutMs: 20 }),
      (error: unknown) => error instanceof ContentImageClientError && error.code === 'UPLOAD_TIMEOUT' && error.message === CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_TIMEOUT,
    )
    assert.deepEqual(phases, ['processing', 'uploading'])
    assert.equal(requestSignal?.aborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HEIC 在浏览器无解码器时保留原文件交给服务器，并把服务器失败显式化', async () => {
  const globals = globalThis as unknown as { Image?: unknown; createImageBitmap?: unknown }
  const previousImage = globals.Image
  const previousBitmap = globals.createImageBitmap
  const originalFetch = globalThis.fetch
  delete globals.Image
  delete globals.createImageBitmap
  try {
    const file = new File([Buffer.from('heic')], 'photo.heic', { type: 'image/heic' })
    const prepared = await prepareContentImageFile(file, undefined, { allowServerHeicDecode: true })
    assert.equal(prepared, file)

    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'HEIC_CONVERSION_FAILED', message: '服务器无法解码 HEIC' }), { status: 422, headers: { 'content-type': 'application/json' } })) as typeof fetch
    await assert.rejects(
      uploadContentImage(file, undefined, { timeoutMs: 100 }),
      (error: unknown) => error instanceof ContentImageClientError && error.code === 'HEIC_CONVERSION_FAILED' && error.message === '服务器无法解码 HEIC',
    )
  } finally {
    if (previousImage === undefined) delete globals.Image
    else globals.Image = previousImage
    if (previousBitmap === undefined) delete globals.createImageBitmap
    else globals.createImageBitmap = previousBitmap
    globalThis.fetch = originalFetch
  }
})

test('服务端错误消息拒绝 token/path/URL 泄漏并保留安全诊断', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'UPLOAD_FAILED', message: 'Bearer secret /Users/eason/private.png' }), { status: 502, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try {
    const file = new File([Buffer.from('png')], 'tiny.png', { type: 'image/png' })
    await assert.rejects(
      uploadContentImage(file, undefined, { timeoutMs: 100 }),
      (error: unknown) => error instanceof ContentImageClientError && error.code === 'UPLOAD_FAILED' && error.message === CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_FAILED,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
