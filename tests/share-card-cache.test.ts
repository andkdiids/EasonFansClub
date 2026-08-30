import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { canonicalShareUrl, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { createShareCardContentHash, SHARE_CARD_LOGO_SOURCE, SHARE_CARD_LOGO_VERSION, SHARE_CARD_TEMPLATE_VERSION, shareCardHashPayload } from '@/lib/share-card-hash'
import { calculateShareCardLayout, SHARE_CARD_PORTRAIT_HERO_HEIGHT } from '@/lib/share-card-layout'
import { createShareCardCache, getOrCreatePublicShareCard, loadActivityShareCardData, loadPostShareCardData, ShareCardContentNotFoundError, shareCardObjectKey, shareCardPublicUrl } from '@/lib/share-card-service'
import { isTrustedShareCardImageUrl, renderShareCardPng, renderShareCardPngWithInfo, shareCardRendererConstants } from '@/lib/share-card-renderer'
import { prisma } from '@/lib/prisma'

const baseData: ShareCardData = {
  type: 'post',
  contentId: 'post-cache-fixture',
  title: '缓存测试帖子',
  description: '这是用于验证内容版本缓存的摘要。',
  image: 'https://ecfc.fans/images/og-default.png',
  imageWidth: 1200,
  imageHeight: 630,
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

test('cache responses expose the same deterministic Hero/footer height for bounded long content', async () => {
  const longData = { ...baseData, contentId: 'post-long-layout-fixture', description: '完整长正文'.repeat(300) }
  let stored = false
  const cache = createShareCardCache({
    headObject: async () => stored,
    render: async () => Buffer.from('png-fixture'),
    upload: async () => { stored = true; return 'https://media.ecfc.fans/media/ignored.png' },
  })
  const first = await cache.getOrCreate(longData)
  const second = await cache.getOrCreate(longData)
  assert.equal(first.width, SHARE_CARD_WIDTH)
  assert.equal(first.height, calculateShareCardLayout(longData).height)
  assert.ok(first.height >= SHARE_CARD_HEIGHT)
  assert.equal(second.height, first.height)
  assert.equal(second.url, first.url)
})

test('server PNG dimensions follow the shared Hero overlay and keep author/QR below it', async () => {
  const longData = {
    ...baseData,
    contentId: 'post-render-long-layout-fixture',
    title: '这是一个非常非常长的分享卡片标题测试'.repeat(4),
    description: '第一段\n\n第二段\n\n' + '完整正文内容'.repeat(300),
  }
  const layout = calculateShareCardLayout(longData)
  const png = await renderShareCardPng(longData)
  const metadata = await sharp(png).metadata()
  assert.equal(metadata.width, SHARE_CARD_WIDTH)
  assert.equal(metadata.height, layout.height)
  assert.ok(layout.height >= SHARE_CARD_HEIGHT)
  assert.ok(layout.authorTop >= layout.panelBottom + 36)
  assert.equal(layout.panelTop, layout.overlayTop)
  assert.equal(layout.panelHeight, layout.overlayHeight)
  assert.equal(layout.panelBottom, layout.heroHeight)
  assert.equal(layout.overlayTop + layout.overlayHeight, layout.heroHeight)
  assert.ok(layout.overlayTop >= 0)
  assert.ok(layout.overlayTop + layout.overlayHeight <= layout.heroHeight)
  assert.ok(layout.brandBlockTop > layout.qrTop)
  assert.ok(layout.qrTop >= layout.authorTop + layout.authorBlockHeight)
  assert.equal(layout.brandLogoTop + 42, layout.brandTextTop + 36)
  assert.equal(layout.footerBottom, layout.height)
  assert.ok(layout.titleLines.length <= 3)
  assert.ok(layout.descriptionLines.length <= 3)
  assert.equal(layout.descriptionLines.at(-1)?.endsWith('…'), true)
})

test('server PNG puts a real vertical/long first image into the fixed cover Hero', async () => {
  const heroFixture = await sharp({
    create: { width: 360, height: 1800, channels: 3, background: { r: 226, g: 44, b: 48 } },
  }).png().toBuffer()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(heroFixture, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch
  try {
    const png = await renderShareCardPng({ ...baseData, image: 'https://media.ecfc.fans/media/post/first-long.webp' })
    const pixel = await sharp(png).extract({ left: 540, top: 120, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    assert.ok((pixel[0] || 0) > 150)
    assert.ok((pixel[1] || 0) < 100)
    assert.ok((pixel[2] || 0) < 100)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('server renderer skips a broken first media object and uses the next valid IMAGE candidate', async () => {
  const heroFixture = await sharp({
    create: { width: 360, height: 1800, channels: 3, background: { r: 226, g: 44, b: 48 } },
  }).png().toBuffer()
  const attempts: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = String(input)
    attempts.push(url)
    return url.endsWith('/valid.webp')
      ? new Response(heroFixture, { status: 200, headers: { 'content-type': 'image/webp' } })
      : new Response(null, { status: 404 })
  }) as typeof fetch
  try {
    const png = await renderShareCardPng({
      ...baseData,
      contentId: 'post-image-candidate-fallback',
      image: 'https://media.ecfc.fans/media/post/broken.webp',
      imageCandidates: [{ url: 'https://media.ecfc.fans/media/post/valid.webp', width: 360, height: 1800 }],
    })
    const pixel = await sharp(png).extract({ left: 540, top: 120, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    assert.deepEqual(attempts, [
      'https://media.ecfc.fans/media/post/broken.webp',
      'https://media.ecfc.fans/media/post/valid.webp',
    ])
    assert.ok((pixel[0] || 0) > 150)
    assert.ok((pixel[1] || 0) < 100)
    assert.ok((pixel[2] || 0) < 100)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('activity PNG keeps the existing Hero geometry and overlays one dark detail block', async () => {
  const heroFixture = await sharp({
    create: { width: 900, height: 1600, channels: 3, background: { r: 40, g: 150, b: 190 } },
  }).png().toBuffer()
  const activityData: ShareCardData = {
    type: 'activity',
    contentId: 'activity-overlay-render-fixture',
    title: '陈奕迅 x 林家谦 903 Live 拉阔音乐会（bushi，乱说的）',
    description: '简介：测试测试测试',
    image: 'https://media.ecfc.fans/media/activities/activity-poster.webp',
    imageWidth: null,
    imageHeight: null,
    url: 'https://ecfc.fans/activities/activity-overlay-render-fixture',
    author: 'Andkdids',
    authorAvatar: null,
    date: '2026年8月28日 18:36',
    meta: [
      { label: '活动时间', value: '2026年8月28日 18:35 — 2026年8月28日 22:39' },
      { label: '活动地点', value: '测试' },
      { label: '报名', value: '免费' },
    ],
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(heroFixture, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch
  try {
    const expected = calculateShareCardLayout(activityData, { width: 900, height: 1600 })
    const result = await renderShareCardPngWithInfo(activityData)
    const metadata = await sharp(result.body).metadata()
    assert.equal(metadata.width, SHARE_CARD_WIDTH)
    assert.equal(metadata.height, expected.height)
    assert.equal(expected.heroHeight, SHARE_CARD_PORTRAIT_HERO_HEIGHT)
    assert.equal(expected.panelTop, expected.overlayTop)
    assert.equal(expected.panelHeight, expected.overlayHeight)
    assert.equal(expected.panelBottom, expected.heroHeight)
    assert.ok(expected.activityOverlayTop > 0)
    assert.equal(expected.activityOverlayTop + expected.activityOverlayHeight, expected.heroHeight)
    assert.ok(expected.brandBlockTop > expected.qrTop)

    const topPixel = await sharp(result.body).extract({ left: 540, top: 80, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    const overlayPixel = await sharp(result.body).extract({ left: 540, top: expected.activityOverlayTop + 10, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    const belowHeroPixel = await sharp(result.body).extract({ left: 10, top: expected.heroHeight + 10, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    assert.ok((topPixel[1] || 0) > (overlayPixel[1] || 0) + 40)
    assert.ok((belowHeroPixel[0] || 0) > 235)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('server Hero keeps landscape ratio and converts portrait/long portrait to 3:4', async () => {
  const landscape = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 24, g: 90, b: 140 } },
  }).jpeg().toBuffer()
  const portrait = await sharp({
    create: { width: 900, height: 1600, channels: 3, background: { r: 140, g: 70, b: 24 } },
  }).webp().toBuffer()
  const longPortrait = await sharp({
    create: { width: 1080, height: 4000, channels: 3, background: { r: 70, g: 24, b: 140 } },
  }).png().toBuffer()
  const images = new Map([
    ['https://media.ecfc.fans/media/landscape.jpg', landscape],
    ['https://media.ecfc.fans/media/portrait.webp', portrait],
    ['https://media.ecfc.fans/media/long-portrait.png', longPortrait],
  ])
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const body = images.get(String(input))
    return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch
  try {
    for (const [name, image, dimensions] of [
      ['landscape', 'https://media.ecfc.fans/media/landscape.jpg', { width: 1600, height: 900 }],
      ['portrait', 'https://media.ecfc.fans/media/portrait.webp', { width: 900, height: 1600 }],
      ['long-portrait', 'https://media.ecfc.fans/media/long-portrait.png', { width: 1080, height: 4000 }],
    ] as const) {
      const result = await renderShareCardPngWithInfo({ ...baseData, contentId: `hero-${name}`, image, imageWidth: null, imageHeight: null })
      const metadata = await sharp(result.body).metadata()
      const expected = calculateShareCardLayout({ ...baseData, image, imageWidth: null, imageHeight: null }, dimensions)
      assert.equal(metadata.width, SHARE_CARD_WIDTH)
      assert.equal(metadata.height, expected.height)
      assert.equal(result.height, expected.height)
      if (name !== 'landscape') assert.equal(expected.heroHeight, SHARE_CARD_PORTRAIT_HERO_HEIGHT)
      if (name === 'landscape') assert.equal(expected.heroHeight, 608)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('server renderer keeps CJK, traditional Chinese, Cantonese, emoji, and symbols renderable', async () => {
  const result = await renderShareCardPngWithInfo({
    ...baseData,
    contentId: 'unicode-render-fixture',
    title: '简中：今天打的大朴楼锄了卒；繁中：今日喺度測試分享卡片',
    description: '粤语：唔該晒，你哋好呀\nemoji：😂🥹❤️✨🎵😵‍💫\nsymbols：& < > “ ” · — …',
    image: null,
    imageWidth: null,
    imageHeight: null,
  })
  const metadata = await sharp(result.body).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, SHARE_CARD_WIDTH)
  assert.equal(metadata.height, result.height)
  assert.ok(result.body.length > 1000)
})

test('server renderer uses pinned emoji image assets when they are available', async () => {
  const emojiSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#ffd166"/></svg>')
  const attempts: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = String(input)
    attempts.push(url)
    return new Response(emojiSvg, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
  }) as typeof fetch
  try {
    const result = await renderShareCardPngWithInfo({
      ...baseData,
      contentId: 'emoji-image-render-fixture',
      title: '标题😀🔥👍',
      description: '摘要：今天真的很开心😀',
      author: 'Talk👨‍👩‍👧‍👦',
      image: null,
      imageWidth: null,
      imageHeight: null,
    })
    const metadata = await sharp(result.body).metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.width, SHARE_CARD_WIDTH)
    assert.ok(attempts.some((url) => url.endsWith('/1f600.svg')))
    assert.ok(attempts.some((url) => url.endsWith('/1f525.svg')))
    assert.ok(attempts.some((url) => url.endsWith('/1f44d.svg')))
    assert.ok(attempts.some((url) => url.endsWith('/1f468-200d-1f469-200d-1f467-200d-1f466.svg')))
  } finally {
    globalThis.fetch = originalFetch
  }
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
    assert.equal(metadata.height, calculateShareCardLayout({ ...baseData, image: 'https://media.ecfc.fans/media/not-found.webp', authorAvatar: 'https://media.ecfc.fans/media/not-found-avatar.webp' }).height)
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
