import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { topicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'
const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const original = loader._load
let authenticated = false, admin = false, caller = 'owner', writes = 0, downloads = 0
let taskSubmissionRows: unknown[] = []
let config: typeof import('../app/api/admin/activities/[activityId]/v2/route')
let task: typeof import('../app/api/activities/[activityId]/v2/tasks/route')
let asset: typeof import('../app/api/activities/[activityId]/v2/submissions/[submissionId]/assets/[assetId]/original/route')
const denied = (status: number) => ({ user: null, response: new Response('{}', { status }) })
before(async () => {
  loader._load = function (request, parent, main) {
    if (request === '@/lib/security') return {
      requireRequestUser: async () => authenticated ? { user: { id: caller } } : denied(401),
      requireRequestAdmin: async () => !authenticated ? denied(401) : admin ? { user: { id: caller } } : denied(403),
      rejectInvalidRequestOrigin: (req: Request) => req.headers.get('origin') === 'https://hostile.invalid' ? new Response('{}', { status: 403 }) : null,
      enforceApiRateLimit: async () => null,
    }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => admin }
    if (request === '@/lib/content-moderation') return { checkBannedWords: async () => ({ blocked: false }) }
    if (request === '@/lib/topic-activity-v2') return {
      getTopicActivityV2View: async () => ({ program: {}, myProgress: null }), getTopicActivityV2Statistics: async () => ({}),
      saveTopicActivityV2Program: async () => { writes++; return {} },
      submitTopicActivityV2Task: async () => { writes++; return { postAuthorId: caller } },
    }
    if (request === '@/lib/topic-activity-assets') return {
      serializeTopicActivityAsset: (asset: { id: string; storageKey: string; mimeType: string; width: number; height: number; size: number }) => ({
        assetId: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, size: asset.size,
        url: 'https://cos.invalid/signed-preview', thumbnailUrl: 'https://cos.invalid/signed-thumbnail',
      }),
    }
    if (request === '@/lib/prisma') return { prisma: {
      topicActivitySubmission: { findMany: async () => taskSubmissionRows, findFirst: async ({ where }: { where: { activityId: string; id: string } }) => where.activityId === 'activity-one' && where.id === 'submission-one' ? { userId: 'owner' } : null },
      topicActivityImageAsset: { findFirst: async ({ where }: { where: { id: string; taskSubmissionId: string } }) => where.id === 'asset-one' && where.taskSubmissionId === 'submission-one' ? { storageKey: topicActivityOriginalObjectKey({ activityId: 'activity-one', purpose: 'FORM_ANSWER', uploadId: 'asset-one', filename: 'picture.png', format: 'png' }), mimeType: 'image/png', size: 10 } : null },
    } }
    if (request === '@/lib/topic-activity-image-download') return { downloadTopicActivityOriginal: async () => { downloads++; return new Response('original bytes', { headers: { 'cache-control': 'private, no-store' } }) } }
    return original.call(this, request, parent, main)
  }
  try {
    config = await import('../app/api/admin/activities/[activityId]/v2/route')
    task = await import('../app/api/activities/[activityId]/v2/tasks/route')
    asset = await import('../app/api/activities/[activityId]/v2/submissions/[submissionId]/assets/[assetId]/original/route')
  } finally { loader._load = original }
})
beforeEach(() => { authenticated = false; admin = false; caller = 'owner'; writes = 0; downloads = 0; taskSubmissionRows = [] })
const context = { params: Promise.resolve({ activityId: 'activity-one' }) }
test('new configuration API requires administrator for both reading and writing', async () => {
  assert.equal((await config.GET(new Request('http://localhost/api'), context)).status, 401)
  authenticated = true; assert.equal((await config.GET(new Request('http://localhost/api'), context)).status, 403)
  assert.equal((await config.PATCH(new Request('http://localhost/api', { method: 'PATCH', body: '{}' }), context)).status, 403)
  admin = true; assert.equal((await config.GET(new Request('http://localhost/api'), context)).status, 200); assert.equal(writes, 0)
})
test('task route cannot mutate anonymously, with hostile origin, or malformed entry', async () => {
  const request = () => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ rewardEntryId: 'entry-one', assetIds: [] }) })
  assert.equal((await task.POST(request(), context)).status, 401)
  authenticated = true
  assert.equal((await task.POST(new Request('http://localhost/api', { method: 'POST', headers: { origin: 'https://hostile.invalid' }, body: '{}' }), context)).status, 403)
  assert.equal((await task.POST(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ rewardEntryId: '../bad', assetIds: [] }) }), context)).status, 400)
  assert.equal(writes, 0); assert.equal((await task.POST(request(), context)).status, 201); assert.equal(writes, 1)
})

test('task GET returns owner-scoped signed asset fields and the V2 original route', async () => {
  authenticated = true
  taskSubmissionRows = [{ id: 'submission-one', userId: 'owner', commentId: 'comment-one', rewardEntryId: 'entry-one', rewardSnapshot: null, status: 'PENDING', submittedAt: new Date('2026-10-22T00:00:00Z'), reviewedAt: null, rejectReason: null, User: { nickname: 'owner', uid: 'uid-owner' }, TaskImageAssets: [{ id: 'asset-one', storageKey: 'topic-v2-asset', mimeType: 'image/png', width: 100, height: 100, size: 10 }] }]
  const response = await task.GET(new Request('http://localhost/api/activities/activity-one/v2/tasks'), context)
  assert.equal(response.status, 200)
  const body = await response.json() as { submissions: Array<{ assets: Array<Record<string, unknown>> }> }
  assert.equal(body.submissions.length, 1)
  assert.deepEqual(body.submissions[0].assets[0], {
    assetId: 'asset-one', storageKey: 'topic-v2-asset', mimeType: 'image/png', width: 100, height: 100, size: 10,
    url: 'https://cos.invalid/signed-preview', thumbnailUrl: 'https://cos.invalid/signed-thumbnail',
    originalDownloadUrl: '/api/activities/activity-one/v2/submissions/submission-one/assets/asset-one/original',
  })
})
test('task original download enforces activity, submission, asset and owner/admin scopes', async () => {
  const request = new Request('http://localhost/api')
  const params = { activityId: 'activity-one', submissionId: 'submission-one', assetId: 'asset-one' }
  const invoke = (values = params) => asset.GET(request, { params: Promise.resolve(values) })
  assert.equal((await invoke()).status, 401); authenticated = true; caller = 'other'
  assert.equal((await invoke()).status, 404); assert.equal(downloads, 0)
  caller = 'owner'; assert.equal((await invoke({ ...params, activityId: 'foreign' })).status, 404)
  assert.equal((await invoke({ ...params, assetId: 'foreign' })).status, 404)
  assert.equal((await invoke()).status, 200); caller = 'other'; admin = true; assert.equal((await invoke()).status, 200)
  assert.equal(downloads, 2)
})
