import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { canonicalShareUrl, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { createShareCardContentHash, SHARE_CARD_LOGO_SOURCE, SHARE_CARD_LOGO_VERSION, SHARE_CARD_TEMPLATE_VERSION, shareCardHashPayload } from '@/lib/share-card-hash'
import { createShareCardCache, getOrCreatePublicShareCard, loadActivityShareCardData, loadPostShareCardData, ShareCardContentNotFoundError, shareCardObjectKey, shareCardPublicUrl } from '@/lib/share-card-service'
import { isTrustedShareCardImageUrl, renderShareCardPng, shareCardRendererConstants } from '@/lib/share-card-renderer'
import { prisma } from '@/lib/prisma'

const baseData: ShareCardData = {
  type: 'post',
  contentId: 'post-cache-fixture',
  title: '缓存测试帖子',
  description: '这是用于验证内容版本缓存的摘要。',
  image: 'https://ecfc.fans/images/og-default.png',
  url: 'https://ecfc.fans/posts/post-cache-fixture',
  author: 'E友',
  authorAvatar: null,
  date: '2026年8月30日',
  meta: [{ label: '版块', value: 'E院广场' }],
}

test('share-card hash includes template/logo and only visual fields', () => {
  const payload = shareCardHashPayload(baseData)
  assert.equal(payload.templateVersion, SHARE_CARD_TEMPLATE_VERSION)
  assert.deepEqual(payload.logo, { source: SHARE_CARD_LOGO_SOURCE, version: SHARE_CARD_LOGO_VERSION })
  const same = createShareCardContentHash({ ...baseData, ...( { likeCount: 99, commentCount: 100 } as unknown as ShareCardData) })
  assert.equal(same, createShareCardContentHash(baseData))
  assert.notEqual(createShareCardContentHash({ ...baseData, title: '缓存测试帖子（已编辑）' }), createShareCardContentHash(baseData))
  assert.notEqual(createShareCardContentHash({ ...baseData, image: 'https://media.ecfc.fans/media/posts/changed.webp' }), createShareCardContentHash(baseData))
  assert.notEqual(createShareCardContentHash({ ...baseData, date: '2026年8月31日' }), createShareCardContentHash(baseData))
})

test('share-card object keys and URLs are deterministic and version-addressed', () => {
  const hash = createShareCardContentHash(baseData)
  assert.match(shareCardObjectKey('post', 'post-cache-fixture', hash), new RegExp(`^share-cards/posts/post-cache-fixture/${hash}\\.png$`))
  assert.match(shareCardPublicUrl(shareCardObjectKey('post', 'post-cache-fixture', hash)), /^https:\/\/media\.ecfc\.fans\/media\/share-cards\/posts\/post-cache-fixture\//)
  assert.equal(canonicalShareUrl(baseData.url), 'https://ecfc.fans/posts/post-cache-fixture')
})

test('cache miss renders/uploads once and the next request is a COS hit', async () => {
  let stored = false
  let headCalls = 0
  let renderCalls = 0
  let uploadCalls = 0
  const cache = createShareCardCache({
    headObject: async () => { headCalls += 1; return stored },
    render: async () => { renderCalls += 1; return Buffer.from('png-fixture') },
    upload: async () => { uploadCalls += 1; stored = true; return 'https://media.ecfc.fans/media/ignored.png' },
  })
  const first = await cache.getOrCreate(baseData)
  const second = await cache.getOrCreate(baseData)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(first.url, second.url)
  assert.equal(headCalls, 2)
  assert.equal(renderCalls, 1)
  assert.equal(uploadCalls, 1)
})

test('activity cache uses the activity namespace and reuses the same URL', async () => {
  const activityData: ShareCardData = {
    ...baseData,
    type: 'activity',
    contentId: 'activity-cache-fixture',
    title: '缓存测试活动',
    url: 'https://ecfc.fans/activities/activity-cache-fixture',
  }
  let renderCalls = 0
  let uploadCalls = 0
  let stored = false
  const cache = createShareCardCache({
    headObject: async () => stored,
    render: async () => { renderCalls += 1; return Buffer.from('png-fixture') },
    upload: async () => { uploadCalls += 1; stored = true; return 'https://media.ecfc.fans/media/ignored.png' },
  })
  const first = await cache.getOrCreate(activityData)
  const second = await cache.getOrCreate(activityData)
  assert.match(first.url, /\/share-cards\/activities\/activity-cache-fixture\//)
  assert.equal(first.url, second.url)
  assert.equal(renderCalls, 1)
  assert.equal(uploadCalls, 1)
})

test('twenty concurrent requests use one renderer and one upload', async () => {
  let headCalls = 0
  let renderCalls = 0
  let uploadCalls = 0
  const cache = createShareCardCache({
    headObject: async () => { headCalls += 1; return false },
    render: async () => {
      renderCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return Buffer.from('png-fixture')
    },
    upload: async () => { uploadCalls += 1; return 'https://media.ecfc.fans/media/ignored.png' },
  })
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrCreate({ ...baseData, contentId: 'post-concurrent-fixture' })))
  assert.equal(headCalls, 1)
  assert.equal(renderCalls, 1)
  assert.equal(uploadCalls, 1)
  assert.equal(new Set(results.map((result) => result.url)).size, 1)
  assert.equal(new Set(results.map((result) => result.hash)).size, 1)
})

test('post/activity records flow through the public service into one card payload', async () => {
  const originalPostFindFirst = prisma.post.findFirst
  const originalActivityFindFirst = prisma.activity.findFirst
  prisma.post.findFirst = (async () => ({
    id: 'post-service-fixture',
    title: '服务层帖子标题',
    content: '<p>服务层正文</p>',
    richContent: null,
    moderationStatus: 'APPROVED',
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    PostMedia: [
      { url: 'https://media.ecfc.fans/media/post/video.mp4' },
      { url: 'https://media.ecfc.fans/media/post/first.webp' },
    ],
    User: { nickname: '发帖人', nicknameModerationStatus: 'NORMAL', nicknameViolationDisplay: null, status: 'ACTIVE', isDeleted: false, avatarUrl: null, Profile: { avatarUrl: null } },
    Board: { name: 'E院广场' },
  })) as unknown as typeof prisma.post.findFirst
  prisma.activity.findFirst = (async () => ({
    id: 'activity-service-fixture',
    title: '服务层活动标题',
    description: '<p>服务层活动简介</p>',
    startsAt: new Date('2026-08-30T03:00:00.000Z'),
    endsAt: new Date('2026-08-30T05:00:00.000Z'),
    locationName: '上海',
    locationAddress: '静安区',
    bannerUrl: '%%%invalid-banner',
    coverUrl: '/images/og-default.png',
    organizer: 'E院活动组',
    publishedAt: new Date('2026-08-29T00:00:00.000Z'),
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    status: 'PUBLISHED',
    CreatedBy: null,
  })) as unknown as typeof prisma.activity.findFirst
  try {
    const post = await loadPostShareCardData('post-service-fixture')
    const activity = await loadActivityShareCardData('activity-service-fixture')
    assert.equal(post?.contentId, 'post-service-fixture')
    assert.equal(post?.title, '服务层帖子标题')
    assert.equal(post?.image, 'https://media.ecfc.fans/media/post/first.webp')
    assert.equal(activity?.contentId, 'activity-service-fixture')
    assert.equal(activity?.title, '服务层活动标题')
    assert.equal(activity?.image, 'https://ecfc.fans/images/og-default.png')
    assert.match(activity?.description || '', /活动简介/)
    assert.match(JSON.stringify({ post, activity }), /服务层帖子标题|服务层活动标题/)
  } finally {
    prisma.post.findFirst = originalPostFindFirst
    prisma.activity.findFirst = originalActivityFindFirst
  }
})

test('private or missing content stops at the API before cache lookup and reveals no fields', async () => {
  const originalPostFindFirst = prisma.post.findFirst
  prisma.post.findFirst = (async () => null) as unknown as typeof prisma.post.findFirst
  try {
    const data = await loadPostShareCardData('private-service-fixture')
    assert.equal(data, null)
    await assert.rejects(() => getOrCreatePublicShareCard('post', 'private-service-fixture'), ShareCardContentNotFoundError)
    const { GET } = await import('../app/api/posts/[postId]/share-card/route')
    const response = await GET(new Request('https://ecfc.fans/api/posts/private-service-fixture/share-card'), { params: Promise.resolve({ postId: 'private-service-fixture' }) })
    assert.equal(response.status, 404)
    const body = await response.text()
    assert.doesNotMatch(body, /private|绝密|token|session/i)
  } finally {
    prisma.post.findFirst = originalPostFindFirst
  }
})

test('server renderer emits the official-logo portrait PNG and survives missing remote media', async () => {
  const source = readFileSync('lib/share-card-renderer.ts', 'utf8')
  assert.equal(shareCardRendererConstants.logoPath, 'app/icon.png')
  assert.match(source, /OFFICIAL_LOGO_PATH = path\.join\(process\.cwd\(\), 'app', 'icon\.png'\)/)
  assert.doesNotMatch(source, /fillText\('私家E院'/)
  assert.doesNotMatch(source, /fillText\(shareCardTypeLabel\(normalizedData\.type\), 66, 130\)/)
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch
  try {
    const png = await renderShareCardPng({ ...baseData, image: 'https://media.ecfc.fans/media/not-found.webp', authorAvatar: 'https://media.ecfc.fans/media/not-found-avatar.webp' })
    const metadata = await sharp(png).metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.width, SHARE_CARD_WIDTH)
    assert.equal(metadata.height, SHARE_CARD_HEIGHT)
    assert.ok(png.length > 1000)
    assert.equal(SHARE_CARD_MIME_TYPE, 'image/png')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('server image safety accepts project media and rejects private/video targets', () => {
  assert.equal(isTrustedShareCardImageUrl('/images/og-default.png'), true)
  assert.equal(isTrustedShareCardImageUrl('https://media.ecfc.fans/media/post.webp'), true)
  assert.equal(isTrustedShareCardImageUrl('https://media.ecfc.fans/media/post.mp4'), false)
  assert.equal(isTrustedShareCardImageUrl('https://127.0.0.1/private.png'), false)
  assert.equal(isTrustedShareCardImageUrl('https://evil.example/post.png'), false)
})
