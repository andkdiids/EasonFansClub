import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { NextRequest } from 'next/server'
import {
  absoluteMetadataImageUrl,
  buildActivityMetadata,
  buildPageMetadata,
  buildPostMetadata,
  DEFAULT_OG_IMAGE_DIMENSIONS,
  firstAbsoluteMetadataImageUrl,
  htmlToPlainText,
  postContentPlainText,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  DEFAULT_OG_IMAGE_PATH,
} from '@/lib/share-metadata'
import { shareContent, shareFallbackText } from '@/lib/share'
import { isPublicMetadataCrawlerUserAgent } from '@/lib/public-metadata-crawler'

function metadataOpenGraph(metadata: ReturnType<typeof buildPageMetadata>) {
  assert.ok(metadata.openGraph && typeof metadata.openGraph === 'object')
  return metadata.openGraph as { title?: string; description?: string; url?: string; siteName?: string; images?: Array<{ url?: string }> }
}

function metadataHtml(metadata: ReturnType<typeof buildPageMetadata>) {
  const openGraph = metadataOpenGraph(metadata)
  const twitter = metadata.twitter && typeof metadata.twitter === 'object' ? metadata.twitter as { card?: string; title?: string; description?: string; images?: string[] } : {}
  const canonical = metadata.alternates && typeof metadata.alternates === 'object' ? String(metadata.alternates.canonical || '') : ''
  return [
    `<title>${metadata.title}</title>`,
    `<meta name="description" content="${metadata.description}"/>`,
    `<link rel="canonical" href="${canonical}"/>`,
    `<meta property="og:title" content="${openGraph.title}"/>`,
    `<meta property="og:description" content="${openGraph.description}"/>`,
    `<meta property="og:url" content="${openGraph.url}"/>`,
    `<meta property="og:site_name" content="${openGraph.siteName}"/>`,
    `<meta property="og:image" content="${openGraph.images?.[0]?.url}"/>`,
    `<meta name="twitter:card" content="${twitter.card}"/>`,
  ].join('\n')
}

function replaceNavigator(value: unknown) {
  const hadNavigator = Object.prototype.hasOwnProperty.call(globalThis, 'navigator')
  const previous = globalThis.navigator
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value })
  return () => {
    if (hadNavigator) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous })
    else delete (globalThis as { navigator?: Navigator }).navigator
  }
}

test('homepage metadata uses the official title, description and an absolute fallback image', () => {
  const metadata = buildPageMetadata({ title: SITE_TITLE, description: SITE_DESCRIPTION, canonical: '/' })
  const openGraph = metadataOpenGraph(metadata)
  assert.equal(metadata.title, SITE_TITLE)
  assert.equal(metadata.description, SITE_DESCRIPTION)
  assert.equal(openGraph.title, SITE_TITLE)
  assert.equal(openGraph.description, SITE_DESCRIPTION)
  assert.equal(openGraph.siteName, '私家E院 | Eason Fans Club')
  assert.equal(SITE_NAME, '私家E院 | Eason Fans Club')
  assert.equal(openGraph.url, 'https://ecfc.fans/')
  assert.equal(openGraph.images?.[0]?.url, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
  assert.equal(DEFAULT_OG_IMAGE_PATH, '/images/og-default.png')
  assert.deepEqual(DEFAULT_OG_IMAGE_DIMENSIONS, { width: 1200, height: 630 })
  assert.equal(metadata.twitter && typeof metadata.twitter === 'object' ? (metadata.twitter as { card?: string }).card : undefined, 'summary_large_image')
})

test('default OG image is a real opaque 1200x630 PNG', () => {
  const asset = readFileSync('public/images/og-default.png')
  assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(asset.toString('ascii', 12, 16), 'IHDR')
  assert.equal(asset.readUInt32BE(16), 1200)
  assert.equal(asset.readUInt32BE(20), 630)
  assert.equal(asset[24], 8)
  assert.equal(asset[25], 2, 'truecolor PNG has no alpha channel')
})

test('post metadata uses the first public image and falls back when there is no image', () => {
  const withImage = buildPostMetadata({
    postId: 'post-with-image',
    title: '一张图的帖子',
    content: '<p>正文摘要</p>',
    imageUrl: 'https://media.ecfc.fans/media/content/post-1/large.webp',
  })
  const withoutImage = buildPostMetadata({
    postId: 'post-without-image',
    title: '没有图片的帖子',
    content: '正文摘要',
  })
  assert.equal(metadataOpenGraph(withImage).images?.[0]?.url, 'https://media.ecfc.fans/media/content/post-1/large.webp')
  assert.equal(metadataOpenGraph(withoutImage).images?.[0]?.url, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
  assert.equal(withImage.description, '正文摘要')
})

test('rich post metadata and summaries never expose JSON or HTML markup', () => {
  const richContent = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: '这是 ' },
        { type: 'text', text: '测试', marks: [{ type: 'bold' }] },
      ],
    }],
  }
  const metadata = buildPostMetadata({
    postId: 'rich-post',
    title: '富文本帖子',
    content: '这是 测试',
    richContent,
  })
  assert.equal(postContentPlainText('<p>旧摘要</p>', richContent), '这是 测试')
  assert.equal(metadata.description, '这是 测试')
  assert.doesNotMatch(String(metadata.description), /<[^>]+>|"type"|"marks"/u)
})

test('metadata image selection skips video, malformed and non-public URLs', () => {
  const video = buildPostMetadata({ postId: 'video', title: '视频媒体', content: '正文', imageUrl: 'https://media.ecfc.fans/media/posts/video.mp4' })
  const malformed = buildPostMetadata({ postId: 'malformed', title: '坏图片', content: '正文', imageUrl: '%%%not-a-url' })
  const nonPublic = buildPostMetadata({ postId: 'non-public', title: '非公开图片', content: '正文', imageUrl: 'https://private.example/image.png' })
  assert.equal(metadataOpenGraph(video).images?.[0]?.url, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
  assert.equal(metadataOpenGraph(malformed).images?.[0]?.url, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
  assert.equal(metadataOpenGraph(nonPublic).images?.[0]?.url, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
})

test('activity metadata falls back from an invalid banner to a valid cover', () => {
  const selectedCover = firstAbsoluteMetadataImageUrl(['%%%invalid-banner', '/images/cassette/cassette-transparent.png'])
  const selectedDefault = firstAbsoluteMetadataImageUrl(['%%%invalid-banner', 'https://media.ecfc.fans/media/activity/poster.mp4'])
  assert.equal(selectedCover, 'https://ecfc.fans/images/cassette/cassette-transparent.png')
  assert.equal(selectedDefault, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
})

test('mocked Post and Activity records flow through generateMetadata into crawler HTML fields', async () => {
  const { prisma } = await import('../lib/prisma')
  const originalPostFindFirst = prisma.post.findFirst
  const originalActivityFindFirst = prisma.activity.findFirst
  prisma.post.findFirst = (async () => ({
    title: '链路帖子标题',
    content: '<p>链路帖子正文</p>',
    moderationStatus: 'APPROVED',
    PostMedia: [
      { url: 'https://media.ecfc.fans/media/posts/video.mp4' },
      { url: '/images/cassette/cassette-transparent.png' },
    ],
    User: { status: 'ACTIVE', isDeleted: false, Profile: { id: 'profile-fixture' } },
  })) as unknown as typeof prisma.post.findFirst
  prisma.activity.findFirst = (async () => ({
    title: '链路活动标题',
    description: '<p>链路活动简介</p>',
    startsAt: new Date('2026-08-30T03:00:00.000Z'),
    endsAt: new Date('2026-08-30T05:00:00.000Z'),
    locationName: '上海',
    locationAddress: '静安区',
    bannerUrl: '%%%invalid-banner',
    coverUrl: '/images/cassette/cassette-transparent.png',
  })) as unknown as typeof prisma.activity.findFirst

  try {
    const postPage = await import('../app/posts/[postId]/page')
    const activityPage = await import('../app/activities/[activityId]/page')
    const postMetadata = await postPage.generateMetadata({ params: Promise.resolve({ postId: 'post-chain-fixture' }) })
    const activityMetadata = await activityPage.generateMetadata({ params: Promise.resolve({ activityId: 'activity-chain-fixture' }) })
    const postHtml = metadataHtml(postMetadata as ReturnType<typeof buildPageMetadata>)
    const activityHtml = metadataHtml(activityMetadata as ReturnType<typeof buildPageMetadata>)

    for (const html of [postHtml, activityHtml]) {
      assert.match(html, /<title>/)
      assert.match(html, /name="description"/)
      assert.match(html, /rel="canonical"/)
      assert.match(html, /property="og:title"/)
      assert.match(html, /property="og:description"/)
      assert.match(html, /property="og:url"/)
      assert.match(html, /property="og:image"/)
      assert.match(html, /property="og:site_name"/)
      assert.match(html, /name="twitter:card"/)
    }
    assert.match(postHtml, /<title>链路帖子标题<\/title>/)
    assert.match(postHtml, /content="链路帖子正文"/)
    assert.match(postHtml, /content="https:\/\/ecfc\.fans\/posts\/post-chain-fixture"/)
    assert.match(postHtml, /content="https:\/\/ecfc\.fans\/images\/cassette\/cassette-transparent\.png"/)
    assert.match(activityHtml, /<title>链路活动标题<\/title>/)
    assert.match(activityHtml, /content="时间：2026年8月30日 11:00 — 2026年8月30日 13:00；地点：上海，静安区；简介：链路活动简介"/)
    assert.match(activityHtml, /content="https:\/\/ecfc\.fans\/activities\/activity-chain-fixture"/)
    assert.match(activityHtml, /content="https:\/\/ecfc\.fans\/images\/cassette\/cassette-transparent\.png"/)
  } finally {
    prisma.post.findFirst = originalPostFindFirst
    prisma.activity.findFirst = originalActivityFindFirst
  }
})

test('activity metadata combines time, location and introduction and falls back when there is no image', () => {
  const withImage = buildActivityMetadata({
    activityId: 'activity-with-image',
    title: 'E友见面会',
    description: '<p>一起聊聊最近循环的歌。</p>',
    startsAt: '2026-08-30T03:00:00.000Z',
    endsAt: '2026-08-30T05:00:00.000Z',
    locationName: '上海',
    locationAddress: '静安区',
    imageUrl: 'https://media.ecfc.fans/media/activities/activity-1/large.webp',
  })
  const withoutImage = buildActivityMetadata({
    activityId: 'activity-without-image',
    title: '线上活动',
    description: '线上一起听歌。',
  })
  assert.match(withImage.description || '', /时间：2026年8月30日/)
  assert.match(withImage.description || '', /地点：上海，静安区/)
  assert.match(withImage.description || '', /简介：一起聊聊最近循环的歌。/)
  assert.equal(metadataOpenGraph(withImage).images?.[0]?.url, 'https://media.ecfc.fans/media/activities/activity-1/large.webp')
  assert.equal(metadataOpenGraph(withoutImage).images?.[0]?.url, `https://ecfc.fans${DEFAULT_OG_IMAGE_PATH}`)
})

test('relative image URLs become HTTPS absolute URLs and HTML becomes plain text', () => {
  assert.equal(absoluteMetadataImageUrl('/images/share-card.png'), 'https://ecfc.fans/images/share-card.png')
  assert.equal(absoluteMetadataImageUrl('/cos/content/post-1/source.webp'), 'https://media.ecfc.fans/media/content/post-1/source.webp')
  const plain = htmlToPlainText('<p>Hello&nbsp;<strong>世界</strong></p><p>第二段<script>不要泄露</script></p>[[content-image:/cos/private.png]]')
  assert.equal(plain, 'Hello 世界 第二段')
  assert.doesNotMatch(plain, /不要泄露|content-image/)
})

test('share fallback is exactly title followed by URL, while native share receives text too', async () => {
  assert.equal(shareFallbackText({ title: '标题', url: 'https://ecfc.fans/posts/1' }), '标题\nhttps://ecfc.fans/posts/1')

  const nativeCalls: ShareData[] = []
  const restoreNative = replaceNavigator({
    share: async (data: ShareData) => { nativeCalls.push(data) },
  })
  try {
    assert.equal(await shareContent({ title: '标题', text: '摘要', url: 'https://ecfc.fans/posts/1' }), 'shared')
  } finally {
    restoreNative()
  }
  assert.deepEqual(nativeCalls, [{ title: '标题', text: '摘要', url: 'https://ecfc.fans/posts/1' }])

  const copied: string[] = []
  const restoreClipboard = replaceNavigator({ clipboard: { writeText: async (value: string) => { copied.push(value) } } })
  try {
    assert.equal(await shareContent({ title: '标题', text: '摘要', url: 'https://ecfc.fans/posts/1' }), 'copied')
  } finally {
    restoreClipboard()
  }
  assert.deepEqual(copied, ['标题\nhttps://ecfc.fans/posts/1'])
})

test('private post and activity metadata never includes private fields', () => {
  const privatePost = buildPostMetadata({
    postId: 'private-post',
    title: '绝密帖子标题',
    content: '绝密正文',
    imageUrl: 'https://private.example/secret.png',
    isPublic: false,
  })
  const privateActivity = buildActivityMetadata({
    activityId: 'private-activity',
    title: '绝密活动标题',
    description: '绝密活动简介',
    imageUrl: 'https://private.example/activity.png',
    isPublic: false,
  })
  const postJson = JSON.stringify(privatePost)
  const activityJson = JSON.stringify(privateActivity)
  assert.doesNotMatch(postJson, /绝密帖子标题|绝密正文|private\.example/)
  assert.doesNotMatch(activityJson, /绝密活动标题|绝密活动简介|private\.example/)
  assert.equal((privatePost.robots && typeof privatePost.robots === 'object' ? privatePost.robots.index : undefined), false)
  assert.equal((privateActivity.robots && typeof privateActivity.robots === 'object' ? privateActivity.robots.index : undefined), false)
})

test('dynamic routes use server metadata and public detail paths bypass the login redirect', async () => {
  const postPage = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  const activityPage = readFileSync('app/activities/[activityId]/page.tsx', 'utf8')
  const layout = readFileSync('app/layout.tsx', 'utf8')
  const middleware = readFileSync('middleware.ts', 'utf8')
  assert.match(postPage, /export async function generateMetadata/)
  assert.match(activityPage, /export async function generateMetadata/)
  assert.match(layout, /buildPageMetadata/)
  assert.match(postPage, /PostMedia\.map\(\(\{ url \}\) => metadataImageVariantUrl\(url\)\)/)
  assert.match(activityPage, /metadataImageVariantUrl\(activity\.bannerUrl\)/)
  assert.match(middleware, /Public detail pages must be reachable/)

  // Exercise the real middleware decision used by an anonymous crawler.
  const [postResponse, activityResponse] = await Promise.all([
    import('../middleware').then(({ middleware: handler }) => handler(new NextRequest('https://ecfc.fans/posts/post-1'))),
    import('../middleware').then(({ middleware: handler }) => handler(new NextRequest('https://ecfc.fans/activities/activity-1'))),
  ])
  assert.equal(postResponse.status, 200)
  assert.equal(activityResponse.status, 200)
  assert.equal(postResponse.headers.get('location'), null)
  assert.equal(activityResponse.headers.get('location'), null)
})

test('homepage metadata crawler allow-list bypasses only the root page', async () => {
  const crawlerUserAgents = [
    'Mozilla/5.0 MicroMessenger/8.0.1',
    'facebookexternalhit/1.1',
    'Facebot',
    'Twitterbot/1.0',
    'LinkedInBot/1.0',
    'Slackbot-LinkExpanding 1.0',
    'Discordbot/2.0',
    'TelegramBot (like TwitterBot)',
    'WhatsApp/2.23.20',
    'Googlebot/2.1',
    'bingbot/2.0',
  ]
  for (const userAgent of crawlerUserAgents) assert.equal(isPublicMetadataCrawlerUserAgent(userAgent), true, userAgent)
  assert.equal(isPublicMetadataCrawlerUserAgent('Mozilla/5.0 (compatible; ExampleBot/1.0)'), false)
  assert.equal(isPublicMetadataCrawlerUserAgent('Mozilla/5.0'), false)

  const { middleware } = await import('../middleware')
  const crawlerHeaders = { 'user-agent': 'Twitterbot/1.0' }
  const crawlerRootResponse = await middleware(new NextRequest('https://ecfc.fans/', { headers: crawlerHeaders }))
  assert.equal(crawlerRootResponse.status, 200)
  assert.equal(crawlerRootResponse.headers.get('location'), null)

  const browserRootResponse = await middleware(new NextRequest('https://ecfc.fans/', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/140.0' } }))
  assert.ok(browserRootResponse.status === 307 || browserRootResponse.status === 308)
  assert.equal(new URL(browserRootResponse.headers.get('location') || 'https://ecfc.fans/').pathname, '/login')

  for (const path of ['/profile', '/admin', '/messages', '/friends', '/private']) {
    const response = await middleware(new NextRequest(`https://ecfc.fans${path}`, { headers: crawlerHeaders }))
    assert.ok(response.status === 307 || response.status === 308, path)
    assert.equal(new URL(response.headers.get('location') || 'https://ecfc.fans/').pathname, '/login', path)
  }

  const rootPage = readFileSync('app/page.tsx', 'utf8')
  const layout = readFileSync('app/layout.tsx', 'utf8')
  assert.match(rootPage, /isPublicMetadataCrawlerUserAgent/)
  assert.match(rootPage, /陈奕迅中文粉丝社区/)
  assert.match(layout, /canonical: '\/'/)
  const { generateMetadata } = await import('../app/page')
  const metadata = generateMetadata()
  const html = metadataHtml(metadata)
  assert.match(html, /<title>私家E院 \| Eason Fans Club<\/title>/)
  assert.match(html, /content="https:\/\/ecfc\.fans\/images\/og-default\.png"/)
  assert.match(html, /content="https:\/\/ecfc\.fans\/"/)
  assert.match(html, /content="summary_large_image"/)
})
