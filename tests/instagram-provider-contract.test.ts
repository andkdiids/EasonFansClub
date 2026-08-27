import assert from 'node:assert/strict'
import test from 'node:test'
import { ApifyInstagramProvider, normalizeApifyInstagramItem } from '@/lib/instagram/apify-provider'
import { createInstagramProvider, resolveInstagramProviderName } from '@/lib/instagram/factory'
import { MOCK_INSTAGRAM_POSTS } from '@/lib/instagram/fixtures'
import { normalizeInstagramPost, dedupeAndSortInstagramPosts } from '@/lib/instagram/normalize'
import { InstagramProviderError } from '@/lib/instagram/types'

if (!process.env.APIFY_API_TOKEN) process.env.APIFY_API_TOKEN = 'unit-test-token'

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rawImage(id: string, timestamp: string, options: Record<string, unknown> = {}) {
  return {
    id,
    type: 'Image',
    shortCode: `short-${id}`,
    caption: `caption-${id}`,
    timestamp,
    url: `https://www.instagram.com/p/short-${id}/`,
    displayUrl: `https://scontent.example.test/${id}.jpg`,
    dimensionsWidth: 1080,
    dimensionsHeight: 1350,
    ownerUsername: 'mreasonchan',
    childPosts: [],
    ...options,
  }
}

function successfulProvider(rows: unknown[], options: { usageTotalUsd?: number | null } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/actors/apify~instagram-scraper/runs')) {
      return jsonResponse({
        data: {
          id: 'run-test-1',
          status: 'SUCCEEDED',
          defaultDatasetId: 'dataset-test-1',
          usageTotalUsd: options.usageTotalUsd ?? 0.01,
        },
      })
    }
    if (url.includes('/datasets/dataset-test-1/items')) return jsonResponse(rows)
    throw new Error(`unexpected test URL: ${url}`)
  }
  return {
    calls,
    provider: new ApifyInstagramProvider({ fetchImpl, costSettleDelayMs: 0 }),
  }
}

test('Mock Provider returns normalized latest posts with carousel children', async () => {
  const provider = createInstagramProvider({ provider: 'mock', proxyUrl: 'http://127.0.0.1:7890' })
  const posts = await provider.getLatestPosts('mreasonchan', 3)
  assert.equal(posts.length, 3)
  assert.deepEqual(posts.map((post) => post.externalId), [
    'mock-20260825-carousel',
    'mock-20260824-reel',
    'mock-20260823-image',
  ])
  assert.equal(posts[0]?.media.length, 3)
  assert.equal(posts[0]?.media[2]?.type, 'VIDEO')
  assert.equal(provider.proxyUrl, 'http://127.0.0.1:7890')
})

test('dedupe and publishedAt sorting handles pinned/out-of-order provider results', () => {
  const posts = dedupeAndSortInstagramPosts([
    MOCK_INSTAGRAM_POSTS[2]!,
    MOCK_INSTAGRAM_POSTS[0]!,
    { ...MOCK_INSTAGRAM_POSTS[0]!, caption: 'duplicate copy' },
    MOCK_INSTAGRAM_POSTS[1]!,
  ], 3)
  assert.equal(posts.length, 3)
  assert.deepEqual(posts.map((post) => post.externalId), [
    'mock-20260825-carousel',
    'mock-20260824-reel',
    'mock-20260823-image',
  ])
})

test('normalizer rejects incomplete media instead of manufacturing fields', () => {
  assert.throws(() => normalizeInstagramPost({
    externalId: 'bad', username: 'mreasonchan', publishedAt: '2026-08-25T00:00:00Z', media: [],
  }), (error: unknown) => error instanceof InstagramProviderError && error.code === 'INVALID_DATA')
})

test('Apify mapper normalizes image, carousel children, and reel/video fields', () => {
  const carousel = normalizeApifyInstagramItem({
    ...rawImage('carousel-1', '2026-08-25T10:00:00.000Z'),
    type: 'Sidecar',
    childPosts: [
      rawImage('child-1', '2026-08-25T10:00:00.000Z'),
      {
        id: 'child-2',
        type: 'Video',
        displayUrl: 'https://scontent.example.test/child-2.jpg',
        videoUrl: 'https://scontent.example.test/child-2.mp4',
        videoDuration: 12.5,
        dimensionsWidth: 720,
        dimensionsHeight: 1280,
      },
      rawImage('child-3', '2026-08-25T10:00:00.000Z'),
    ],
  })
  assert.equal(carousel.mediaType, 'CAROUSEL')
  assert.equal(carousel.media.length, 3)
  assert.deepEqual(carousel.media.map((media) => media.sortOrder), [0, 1, 2])
  assert.deepEqual(carousel.media.map((media) => media.type), ['IMAGE', 'VIDEO', 'IMAGE'])
  assert.equal(carousel.media[1]?.duration, 12.5)

  const reel = normalizeApifyInstagramItem({
    ...rawImage('reel-1', '2026-08-24T10:00:00.000Z'),
    type: 'Video',
    productType: 'clips',
    displayUrl: 'https://scontent.example.test/reel-1.jpg',
    videoUrl: 'https://scontent.example.test/reel-1.mp4',
    videoDuration: 21,
  })
  assert.equal(reel.mediaType, 'REEL')
  assert.equal(reel.media[0]?.type, 'VIDEO')
  assert.equal(reel.media[0]?.duration, 21)
})

test('Apify Provider calls the fixed Actor once, deduplicates, and sorts by publishedAt', async () => {
  const rows = [
    rawImage('old-pinned', '2024-01-01T00:00:00.000Z', { isPinned: true }),
    rawImage('new-carousel', '2026-08-25T10:00:00.000Z', {
      type: 'Sidecar',
      childPosts: [
        rawImage('new-child-1', '2026-08-25T10:00:00.000Z'),
        rawImage('new-child-2', '2026-08-25T10:00:00.000Z'),
        rawImage('new-child-3', '2026-08-25T10:00:00.000Z'),
      ],
    }),
    rawImage('middle-reel', '2025-06-01T00:00:00.000Z', {
      type: 'Video',
      productType: 'clips',
      displayUrl: 'https://scontent.example.test/middle-reel.jpg',
      videoUrl: 'https://scontent.example.test/middle-reel.mp4',
      videoDuration: 8,
    }),
    rawImage('new-carousel', '2026-08-24T10:00:00.000Z', { caption: 'duplicate row' }),
  ]
  const { provider, calls } = successfulProvider(rows)
  const posts = await provider.getLatestPosts('mreasonchan', 3)
  const diagnostics = provider.getDiagnostics()

  assert.equal(posts.length, 3)
  assert.deepEqual(posts.map((post) => post.externalId), ['new-carousel', 'middle-reel', 'old-pinned'])
  assert.equal(posts[0]?.mediaType, 'CAROUSEL')
  assert.equal(posts[0]?.media.length, 3)
  assert.equal(posts[1]?.mediaType, 'REEL')
  assert.equal(diagnostics?.actorRuns, 1)
  assert.equal(diagnostics?.datasetItems, 4)
  assert.equal(diagnostics?.duplicateExternalIds, 1)
  assert.equal(diagnostics?.pinnedDetected, true)
  assert.equal(diagnostics?.childPostsCounts[1], 3)
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    directUrls: ['https://www.instagram.com/mreasonchan/'],
    resultsType: 'posts',
    resultsLimit: 3,
    skipPinnedPosts: false,
  })
  assert.match(calls[0]?.url || '', /\/actors\/apify~instagram-scraper\/runs/)
  assert.equal(resolveInstagramProviderName('apify'), 'apify')
})

test('Apify Provider skips foreign-owner collaboration posts without rewriting their owner', async () => {
  const { provider } = successfulProvider([
    rawImage('target-old', '2026-08-20T10:00:00.000Z'),
    rawImage('foreign', '2026-08-26T10:00:00.000Z', { ownerUsername: 'australianopen' }),
    rawImage('target-new', '2026-08-25T10:00:00.000Z', { ownerUsername: 'MReasonChan' }),
  ])

  const posts = await provider.getLatestPosts('MReasonChan', 3)
  const diagnostics = provider.getDiagnostics()

  assert.deepEqual(posts.map((post) => post.externalId), ['target-new', 'target-old'])
  assert.ok(posts.every((post) => post.username === 'mreasonchan'))
  assert.equal(diagnostics?.postItems, 3)
  assert.equal(diagnostics?.targetPosts, 2)
  assert.equal(diagnostics?.foreignOwnerSkipped, 1)
})

test('Apify Provider rejects a dataset with no target-owner posts', async () => {
  const { provider } = successfulProvider([
    rawImage('foreign-1', '2026-08-26T10:00:00.000Z', { ownerUsername: 'australianopen' }),
    rawImage('foreign-2', '2026-08-25T10:00:00.000Z', { ownerUsername: 'shallwetalkhk20' }),
  ])

  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'PROVIDER_TARGET_MISMATCH'
  })
  assert.equal(provider.getDiagnostics()?.targetPosts, 0)
  assert.equal(provider.getDiagnostics()?.foreignOwnerSkipped, 2)
})

test('Apify Provider audits inputUrl without using it to rewrite foreign owners', async () => {
  const { provider } = successfulProvider([
    rawImage('target-1', '2026-08-26T10:00:00.000Z', {
      inputUrl: 'https://www.instagram.com/mreasonchan/',
    }),
    rawImage('foreign-1', '2026-08-25T10:00:00.000Z', {
      inputUrl: 'https://www.instagram.com/mreasonchan/',
      ownerUsername: 'australianopen',
    }),
  ])

  const posts = await provider.getLatestPosts('mreasonchan', 3)
  assert.equal(posts.length, 1)
  assert.equal(posts[0]?.username, 'mreasonchan')
  assert.equal(provider.getDiagnostics()?.foreignOwnerSkipped, 1)
})

test('Apify Provider rejects an inputUrl for a different profile', async () => {
  const { provider } = successfulProvider([rawImage('wrong-target', '2026-08-26T10:00:00.000Z', {
    inputUrl: 'https://www.instagram.com/australianopen/',
  })])

  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'PROVIDER_TARGET_MISMATCH'
  })
})

test('Apify Provider attaches an explicit dispatcher without using global proxy settings', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const proxiedProvider = new ApifyInstagramProvider({
    proxyUrl: 'http://127.0.0.1:7890',
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: String(input), init })
      if (String(input).includes('/actors/apify~instagram-scraper/runs')) {
        return jsonResponse({ data: { id: 'run-proxy-test', status: 'SUCCEEDED', defaultDatasetId: 'dataset-test-1', usageTotalUsd: 0 } })
      }
      return jsonResponse([rawImage('proxy-test', '2026-08-25T10:00:00.000Z')])
    },
    costSettleDelayMs: 0,
  })
  await proxiedProvider.getLatestPosts('mreasonchan', 3)
  const requestInit = calls[0]?.init as RequestInit & { dispatcher?: unknown }
  assert.equal(proxiedProvider.proxyUrl, 'http://127.0.0.1:7890/')
  assert.ok(requestInit.dispatcher)
})

test('Apify Provider can reuse an existing Dataset without creating an Actor Run', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const provider = new ApifyInstagramProvider({
    proxyUrl: 'http://127.0.0.1:7890',
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: String(input), init })
      if (String(input).includes('/datasets/existing-dataset/items')) return jsonResponse([rawImage('existing-1', '2026-08-25T10:00:00.000Z')])
      throw new Error(`unexpected test URL: ${String(input)}`)
    },
    costSettleDelayMs: 0,
  })
  const posts = await provider.getLatestPostsFromDataset('existing-dataset', 'mreasonchan', 2)
  assert.equal(posts.length, 1)
  assert.equal(posts[0]?.externalId, 'existing-1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.init.method, undefined)
  assert.equal(provider.getDiagnostics()?.actorRuns, 0)
  assert.equal(provider.getTrace()?.runId, null)
  assert.equal(provider.getTrace()?.datasetId, 'existing-dataset')
})

test('Apify Provider maps empty Dataset to a terminal error without retrying', async () => {
  const { provider, calls } = successfulProvider([])
  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'PROVIDER_EMPTY_RESULT'
  })
  assert.equal(calls.length, 2)
})

test('Apify Provider maps auth and rate-limit responses without a second Actor Run', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({}, status)
    }
    const provider = new ApifyInstagramProvider({ fetchImpl, costSettleDelayMs: 0 })
    await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
      const expected = status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_AUTH_ERROR'
      return error instanceof InstagramProviderError && error.code === expected
    })
    assert.equal(calls, 1)
  }
})

test('Apify Provider maps a failed Actor Run and malformed media to contract errors', async () => {
  const failedRunProvider = new ApifyInstagramProvider({
    fetchImpl: async () => jsonResponse({ data: { id: 'run-failed', status: 'FAILED', defaultDatasetId: 'dataset-failed' } }),
    costSettleDelayMs: 0,
  })
  await assert.rejects(failedRunProvider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'PROVIDER_RUN_FAILED'
  })

  const { provider } = successfulProvider([rawImage('missing-media', '2026-08-25T10:00:00.000Z', { displayUrl: null })])
  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'PROVIDER_CONTRACT_FAILED'
  })
})
