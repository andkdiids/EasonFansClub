import assert from 'node:assert/strict'
import test from 'node:test'
import { ApifyInstagramProvider, classifyInstagramTargetRelationship, normalizeApifyInstagramItem, resolveInstagramCollaborationUsernames, resolveInstagramOwnerUsername, validateApifyDatasetTarget } from '@/lib/instagram/apify-provider'
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
    profilePicUrl: 'https://scontent.cdninstagram.com/avatar.jpg',
    childPosts: [],
    ...options,
  }
}

function successfulProvider(rows: unknown[], options: { usageTotalUsd?: number | null; runInput?: unknown } = {}) {
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
          ...(options.runInput === undefined ? {} : { input: options.runInput }),
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

const CURRENT_MREASONCHAN_DATASET_FIXTURE = [
  ...Array.from({ length: 14 }, (_, index) => rawImage(`direct-${index + 1}`, `2026-08-${String(27 - index).padStart(2, '0')}T10:00:00.000Z`)),
  rawImage('DQoBrS-gYZ8', '2026-08-13T10:00:00.000Z', {
    ownerUsername: 'shallwetalkhk20',
    inputUrl: 'https://www.instagram.com/mreasonchan/',
    coauthorProducers: ['mreasonchan'],
  }),
  rawImage('DQJwhE0D9Er', '2026-08-12T10:00:00.000Z', {
    ownerUsername: 'yisiyinyue',
    inputUrl: 'https://www.instagram.com/mreasonchan/',
    coauthorProducers: ['mreasonchan'],
  }),
  rawImage('DPx2JEiEa97', '2026-08-11T10:00:00.000Z', {
    ownerUsername: 'hkctatennis',
    inputUrl: 'https://www.instagram.com/mreasonchan/',
    coauthorProducers: ['mreasonchan'],
  }),
  rawImage('DUKRYvRE-cQ', '2026-08-10T10:00:00.000Z', {
    ownerUsername: 'australianopen',
    inputUrl: 'https://www.instagram.com/mreasonchan/',
    coauthorProducers: ['mreasonchan'],
  }),
  rawImage('DPwBi2SDHlE', '2026-08-09T10:00:00.000Z', {
    ownerUsername: 'utstour',
    inputUrl: 'https://www.instagram.com/mreasonchan/',
    coauthorProducers: ['mreasonchan', 'hkctatennis'],
  }),
]

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

test('normalizer keeps an optional source avatar without making it required', () => {
  const normalized = normalizeInstagramPost({
    externalId: 'avatar',
    username: 'mreasonchan',
    authorAvatarUrl: 'https://scontent.cdninstagram.com/avatar.jpg',
    publishedAt: '2026-08-25T00:00:00Z',
    media: [{ type: 'IMAGE', sourceUrl: 'https://scontent.cdninstagram.com/post.jpg' }],
  })
  assert.equal(normalized.authorAvatarUrl, 'https://scontent.cdninstagram.com/avatar.jpg')
  assert.equal(normalizeInstagramPost({
    externalId: 'avatar-invalid',
    username: 'mreasonchan',
    authorAvatarUrl: 'javascript:alert(1)',
    publishedAt: '2026-08-25T00:00:00Z',
    media: [{ type: 'IMAGE', sourceUrl: 'https://scontent.cdninstagram.com/post.jpg' }],
  }).authorAvatarUrl, null)
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
  assert.equal(carousel.authorAvatarUrl, 'https://scontent.cdninstagram.com/avatar.jpg')

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

test('Apify owner resolver accepts the production ownerUsername shape and normalizes case', () => {
  const item = rawImage('production-shape', '2026-08-25T10:00:00.000Z', {
    username: undefined,
    owner: undefined,
    profileName: undefined,
    ownerUsername: '@MReasonChan',
  })
  assert.deepEqual(resolveInstagramOwnerUsername(item), { username: 'mreasonchan', source: 'ownerUsername' })
  assert.equal(normalizeApifyInstagramItem(item).username, 'mreasonchan')
})

test('Apify owner resolver follows safe precedence and URL fallback rules', () => {
  assert.deepEqual(resolveInstagramOwnerUsername({
    ownerUsername: 'MReasonChan',
    owner: { username: 'australianopen' },
    username: 'shallwetalkhk20',
  }), { username: 'mreasonchan', source: 'ownerUsername' })
  assert.deepEqual(resolveInstagramOwnerUsername({ owner: { username: '@MReasonChan' } }), { username: 'mreasonchan', source: 'owner.username' })
  assert.deepEqual(resolveInstagramOwnerUsername({ username: 'MReasonChan' }), { username: 'mreasonchan', source: 'username' })
  assert.deepEqual(resolveInstagramOwnerUsername({ profileUsername: 'MReasonChan' }), { username: 'mreasonchan', source: 'profileUsername' })
  assert.deepEqual(resolveInstagramOwnerUsername({ inputUrl: 'https://www.instagram.com/MReasonChan/' }), { username: 'mreasonchan', source: 'inputUrl' })
  assert.deepEqual(resolveInstagramOwnerUsername({ profileUrl: 'https://www.instagram.com/MReasonChan/' }), { username: 'mreasonchan', source: 'profileUrl' })
  assert.deepEqual(resolveInstagramOwnerUsername({ url: 'https://www.instagram.com/MReasonChan/' }), { username: 'mreasonchan', source: 'url' })
  assert.deepEqual(resolveInstagramOwnerUsername({ url: 'https://www.instagram.com/p/DUQJQGACeM7/' }), { username: null, source: null })
  assert.deepEqual(resolveInstagramOwnerUsername({}), { username: null, source: null })
})

test('Apify Dataset relationship validation accepts direct owners and rejects foreign rows', () => {
  const target = rawImage('target', '2026-08-25T10:00:00.000Z', { ownerUsername: '@MREASONCHAN' })
  const validation = validateApifyDatasetTarget([target], 'mreasonchan')
  assert.deepEqual(validation.recognizedOwners, ['mreasonchan'])
  assert.equal(validation.validOwnerItemCount, 1)
  assert.equal(validation.unknownOwnerItemCount, 0)
  assert.equal(validation.mismatchedOwnerItemCount, 0)
  assert.equal(validation.directOwnerItemCount, 1)
  assert.equal(validation.collaboratorItemCount, 0)
  assert.equal(validation.foreignItemCount, 0)
  assert.equal(validation.unknownItemCount, 0)
  assert.equal(classifyInstagramTargetRelationship(target, 'MReasonChan'), 'DIRECT_OWNER')

  assert.throws(() => validateApifyDatasetTarget([
    rawImage('foreign', '2026-08-25T10:00:00.000Z', { ownerUsername: 'australianopen' }),
  ], 'mreasonchan'), (error: unknown) => error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_MIXED_OWNERS')
  assert.throws(() => validateApifyDatasetTarget([
    target,
    rawImage('foreign', '2026-08-24T10:00:00.000Z', { ownerUsername: 'australianopen' }),
  ], 'mreasonchan'), (error: unknown) => error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_MIXED_OWNERS')
  assert.throws(() => validateApifyDatasetTarget([
    { id: 'unknown-owner' },
  ], 'mreasonchan'), (error: unknown) => error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_TARGET_UNVERIFIABLE')
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
    searchType: 'user',
    resultsType: 'posts',
    resultsLimit: 3,
    skipPinnedPosts: false,
  })
  assert.match(calls[0]?.url || '', /\/actors\/apify~instagram-scraper\/runs/)
  assert.equal(resolveInstagramProviderName('apify'), 'apify')
})

test('Apify Provider imports direct owners and strong collaboration rows without changing the real owner', async () => {
  const { provider } = successfulProvider([
    rawImage('target-old', '2026-08-20T10:00:00.000Z'),
    rawImage('collab', '2026-08-26T10:00:00.000Z', {
      ownerUsername: 'australianopen',
      inputUrl: 'https://www.instagram.com/mreasonchan/',
      coauthorProducers: ['mreasonchan'],
      taggedUsers: ['mreasonchan'],
    }),
    rawImage('target-new', '2026-08-25T10:00:00.000Z', { ownerUsername: 'MReasonChan' }),
  ])

  const posts = await provider.getLatestPosts('MReasonChan', 3)
  const diagnostics = provider.getDiagnostics()

  assert.equal(posts.length, 3)
  assert.equal(posts[0]?.externalId, 'collab')
  assert.equal(posts[0]?.username, 'australianopen')
  assert.equal(diagnostics?.postItems, 3)
  assert.equal(diagnostics?.targetPosts, 3)
  assert.equal(diagnostics?.foreignOwnerSkipped, 0)
  assert.equal(diagnostics?.mismatchedOwnerItemCount, 1)
  assert.equal(diagnostics?.directOwnerItemCount, 2)
  assert.equal(diagnostics?.collaboratorItemCount, 1)
  assert.equal(diagnostics?.foreignItemCount, 0)
  assert.equal(diagnostics?.unknownItemCount, 0)
  assert.deepEqual(diagnostics?.recognizedOwners, ['australianopen', 'mreasonchan'])
})

test('Apify Provider accepts a coauthor-only row from the target profile feed', async () => {
  const { provider } = successfulProvider([rawImage('coauthor-only', '2026-08-26T10:00:00.000Z', {
    ownerUsername: 'australianopen',
    inputUrl: 'https://www.instagram.com/mreasonchan/',
    coauthorProducers: ['mreasonchan'],
    taggedUsers: ['mreasonchan'],
  })])

  const posts = await provider.getLatestPosts('mreasonchan', 3)
  assert.equal(posts.length, 1)
  assert.equal(posts[0]?.username, 'australianopen')
  assert.equal(classifyInstagramTargetRelationship({
    ownerUsername: 'australianopen',
    coauthorProducers: ['mreasonchan'],
  }, 'mreasonchan'), 'COLLABORATOR')
  assert.equal(classifyInstagramTargetRelationship({
    ownerUsername: 'australianopen',
    collaborators: [{ username: 'MReasonChan' }],
  }, 'mreasonchan'), 'COLLABORATOR')
  assert.deepEqual(resolveInstagramCollaborationUsernames({ coauthorProducers: ['@MReasonChan'] }), ['mreasonchan'])
  assert.throws(() => validateApifyDatasetTarget([{
    ownerUsername: 'australianopen',
    coauthorProducers: ['mreasonchan'],
  }], 'mreasonchan'), (error: unknown) => (
    error instanceof InstagramProviderError && error.code === 'PROVIDER_TARGET_MISMATCH'
  ))
})

test('Current 19-item mreasonchan Dataset fixture passes with 14 direct owners and 5 collaborators', async () => {
  const { provider } = successfulProvider(CURRENT_MREASONCHAN_DATASET_FIXTURE)
  const posts = await provider.getLatestPosts('mreasonchan', 19)
  const diagnostics = provider.getDiagnostics()

  assert.equal(posts.length, 19)
  assert.equal(diagnostics?.itemCount, 19)
  assert.equal(diagnostics?.directOwnerItemCount, 14)
  assert.equal(diagnostics?.collaboratorItemCount, 5)
  assert.equal(diagnostics?.foreignItemCount, 0)
  assert.equal(diagnostics?.unknownItemCount, 0)
  assert.equal(diagnostics?.targetPosts, 19)
  assert.equal(diagnostics?.mismatchedOwnerItemCount, 5)
  assert.deepEqual(diagnostics?.recognizedOwners, [
    'australianopen', 'hkctatennis', 'mreasonchan', 'shallwetalkhk20', 'utstour', 'yisiyinyue',
  ])
})

test('Apify Provider rejects a tagged post whose owner is not the target', async () => {
  const { provider } = successfulProvider([rawImage('tagged-only', '2026-08-26T10:00:00.000Z', {
    ownerUsername: 'australianopen',
    taggedUsers: ['mreasonchan'],
  })])

  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_MIXED_OWNERS'
  })
})

test('Apify Provider keeps unknown ownership fail-closed even when collaboration is claimed', () => {
  const item = {
    id: 'unknown-collab',
    inputUrl: 'https://www.instagram.com/p/unknown-collab/',
    coauthorProducers: ['mreasonchan'],
  }
  assert.equal(classifyInstagramTargetRelationship(item, 'mreasonchan'), 'UNVERIFIABLE')
  assert.throws(() => validateApifyDatasetTarget([item], 'mreasonchan'), (error: unknown) => (
    error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_TARGET_UNVERIFIABLE'
  ))
})

test('Apify Provider rejects a dataset with no target-owner posts', async () => {
  const { provider } = successfulProvider([
    rawImage('foreign-1', '2026-08-26T10:00:00.000Z', { ownerUsername: 'australianopen' }),
    rawImage('foreign-2', '2026-08-25T10:00:00.000Z', { ownerUsername: 'shallwetalkhk20' }),
  ])

  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_MIXED_OWNERS'
  })
  assert.equal(provider.getDiagnostics()?.targetPosts, 0)
  assert.equal(provider.getDiagnostics()?.foreignOwnerSkipped, 0)
  assert.equal(provider.getDiagnostics()?.mismatchedOwnerItemCount, 2)
  assert.equal(provider.getDiagnostics()?.foreignItemCount, 2)
})

test('Apify Provider rejects inputUrl target and owner conflicts as a mixed dataset', async () => {
  const { provider } = successfulProvider([
    rawImage('target-1', '2026-08-26T10:00:00.000Z', {
      inputUrl: 'https://www.instagram.com/mreasonchan/',
    }),
    rawImage('foreign-1', '2026-08-25T10:00:00.000Z', {
      inputUrl: 'https://www.instagram.com/mreasonchan/',
      ownerUsername: 'australianopen',
    }),
  ])

  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'APIFY_DATASET_MIXED_OWNERS'
  })
})

test('Apify Provider can validate a missing username through ownerUsername or profile input evidence', async () => {
  const { provider } = successfulProvider([rawImage('owner-fallback', '2026-08-26T10:00:00.000Z', {
    username: undefined,
    owner: undefined,
    ownerUsername: 'mreasonchan',
  })])
  const posts = await provider.getLatestPosts('mreasonchan', 3)
  assert.equal(posts.length, 1)
  assert.equal(posts[0]?.username, 'mreasonchan')

  const profileFallback = successfulProvider([rawImage('profile-fallback', '2026-08-26T10:00:00.000Z', {
    username: undefined,
    owner: undefined,
    ownerUsername: undefined,
    profileUsername: undefined,
    inputUrl: 'https://www.instagram.com/MReasonChan/',
  })])
  const fallbackPosts = await profileFallback.provider.getLatestPosts('mreasonchan', 3)
  assert.equal(fallbackPosts[0]?.username, 'mreasonchan')
})

test('Apify Provider rejects an inputUrl for a different profile', async () => {
  const { provider } = successfulProvider([rawImage('wrong-target', '2026-08-26T10:00:00.000Z', {
    inputUrl: 'https://www.instagram.com/australianopen/',
  })])

  await assert.rejects(provider.getLatestPosts('mreasonchan', 3), (error: unknown) => {
    return error instanceof InstagramProviderError && error.code === 'PROVIDER_TARGET_MISMATCH'
  })
})

test('Apify Provider rejects an Actor Run input target that conflicts with the requested account', async () => {
  const { provider } = successfulProvider([rawImage('run-input-conflict', '2026-08-26T10:00:00.000Z')], {
    runInput: { directUrls: ['https://www.instagram.com/australianopen/'] },
  })
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
