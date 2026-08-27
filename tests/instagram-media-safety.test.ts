import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { DEFAULT_ALLOWED_MEDIA_HOSTS, inspectInstagramMediaUrl, InstagramMediaSafetyError, isAllowedMediaHostname, isRestrictedIp, SafeExternalInstagramMediaLocalizer } from '@/lib/instagram/media'

test('media safety rejects non-HTTPS, credential-bearing and unallowlisted URLs before fetch', async () => {
  const cases = [
    'http://cdn.example.com/image.jpg',
    'file:///etc/passwd',
    'https://user:password@cdn.example.com/image.jpg',
    'https://cdn.example.com/image.jpg',
  ]
  for (const sourceUrl of cases) {
    await assert.rejects(
      inspectInstagramMediaUrl({ sourceUrl, type: 'IMAGE' }),
      (error: unknown) => error instanceof InstagramMediaSafetyError && ['UNSAFE_URL', 'MEDIA_HOST_NOT_ALLOWED'].includes(error.code),
    )
  }
})

test('media suffix allowlist enforces a label boundary', () => {
  assert.equal(isAllowedMediaHostname('scontent.cdninstagram.com', '.cdninstagram.com'), true)
  assert.equal(isAllowedMediaHostname('cdninstagram.com', '.cdninstagram.com'), true)
  assert.equal(isAllowedMediaHostname('evilcdninstagram.com', '.cdninstagram.com'), false)
  assert.equal(isAllowedMediaHostname('evil.fbcdn.net.example', '.fbcdn.net'), false)
  assert.equal(isAllowedMediaHostname('scontent-gru1.cdninstagram.com', 'scontent-gru1.cdninstagram.com'), true)
  assert.equal(isAllowedMediaHostname('scontent-gru2.cdninstagram.com', 'scontent-gru1.cdninstagram.com'), false)
})

test('the reviewed production default accepts the real Dataset CDN host and rejects broad domains', () => {
  const env = process.env as Record<string, string | undefined>
  const previousNodeEnv = env.NODE_ENV
  const previousAllowlist = process.env.IG_ALLOWED_MEDIA_HOSTS
  env.NODE_ENV = 'production'
  delete process.env.IG_ALLOWED_MEDIA_HOSTS
  try {
    assert.equal(isAllowedMediaHostname('instagram.fmgf7-1.fna.fbcdn.net'), true)
    assert.equal(isAllowedMediaHostname('scontent-dus1-1.cdninstagram.com'), true)
    assert.equal(isAllowedMediaHostname('evilcdninstagram.com'), false)
    assert.equal(isAllowedMediaHostname('anything.example.com'), false)
    assert.equal(isAllowedMediaHostname('instagram.fmgf7-1.fna.fbcdn.net', DEFAULT_ALLOWED_MEDIA_HOSTS), true)
  } finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV
    else env.NODE_ENV = previousNodeEnv
    if (previousAllowlist === undefined) delete process.env.IG_ALLOWED_MEDIA_HOSTS
    else process.env.IG_ALLOWED_MEDIA_HOSTS = previousAllowlist
  }
})

test('media safety rejects restricted IPv4 and IPv6 addresses', () => {
  for (const address of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '224.0.0.1']) {
    assert.equal(isRestrictedIp(address), true, address)
  }
  for (const address of ['::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1']) {
    assert.equal(isRestrictedIp(address), true, address)
  }
  assert.equal(isRestrictedIp('8.8.8.8'), false)
  assert.equal(isRestrictedIp('2001:4860:4860::8888'), false)
})

test('media inspection revalidates every redirect and falls back to a bounded Range request', async () => {
  const previousAllowlist = process.env.IG_ALLOWED_MEDIA_HOSTS
  process.env.IG_ALLOWED_MEDIA_HOSTS = '.example.test'
  const lookupImpl = (async () => [{ address: '8.8.8.8', family: 4 }]) as unknown as typeof import('node:dns/promises').lookup
  try {
    const calls: Array<{ url: string; method: string; range: string | null }> = []
    const responses = [
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/image.jpg' } }),
      new Response(null, { status: 405 }),
      new Response('jpeg-bytes', { status: 206, headers: { 'content-type': 'image/jpeg', 'content-length': '10' } }),
    ]
    const result = await inspectInstagramMediaUrl(
      { sourceUrl: 'https://origin.example.test/image.jpg', type: 'IMAGE' },
      {
        lookupImpl,
        fetchImpl: (async (input, init = {}) => {
          calls.push({ url: String(input), method: String(init.method || 'GET'), range: new Headers(init.headers).get('range') })
          return responses.shift() || new Response(null, { status: 500 })
        }) as typeof fetch,
      },
    )
    assert.deepEqual(result, { status: 206, contentType: 'image/jpeg', contentLength: 10, method: 'RANGE', hostname: 'cdn.example.test', redirects: 1 })
    assert.deepEqual(calls, [
      { url: 'https://origin.example.test/image.jpg', method: 'HEAD', range: null },
      { url: 'https://cdn.example.test/image.jpg', method: 'HEAD', range: null },
      { url: 'https://cdn.example.test/image.jpg', method: 'GET', range: 'bytes=0-1023' },
    ])

    await assert.rejects(
      inspectInstagramMediaUrl(
        { sourceUrl: 'https://origin.example.test/image.jpg', type: 'IMAGE' },
        {
          lookupImpl,
          fetchImpl: (async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/image.jpg' } })) as typeof fetch,
        },
      ),
      (error: unknown) => error instanceof InstagramMediaSafetyError && error.code === 'MEDIA_HOST_NOT_ALLOWED',
    )
  } finally {
    if (previousAllowlist === undefined) delete process.env.IG_ALLOWED_MEDIA_HOSTS
    else process.env.IG_ALLOWED_MEDIA_HOSTS = previousAllowlist
  }
})

test('media redirect to a private-resolving host is rejected after the redirect hop', async () => {
  const previousAllowlist = process.env.IG_ALLOWED_MEDIA_HOSTS
  process.env.IG_ALLOWED_MEDIA_HOSTS = '.example.test'
  try {
    await assert.rejects(
      inspectInstagramMediaUrl(
        { sourceUrl: 'https://origin.example.test/image.jpg', type: 'IMAGE' },
        {
          lookupImpl: (async (hostname: string) => [{ address: hostname.startsWith('private.') ? '10.0.0.7' : '8.8.8.8', family: 4 }]) as unknown as typeof import('node:dns/promises').lookup,
          fetchImpl: (async () => new Response(null, { status: 302, headers: { location: 'https://private.example.test/image.jpg' } })) as typeof fetch,
        },
      ),
      (error: unknown) => error instanceof InstagramMediaSafetyError && error.code === 'UNSAFE_URL',
    )
  } finally {
    if (previousAllowlist === undefined) delete process.env.IG_ALLOWED_MEDIA_HOSTS
    else process.env.IG_ALLOWED_MEDIA_HOSTS = previousAllowlist
  }
})

test('the real Dataset media host fixture passes the media gate without contacting the network', async () => {
  const previousAllowlist = process.env.IG_ALLOWED_MEDIA_HOSTS
  process.env.IG_ALLOWED_MEDIA_HOSTS = DEFAULT_ALLOWED_MEDIA_HOSTS
  const lookupImpl = (async () => [{ address: '8.8.8.8', family: 4 }]) as unknown as typeof import('node:dns/promises').lookup
  try {
    const result = await inspectInstagramMediaUrl(
      { sourceUrl: 'https://instagram.fmgf7-1.fna.fbcdn.net/v/t51.82787-15/media.jpg', type: 'IMAGE' },
      { lookupImpl, fetchImpl: (async () => new Response('jpeg', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '4' } })) as typeof fetch },
    )
    assert.equal(result.hostname, 'instagram.fmgf7-1.fna.fbcdn.net')
    assert.equal(result.status, 200)
  } finally {
    if (previousAllowlist === undefined) delete process.env.IG_ALLOWED_MEDIA_HOSTS
    else process.env.IG_ALLOWED_MEDIA_HOSTS = previousAllowlist
  }
})

test('media inspection rejects HTML as a normal media response and localizer streams video plus thumbnail', async () => {
  const previousAllowlist = process.env.IG_ALLOWED_MEDIA_HOSTS
  process.env.IG_ALLOWED_MEDIA_HOSTS = '.example.test'
  const lookupImpl = (async () => [{ address: '8.8.8.8', family: 4 }]) as unknown as typeof import('node:dns/promises').lookup
  try {
    await assert.rejects(
      inspectInstagramMediaUrl(
        { sourceUrl: 'https://media.example.test/not-media', type: 'IMAGE' },
        { lookupImpl, fetchImpl: (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch },
      ),
      (error: unknown) => error instanceof InstagramMediaSafetyError && error.code === 'MEDIA_CONTENT_TYPE_INVALID',
    )

    const uploads: Array<{ key: string; contentType: string; body: Buffer }> = []
    const writer = {
      upload: async ({ key, contentType, body }: { key: string; contentType: string; body: NodeJS.ReadableStream }) => {
        const chunks: Buffer[] = []
        for await (const chunk of body as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        uploads.push({ key, contentType, body: Buffer.concat(chunks) })
        return `https://media.example.test/stored/${key}`
      },
    }
    const imageBytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer()
    const responses = [
      new Response(Buffer.from('video-stream'), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '12' } }),
      new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(imageBytes.length) } }),
    ]
    const localizer = new SafeExternalInstagramMediaLocalizer({
      writer,
      lookupImpl,
      fetchImpl: (async () => responses.shift() || new Response(null, { status: 500 })) as typeof fetch,
      keyPrefix: 'social/instagram/mreasonchan/poc',
    })
    const localized = await localizer.localize({
      type: 'VIDEO', sourceUrl: 'https://media.example.test/video.mp4', thumbnailUrl: 'https://media.example.test/thumb.jpg',
      width: 720, height: 1280, duration: 12, sortOrder: 0,
    }, { postExternalId: 'video-1' })
    assert.equal(localized.storageUrl.endsWith('/video-01.mp4'), true)
    assert.equal(localized.thumbnailUrl?.endsWith('/thumb-01.webp'), true)
    assert.deepEqual(uploads.map((upload) => upload.key), [
      'social/instagram/mreasonchan/poc/video-1/video-01.mp4',
      'social/instagram/mreasonchan/poc/video-1/thumb-01.webp',
    ])
    assert.deepEqual(uploads.map((upload) => upload.contentType), ['video/mp4', 'image/webp'])
    assert.deepEqual(uploads[0]?.body, Buffer.from('video-stream'))
  } finally {
    if (previousAllowlist === undefined) delete process.env.IG_ALLOWED_MEDIA_HOSTS
    else process.env.IG_ALLOWED_MEDIA_HOSTS = previousAllowlist
  }
})
