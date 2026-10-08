import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import { join } from 'node:path'
import { before, beforeEach, test } from 'node:test'
import sharp from 'sharp'
import {
  createTopicActivityImageDerivative,
  isTopicActivityOriginalObjectKey,
  sanitizeTopicActivityFilename,
  topicActivityOriginalFilename,
  topicActivityOriginalObjectKey,
  topicActivityPreviewObjectPath,
  TOPIC_ACTIVITY_IMAGE_FORMATS,
} from '@/lib/topic-activity-image-original'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')

const ACTIVITY_ID = 'activity-fixture'
const SUBMISSION_ID = 'submission-fixture'
const REPLY_ID = 'reply-fixture'
const ASSET_ID = 'asset-fixture'
const SOURCE_ASSET_ID = 'source-asset-fixture'
const ORIGINAL_BYTES = Buffer.from('topic-v6-original-bytes')
const ORIGINAL_KEY = topicActivityOriginalObjectKey({ activityId: ACTIVITY_ID, purpose: 'ADMIN_REPLY', uploadId: 'upload-fixture', filename: 'reply (1).png', format: 'png' })
const SOURCE_ORIGINAL_KEY = topicActivityOriginalObjectKey({ activityId: ACTIVITY_ID, purpose: 'FORM_ANSWER', uploadId: 'source-upload-fixture', filename: 'source (1).png', format: 'png' })

let currentUser: { id: string; role: 'USER' | 'ADMIN' } | null = { id: 'owner-user', role: 'USER' }
let isAdmin = false
let cosReads = 0
const uploadedObjects: Array<{ key: string; body: Buffer; contentType?: string }> = []
const createdAssetRows: Array<Record<string, unknown>> = []
const storedObjects = new Map<string, Buffer>()
let replyAssetOverride: Record<string, unknown> | null = null
let formUploadEnabled = true
let uploadFormSchema: unknown = { version: 1, fields: [] }
let sourceAssetOverride: Record<string, unknown> | null = null
let serializeAsset: typeof import('@/lib/topic-activity-assets').serializeTopicActivityAsset

const downloadPrismaStub = {
  topicActivityFormSubmission: {
    findFirst: async ({ where }: { where: { id: string; activityId: string } }) => where.id === SUBMISSION_ID && where.activityId === ACTIVITY_ID
      ? { id: SUBMISSION_ID, activityId: ACTIVITY_ID, userId: 'owner-user' }
      : null,
  },
  topicActivitySubmissionReply: {
    findFirst: async ({ where }: { where: { id: string; submissionId: string } }) => where.id === REPLY_ID && where.submissionId === SUBMISSION_ID
      ? { id: REPLY_ID, submissionId: SUBMISSION_ID }
      : null,
  },
  topicActivityImageAsset: {
    findFirst: async ({ where }: { where: { id: string; activityId: string; replyId?: string | null; formSubmissionId?: string; purpose: string } }) => {
      if (where.id === ASSET_ID && where.activityId === ACTIVITY_ID && where.replyId === REPLY_ID && where.purpose === 'ADMIN_REPLY') {
        if (replyAssetOverride) return replyAssetOverride
        return { id: ASSET_ID, storageKey: ORIGINAL_KEY, mimeType: 'image/png', size: ORIGINAL_BYTES.byteLength }
      }
      if (where.id === SOURCE_ASSET_ID && where.activityId === ACTIVITY_ID && where.formSubmissionId === SUBMISSION_ID && where.replyId === null && where.purpose === 'FORM_ANSWER') {
        if (sourceAssetOverride) return sourceAssetOverride
        return { id: SOURCE_ASSET_ID, storageKey: SOURCE_ORIGINAL_KEY, mimeType: 'image/png', size: ORIGINAL_BYTES.byteLength }
      }
      return null
    },
  },
}

let downloadRoute: typeof import('../app/api/activities/[activityId]/form-submissions/[submissionId]/replies/[replyId]/assets/[assetId]/original/route')
let sourceDownloadRoute: typeof import('../app/api/activities/[activityId]/form-submissions/[submissionId]/assets/[assetId]/original/route')
let uploadRoute: typeof import('../app/api/uploads/topic-activity-image/route')

before(async () => {
  const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: downloadPrismaStub }
    if (request === '@/lib/security') return { requireRequestUser: async () => ({ user: currentUser, response: new Response(null, { status: 401 }) }) }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => isAdmin }
    if (request === '@/lib/tencent-cos') return {
      getCosObject: async (key: string) => { cosReads += 1; return storedObjects.get(key) ?? ORIGINAL_BYTES },
      getSignedCosObjectUrl: () => '/fixture-private-preview',
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    downloadRoute = await import('../app/api/activities/[activityId]/form-submissions/[submissionId]/replies/[replyId]/assets/[assetId]/original/route')
    sourceDownloadRoute = await import('../app/api/activities/[activityId]/form-submissions/[submissionId]/assets/[assetId]/original/route')
    ;({ serializeTopicActivityAsset: serializeAsset } = await import('@/lib/topic-activity-assets'))
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return {
      prisma: {
        activity: { findUnique: async () => ({ id: ACTIVITY_ID, type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', startsAt: null, endsAt: null, participationMode: 'BOTH', allowImageAttachments: formUploadEnabled, formSchema: uploadFormSchema }) },
        topicActivityImageAsset: {
          create: async ({ data }: { data: Record<string, unknown> }) => { createdAssetRows.push(data); return { id: ASSET_ID, ...data } },
        },
      },
    }
    if (request === '@/lib/security') return {
      rejectInvalidRequestOrigin: () => null,
      requireRequestUser: async () => ({ user: { id: 'admin-user', role: 'ADMIN' }, response: null }),
      enforceApiRateLimit: async () => null,
    }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => true }
    if (request === '@/lib/site-media-storage') return {
      SiteMediaStorageError: class extends Error {},
      uploadPrivateSiteImage: async ({ key, body, contentType }: { key: string; body: Buffer; contentType?: string }) => {
        uploadedObjects.push({ key, body: Buffer.from(body), contentType })
        storedObjects.set(key, Buffer.from(body))
        return key
      },
    }
    if (request === '@/lib/tencent-cos') return { deleteFromCos: async () => undefined }
    if (request === '@/lib/topic-activity-assets') return {
      serializeTopicActivityAsset: (asset: Record<string, unknown>) => ({ assetId: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, size: asset.size, url: '/preview', thumbnailUrl: '/thumbnail' }),
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    uploadRoute = await import('../app/api/uploads/topic-activity-image/route')
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

beforeEach(() => {
  currentUser = { id: 'owner-user', role: 'USER' }
  isAdmin = false
  cosReads = 0
  uploadedObjects.length = 0
  createdAssetRows.length = 0
  storedObjects.clear()
  replyAssetOverride = null
  sourceAssetOverride = null
  formUploadEnabled = true
  uploadFormSchema = { version: 1, fields: [] }
})

test('V6.1.1 FORM_ANSWER upload accepts an independent IMAGE field with attachments off; no field/no flag is denied', async () => {
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#123456' } }).png().toBuffer()
  const request = () => {
    const form = new FormData()
    form.set('activityId', ACTIVITY_ID)
    form.set('purpose', 'FORM_ANSWER')
    form.set('file', new File([new Uint8Array(bytes)], 'proof.png', { type: 'image/png' }))
    return new Request('https://ecfc.fans/api/uploads/topic-activity-image', { method: 'POST', body: form })
  }
  formUploadEnabled = false
  assert.equal((await uploadRoute.POST(request())).status, 403)
  assert.equal(uploadedObjects.length, 0)
  uploadFormSchema = { version: 1, fields: [{ id: 'photo', label: '截图', type: 'IMAGE', multiple: false, maxImages: 1 }] }
  assert.equal((await uploadRoute.POST(request())).status, 201)
  assert.equal(createdAssetRows.length, 1)
  formUploadEnabled = true
  assert.equal((await uploadRoute.POST(request())).status, 201)
})

function download(path: { activityId?: string; submissionId?: string; replyId?: string; assetId?: string } = {}, view = false) {
  const params = { activityId: ACTIVITY_ID, submissionId: SUBMISSION_ID, replyId: REPLY_ID, assetId: ASSET_ID, ...path }
  return downloadRoute.GET(new Request('https://ecfc.fans/api/topic-activity/original' + (view ? '?view=1' : '')), { params: Promise.resolve(params) })
}

function sourceDownload(path: { activityId?: string; submissionId?: string; assetId?: string } = {}, view = false) {
  const params = { activityId: ACTIVITY_ID, submissionId: SUBMISSION_ID, assetId: SOURCE_ASSET_ID, ...path }
  return sourceDownloadRoute.GET(new Request('https://ecfc.fans/api/topic-activity/source-original' + (view ? '?view=1' : '')), { params: Promise.resolve(params) })
}

test('inline preview preserves original bytes, private headers and all IDOR guards', async () => {
  for (const request of [download, sourceDownload]) {
    const response = await request({}, true)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition') || '', /^inline;/)
    assert.match(response.headers.get('cache-control') || '', /private, no-store/)
    assert.match(response.headers.get('vary') || '', /Cookie, Authorization/)
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(ORIGINAL_BYTES))
    const reads = cosReads
    currentUser = null
    assert.equal((await request({}, true)).status, 401)
    currentUser = { id: 'other-user', role: 'USER' }
    assert.equal((await request({}, true)).status, 404)
    currentUser = { id: 'owner-user', role: 'USER' }
    assert.equal((await request({ activityId: 'guessed-activity' }, true)).status, 404)
    assert.equal(cosReads, reads)
  }
})

test('authenticated original download streams byte-identical owner/admin data', async () => {
  const ownerResponse = await download()
  assert.equal(ownerResponse.status, 200)
  assert.equal(digest(Buffer.from(await ownerResponse.arrayBuffer())), digest(ORIGINAL_BYTES))
  assert.match(ownerResponse.headers.get('content-disposition') || '', /reply \(1\)\.png/)
  currentUser = { id: 'admin-user', role: 'ADMIN' }
  isAdmin = true
  const adminResponse = await download()
  assert.equal(adminResponse.status, 200)
  assert.equal(digest(Buffer.from(await adminResponse.arrayBuffer())), digest(ORIGINAL_BYTES))
  assert.equal(cosReads, 2)
})

test('form-answer original download streams byte-identical owner/admin data', async () => {
  const ownerResponse = await sourceDownload()
  assert.equal(ownerResponse.status, 200)
  assert.equal(digest(Buffer.from(await ownerResponse.arrayBuffer())), digest(ORIGINAL_BYTES))
  assert.match(ownerResponse.headers.get('content-disposition') || '', /source \(1\)\.png/)
  currentUser = { id: 'admin-user', role: 'ADMIN' }
  isAdmin = true
  const adminResponse = await sourceDownload()
  assert.equal(adminResponse.status, 200)
  assert.equal(digest(Buffer.from(await adminResponse.arrayBuffer())), digest(ORIGINAL_BYTES))
  assert.equal(cosReads, 2)
})

test('upload handler stores the exact original bytes and separate private previews', async () => {
  const inputs = [
    { filename: 'reply.png', mimeType: 'image/png', original: await sharp({ create: { width: 5, height: 4, channels: 4, background: { r: 250, g: 190, b: 30, alpha: 1 } } }).png().toBuffer() },
    { filename: 'reply.jpg', mimeType: 'image/jpeg', original: await sharp({ create: { width: 5, height: 4, channels: 3, background: { r: 30, g: 190, b: 250 } } }).jpeg({ quality: 91 }).toBuffer() },
    { filename: 'reply.webp', mimeType: 'image/webp', original: await sharp({ create: { width: 5, height: 4, channels: 4, background: { r: 30, g: 250, b: 190, alpha: 1 } } }).webp({ quality: 91 }).toBuffer() },
  ]
  for (const input of inputs) {
    uploadedObjects.length = 0
    const form = new FormData()
    form.set('activityId', ACTIVITY_ID)
    form.set('purpose', 'ADMIN_REPLY')
    form.set('file', new File([input.original], input.filename, { type: input.mimeType }))
    const response = await uploadRoute.POST(new Request('https://ecfc.fans/api/uploads/topic-activity-image', { method: 'POST', body: form }))
    assert.equal(response.status, 201)
    assert.equal(uploadedObjects.length, 3)
    const storedOriginal = uploadedObjects.find((object) => /\/original-/u.test(object.key))
    assert.ok(storedOriginal)
    assert.equal(digest(storedOriginal.body), digest(input.original))
    assert.equal(storedOriginal.contentType, input.mimeType)
    assert.equal(uploadedObjects.some((object) => object.key.endsWith('/preview.webp')), true)
    assert.equal(uploadedObjects.some((object) => object.key.endsWith('/thumb-md.webp')), true)
    replyAssetOverride = { id: ASSET_ID, ...createdAssetRows.at(-1) }
    const downloaded = await download()
    assert.equal(downloaded.status, 200)
    assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())), digest(input.original), `${input.mimeType}: upload -> authenticated download must be byte-identical`)
  }
})

test('original download denies anonymous/other user and every wrong relation before COS access', async () => {
  currentUser = null
  assert.equal((await download()).status, 401)
  currentUser = { id: 'other-user', role: 'USER' }
  assert.equal((await download()).status, 404)
  currentUser = { id: 'owner-user', role: 'USER' }
  for (const path of [
    { activityId: 'other-activity' },
    { submissionId: 'other-submission' },
    { replyId: 'other-reply' },
    { assetId: 'guessed-asset' },
  ]) assert.equal((await download(path)).status, 404)
  assert.equal(cosReads, 0)
})

test('form-answer original download denies anonymous/other user and every wrong relation before COS access', async () => {
  currentUser = null
  assert.equal((await sourceDownload()).status, 401)
  currentUser = { id: 'other-user', role: 'USER' }
  assert.equal((await sourceDownload()).status, 404)
  currentUser = { id: 'owner-user', role: 'USER' }
  for (const path of [
    { activityId: 'other-activity' },
    { submissionId: 'other-submission' },
    { assetId: 'guessed-asset' },
  ]) assert.equal((await sourceDownload(path)).status, 404)
  assert.equal(cosReads, 0)
})

test('topic originals preserve source bytes while previews are independent derivatives', async () => {
  const inputs = [
    { filename: 'photo.png', mimeType: 'image/png', input: await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer() },
    { filename: 'photo.jpg', mimeType: 'image/jpeg', input: await sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 0, g: 255, b: 0 } } }).jpeg({ quality: 91 }).toBuffer() },
    { filename: 'photo.webp', mimeType: 'image/webp', input: await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).webp({ quality: 91 }).toBuffer() },
  ]
  for (const source of inputs) {
    const sourceHash = digest(source.input)
    const derivative = await createTopicActivityImageDerivative(source.input, source.filename, source.mimeType)
    assert.equal(digest(source.input), sourceHash)
    assert.equal(derivative.width, 3)
    assert.equal(derivative.height, 2)
    assert.notEqual(digest(derivative.preview), sourceHash)
    assert.notEqual(digest(derivative.thumbnail), sourceHash)
    const storageKey = topicActivityOriginalObjectKey({ activityId: 'activity-fixture', purpose: 'ADMIN_REPLY', uploadId: 'upload-fixture', filename: source.filename, format: derivative.format })
    assert.equal(isTopicActivityOriginalObjectKey(storageKey, 'activity-fixture', 'ADMIN_REPLY'), true)
    assert.equal(topicActivityPreviewObjectPath(storageKey, 'preview')?.endsWith('/preview.webp'), true)
    assert.equal(topicActivityPreviewObjectPath(storageKey, 'thumbnail')?.endsWith('/thumb-md.webp'), true)
    assert.equal(topicActivityOriginalFilename(storageKey, 'fallback.jpg', derivative.mimeType), source.filename)
  }
  const avifPayload = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 4, g: 5, b: 6 } } }).heif({ compression: 'av1' }).toBuffer()
  await assert.rejects(() => createTopicActivityImageDerivative(avifPayload, 'looks-like-heic.heic', 'image/heic'), /UNSUPPORTED_FORMAT/u)
})

test('large 4500x3000 source above forum threshold is stored byte-for-byte with original dimensions', async () => {
  // A deterministic synthetic high-detail image, not a real user's photo or
  // a small JPEG padded with trailing bytes, exercises the actual size gate.
  const pixels = Buffer.alloc(4500 * 3000 * 3)
  let seed = 0x12345678
  for (let offset = 0; offset < pixels.length; offset += 1) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    pixels[offset] = seed & 255
  }
  const original = await sharp(pixels, { raw: { width: 4500, height: 3000, channels: 3 } }).jpeg({ quality: 82 }).toBuffer()
  assert.ok(original.byteLength > 4 * 1024 * 1024)
  assert.ok(original.byteLength <= 20 * 1024 * 1024)
  uploadedObjects.length = 0
  const form = new FormData()
  form.set('activityId', ACTIVITY_ID)
  form.set('purpose', 'FORM_ANSWER')
  form.set('file', new File([original], 'large-source.jpg', { type: 'image/jpeg' }))
  const response = await uploadRoute.POST(new Request('https://ecfc.fans/api/uploads/topic-activity-image', { method: 'POST', body: form, headers: { Origin: 'https://ecfc.fans' } }))
  assert.equal(response.status, 201)
  const storedOriginal = uploadedObjects.find((object) => /\/original-/u.test(object.key))
  assert.ok(storedOriginal)
  assert.equal(digest(storedOriginal.body), digest(original))
  assert.equal(createdAssetRows[0]?.width, 4500)
  assert.equal(createdAssetRows[0]?.height, 3000)
  assert.equal(createdAssetRows[0]?.size, original.byteLength)
  sourceAssetOverride = { id: SOURCE_ASSET_ID, ...createdAssetRows[0] }
  const downloaded = await sourceDownload()
  assert.equal(downloaded.status, 200)
  assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())), digest(original))
})

test('original download rejects truncated objects and legacy assets do not expose broken download buttons', async () => {
  storedObjects.set(ORIGINAL_KEY, Buffer.alloc(0))
  assert.equal((await download()).status, 502)
  const base = { id: ASSET_ID, mimeType: 'image/png', width: 5, height: 4, size: 100 }
  const context = { activityId: ACTIVITY_ID, submissionId: SUBMISSION_ID, replyId: REPLY_ID, purpose: 'ADMIN_REPLY' as const }
  assert.ok(serializeAsset({ ...base, storageKey: ORIGINAL_KEY }, context).originalDownloadUrl)
  assert.equal(serializeAsset({ ...base, storageKey: 'topic-activity/activity-fixture/replies/legacy.webp' }, context).originalDownloadUrl, undefined)
  assert.equal(serializeAsset({ ...base, storageKey: SOURCE_ORIGINAL_KEY }, context).originalDownloadUrl, undefined)
})

test('oversized source is rejected explicitly without silent compression or storage writes', async () => {
  const form = new FormData()
  form.set('activityId', ACTIVITY_ID)
  form.set('purpose', 'FORM_ANSWER')
  form.set('file', new File([Buffer.alloc(20 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' }))
  const response = await uploadRoute.POST(new Request('https://ecfc.invalid/api/uploads/topic-activity-image', { method: 'POST', body: form }))
  assert.equal(response.status, 413)
  const body = await response.json() as { code: string; message: string }
  assert.equal(body.code, 'FILE_TOO_LARGE')
  assert.equal(body.message, '图片过大，请选择较小原图')
  assert.equal(uploadedObjects.length, 0)
  assert.equal(createdAssetRows.length, 0)
})

test('topic original key sanitizes path traversal and header-injection filenames', () => {
  const sanitized = sanitizeTopicActivityFilename('../my..png\r\n".png', 'fallback.png', 'image/png')
  assert.equal(sanitized.includes('..'), false)
  assert.equal(sanitized.includes('\r'), false)
  assert.equal(sanitized.includes('\n'), false)
  assert.equal(sanitized.includes('/'), false)
  const key = topicActivityOriginalObjectKey({ activityId: 'activity-fixture', purpose: 'ADMIN_REPLY', uploadId: 'upload-fixture', filename: '../my..png\r\n".png', format: 'png' })
  assert.equal(key.includes('..'), false)
  assert.equal(key.includes('/original-'), true)
  assert.equal(isTopicActivityOriginalObjectKey(key, 'other-activity', 'ADMIN_REPLY'), false)
})

test('topic original key bounds long Unicode filenames to the storage column', () => {
  const key = topicActivityOriginalObjectKey({
    activityId: 'a'.repeat(128),
    purpose: 'FORM_ANSWER',
    uploadId: 'u'.repeat(191),
    filename: `${'繁'.repeat(160)}.png`,
    format: 'png',
  })
  assert.ok(key.length <= 500)
  assert.match(key, /\.png$/u)
  assert.equal(isTopicActivityOriginalObjectKey(key, 'a'.repeat(128), 'FORM_ANSWER'), true)
})

test('topic media path keeps supported HEIF originals and never exposes a public URL', () => {
  assert.equal(TOPIC_ACTIVITY_IMAGE_FORMATS.has('heif'), true)
  const upload = read('app/api/uploads/topic-activity-image/route.ts')
  const endpoint = read('app/api/activities/[activityId]/form-submissions/[submissionId]/replies/[replyId]/assets/[assetId]/original/route.ts')
  const sourceEndpoint = read('app/api/activities/[activityId]/form-submissions/[submissionId]/assets/[assetId]/original/route.ts')
  const downloadService = read('lib/topic-activity-image-download.ts')
  const assets = read('lib/topic-activity-assets.ts')
  const manager = read('app/admin/activities/TopicActivityFormSubmissionManager.tsx')
  const browser = read('lib/content-image-browser.ts')
  assert.match(upload, /uploadPrivateSiteImage/)
  assert.match(upload, /storageKey: objectPath/)
  assert.match(upload, /size: original\.byteLength/)
  assert.match(upload, /TOPIC_ACTIVITY_IMAGE_TOO_LARGE_MESSAGE/)
  assert.doesNotMatch(upload, /uploadImageVariantFamily/)
  assert.doesNotMatch(upload, /getCosUrl/)
  assert.doesNotMatch(browser, /uploadTopicActivityImage[\s\S]*prepareContentImageFile/)
  assert.match(endpoint, /activityId, submissionId, replyId, assetId/)
  assert.match(endpoint, /purpose: 'ADMIN_REPLY'/)
  assert.match(endpoint, /submission\.userId === guard\.user\.id/)
  assert.match(endpoint, /Cache-Control.*private, no-store/)
  assert.match(sourceEndpoint, /formSubmissionId: submission\.id/)
  assert.match(sourceEndpoint, /purpose: 'FORM_ANSWER'/)
  assert.match(sourceEndpoint, /submission\.userId === guard\.user\.id/)
  assert.match(downloadService, /body\.byteLength !== asset\.size/)
  assert.match(assets, /purpose: 'FORM_ANSWER'/)
  assert.match(manager, /TopicActivityOriginalImage/)
  assert.match(read('components/activities/TopicActivityOriginalImage.tsx'), /下载原图/)
})
