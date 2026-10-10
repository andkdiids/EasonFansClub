import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import { join } from 'node:path'
import { before, beforeEach, test } from 'node:test'
import { topicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const ACTIVITY_ID = 'activity-fixture'
const SUBMISSION_ID = 'submission-fixture'
const ASSET_ID = 'asset-fixture'
const REPLY_ASSET_ID = 'reply-asset-fixture'
const ORIGINAL_KEY = topicActivityOriginalObjectKey({ activityId: ACTIVITY_ID, purpose: 'FORM_ANSWER', uploadId: 'upload-fixture', filename: 'source.png', format: 'png' })
const REPLY_KEY = topicActivityOriginalObjectKey({ activityId: ACTIVITY_ID, purpose: 'ADMIN_REPLY', uploadId: 'reply-upload-fixture', filename: 'reply.png', format: 'png' })
const LEGACY_KEY = `topic-activity/${ACTIVITY_ID}/submissions/legacy-upload/source.webp`
const PREVIEW_BYTES = Buffer.from('private-preview-bytes')

let currentUser: { id: string } | null = { id: 'owner-user' }
let admin = false
let reads: string[] = []
let assetKey = ORIGINAL_KEY
let requestedAssetId = ASSET_ID
let assetPurpose: 'FORM_ANSWER' | 'ADMIN_REPLY' = 'FORM_ANSWER'
let submissionOwner = 'owner-user'
let uploadOwner = 'owner-user'

const prismaStub = {
  topicActivityImageAsset: {
    findFirst: async ({ where }: { where: { id: string; activityId: string } }) => {
      if (where.activityId !== ACTIVITY_ID || where.id !== requestedAssetId) return null
      return {
        id: requestedAssetId,
        activityId: ACTIVITY_ID,
        uploadedByUserId: uploadOwner,
        purpose: assetPurpose,
        storageKey: assetKey,
        FormSubmission: assetPurpose === 'FORM_ANSWER' ? { userId: submissionOwner } : null,
        Reply: assetPurpose === 'ADMIN_REPLY' ? { Submission: { userId: submissionOwner } } : null,
      }
    },
  },
}

let previewRoute: typeof import('../app/api/activities/[activityId]/assets/[assetId]/preview/route')
let serializeAsset: typeof import('@/lib/topic-activity-assets').serializeTopicActivityAsset

before(async () => {
  const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaStub }
    if (request === '@/lib/security') return {
      requireRequestUser: async () => ({ user: currentUser, response: currentUser ? null : new Response(null, { status: 401 }) }),
    }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => admin }
    if (request === '@/lib/tencent-cos') return {
      getCosObject: async (key: string) => { reads.push(key); return PREVIEW_BYTES },
      getSignedCosObjectUrl: (key: string) => `/signed/${key}`,
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    previewRoute = await import('../app/api/activities/[activityId]/assets/[assetId]/preview/route')
    ;({ serializeTopicActivityAsset: serializeAsset } = await import('@/lib/topic-activity-assets'))
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

beforeEach(() => {
  currentUser = { id: 'owner-user' }
  admin = false
  reads = []
  assetKey = ORIGINAL_KEY
  requestedAssetId = ASSET_ID
  assetPurpose = 'FORM_ANSWER'
  submissionOwner = 'owner-user'
  uploadOwner = 'owner-user'
})

function request(
  path = `/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview`,
  params: { activityId: string; assetId: string } = { activityId: ACTIVITY_ID, assetId: ASSET_ID },
) {
  return previewRoute.GET(new Request(`https://ecfc.fans${path}`), { params: Promise.resolve(params) })
}

test('serializer preserves signed Mobile URLs and adds stable Web access fields', () => {
  const asset = { id: ASSET_ID, storageKey: ORIGINAL_KEY, mimeType: 'image/png', width: 10, height: 10, size: 100, activityId: ACTIVITY_ID, purpose: 'FORM_ANSWER' as const }
  const serialized = serializeAsset(asset)
  assert.match(serialized.url, /^\/signed\//u)
  assert.match(serialized.thumbnailUrl, /^\/signed\//u)
  assert.equal(serialized.previewAccessUrl, `/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview`)
  assert.equal(serialized.thumbnailAccessUrl, `/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview?variant=thumbnail`)
})

test('persisted context also uses a stable proxy while unrelated legacy keys retain the bounded fallback', () => {
  const persisted = serializeAsset({ id: ASSET_ID, storageKey: ORIGINAL_KEY, mimeType: 'image/png', width: 1, height: 1, size: 1 }, { activityId: ACTIVITY_ID, submissionId: SUBMISSION_ID, purpose: 'FORM_ANSWER' })
  assert.match(persisted.url, /^\/signed\//u)
  assert.equal(persisted.previewAccessUrl, `/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview`)
  const legacy = serializeAsset({ id: ASSET_ID, storageKey: 'legacy/private.webp', mimeType: 'image/webp', width: 1, height: 1, size: 1 })
  assert.match(legacy.url, /^\/signed\//u)
  assert.match(legacy.thumbnailUrl, /^\/signed\//u)
  assert.equal(legacy.previewAccessUrl, undefined)
  assert.equal(legacy.thumbnailAccessUrl, undefined)
})

test('historical source rows use stable authorized derivative proxies', async () => {
  assetKey = LEGACY_KEY
  const serialized = serializeAsset({ id: ASSET_ID, storageKey: LEGACY_KEY, mimeType: 'image/webp', width: 1, height: 1, size: 1, activityId: ACTIVITY_ID, purpose: 'FORM_ANSWER' })
  assert.match(serialized.url, /^\/signed\//u)
  assert.equal(serialized.previewAccessUrl, `/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview`)
  assert.equal(serialized.thumbnailAccessUrl, `/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview?variant=thumbnail`)

  const preview = await request()
  assert.equal(preview.status, 200)
  assert.equal(reads.at(-1), `${LEGACY_KEY.slice(0, LEGACY_KEY.lastIndexOf('/'))}/large.webp`)
  const thumbnail = await request(`/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview?variant=thumbnail`)
  assert.equal(thumbnail.status, 200)
  assert.equal(reads.at(-1), `${LEGACY_KEY.slice(0, LEGACY_KEY.lastIndexOf('/'))}/thumb-md.webp`)

  assetKey = `topic-activity/${ACTIVITY_ID}/submissions/legacy-upload/source.png`
  assert.equal((await request()).status, 404)
  assert.equal(reads.length, 2)
})

test('owner receives private derivative bytes for both preview variants without COS-signed URL exposure', async () => {
  const preview = await request()
  assert.equal(preview.status, 200)
  assert.equal(await preview.text(), PREVIEW_BYTES.toString())
  assert.equal(preview.headers.get('content-type'), 'image/webp')
  assert.match(preview.headers.get('cache-control') || '', /private, no-store/u)
  assert.match(preview.headers.get('vary') || '', /Cookie, Authorization/u)
  assert.equal(reads.at(-1), `${ORIGINAL_KEY.slice(0, ORIGINAL_KEY.lastIndexOf('/'))}/preview.webp`)

  const thumbnail = await request(`/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview?variant=thumbnail`)
  assert.equal(thumbnail.status, 200)
  assert.equal(reads.at(-1), `${ORIGINAL_KEY.slice(0, ORIGINAL_KEY.lastIndexOf('/'))}/thumb-md.webp`)
})

test('preview route denies anonymous, wrong activity/asset, invalid variant, and unrelated users before COS', async () => {
  currentUser = null
  assert.equal((await request()).status, 401)
  currentUser = { id: 'other-user' }
  assert.equal((await request()).status, 404)
  assert.equal((await request(`/api/activities/other-activity/assets/${ASSET_ID}/preview`, { activityId: 'other-activity', assetId: ASSET_ID })).status, 404)
  assert.equal((await request(`/api/activities/${ACTIVITY_ID}/assets/other-asset/preview`, { activityId: ACTIVITY_ID, assetId: 'other-asset' })).status, 404)
  assert.equal((await request(`/api/activities/${ACTIVITY_ID}/assets/${ASSET_ID}/preview?variant=original`)).status, 404)
  assert.equal(reads.length, 0)
})

test('submission owner and activity admin can preview a reply asset; legacy storage cannot become a preview target', async () => {
  requestedAssetId = REPLY_ASSET_ID
  assetKey = REPLY_KEY
  assetPurpose = 'ADMIN_REPLY'
  uploadOwner = 'admin-uploader'
  submissionOwner = 'owner-user'
  const owner = await request(`/api/activities/${ACTIVITY_ID}/assets/${REPLY_ASSET_ID}/preview`, { activityId: ACTIVITY_ID, assetId: REPLY_ASSET_ID })
  assert.equal(owner.status, 200)

  currentUser = { id: 'other-user' }
  assert.equal((await request(`/api/activities/${ACTIVITY_ID}/assets/${REPLY_ASSET_ID}/preview`, { activityId: ACTIVITY_ID, assetId: REPLY_ASSET_ID })).status, 404)
  admin = true
  const adminResponse = await request(`/api/activities/${ACTIVITY_ID}/assets/${REPLY_ASSET_ID}/preview`, { activityId: ACTIVITY_ID, assetId: REPLY_ASSET_ID })
  assert.equal(adminResponse.status, 200)

  admin = false
  currentUser = { id: 'owner-user' }
  assetKey = 'topic-activity/activity-fixture/replies/legacy.webp'
  assert.equal((await request(`/api/activities/${ACTIVITY_ID}/assets/${REPLY_ASSET_ID}/preview`, { activityId: ACTIVITY_ID, assetId: REPLY_ASSET_ID })).status, 404)
})

test('preview retry is bounded and original preview abort/revoke controls are present', () => {
  const image = read('components/activities/TopicActivityAssetImage.tsx')
  const picker = read('components/activities/TopicActivityImagePicker.tsx')
  const participation = read('components/activities/TopicActivityFormParticipation.tsx')
  const original = read('components/activities/TopicActivityOriginalImage.tsx')
  const helper = read('lib/topic-activity-image-preview.ts')
  assert.match(image, /MAX_PREVIEW_RETRIES = 1/u)
  assert.match(image, /onError=\{\(\) => retry\(\)\}/u)
  assert.match(image, /previewRetry=/u)
  assert.match(image, /attemptToken/u)
  assert.match(image, /图片加载失败/u)
  assert.match(image, /重新加载图片/u)
  assert.match(picker, /TopicActivityAssetImage/u)
  assert.match(participation, /renderAttachments[\s\S]*TopicActivityAssetImage/u)
  assert.match(participation, /renderReplyAttachments[\s\S]*TopicActivityAssetImage/u)
  assert.match(participation, /previewAccessUrl/u)
  assert.match(picker, /thumbnailAccessUrl/u)
  assert.match(original, /new AbortController\(\)/u)
  assert.match(original, /signal: controller\.signal/u)
  assert.match(original, /URL\.revokeObjectURL/u)
  assert.match(helper, /private, no-store, max-age=0/u)
  assert.doesNotMatch(helper, /getSignedCosObjectUrl/u)
})
