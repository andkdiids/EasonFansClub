import assert from 'node:assert/strict'
import Module from 'node:module'
import { after, before, beforeEach, test } from 'node:test'
import sharp from 'sharp'
import { CONTENT_IMAGE_MAX_FILE_SIZE } from '../lib/content-image-upload'

type Route = typeof import('../app/api/uploads/content-image/route')
type AuthUser = { id: string }
type TraceLog = Record<string, unknown>

const fixtureUser: AuthUser = { id: 'upload-user-1' }
const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
const originalConsoleError = console.error
const logs: Array<unknown[]> = []
const uploaded: Array<{ key: string; size: number; contentType: string }> = []
let uploadFamilyShouldFail = false
let authShouldThrow = false
let rateLimitShouldFail = false
let route: Route

const securityStub = {
  requireRequestUser: async (request: Request) => {
    if (authShouldThrow) throw new Error('internal auth details must not escape')
    const bearer = request.headers.get('authorization')
    const cookie = request.headers.get('cookie')
    if (bearer === 'Bearer fixture-bearer' || cookie === 'eason_fans_session=fixture-cookie') {
      return { user: fixtureUser }
    }
    return {
      user: null,
      response: new Response(JSON.stringify({ code: 'AUTH_REQUIRED', message: '请先登录' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    }
  },
  enforceApiRateLimit: async () => rateLimitShouldFail
    ? new Response(JSON.stringify({ code: 'RATE_LIMITED', message: '图片上传过于频繁，请稍后再试' }), { status: 429 })
    : null,
}

before(async () => {
  console.error = (...args: unknown[]) => logs.push(args)
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/security') return securityStub
    if (request === '@/lib/images') return { publicImageUrl: (value: string) => value }
    if (request === '@/lib/tencent-cos') return { deleteFromCos: async () => undefined }
    if (request === '@/lib/site-media-storage') {
      return {
        uploadSiteImage: async (input: { key: string; body: Buffer; contentType?: string }) => {
          if (uploadFamilyShouldFail) throw new Error('C:\\server\\private\\cos-secret')
          uploaded.push({ key: input.key, size: input.body.byteLength, contentType: input.contentType || '' })
          return `https://media.fixture.invalid/${input.key}`
        },
      }
    }
    if (request === '@/lib/image-variant-upload') {
      return {
        uploadImageVariantFamily: async (input: {
          sourceObjectPath: string
          original: Buffer
          generated: { source: Buffer }
          upload: (value: { key: string; body: Buffer; contentType: string }) => Promise<string>
        }) => {
          if (uploadFamilyShouldFail) throw new Error('C:\\server\\private\\variant-secret')
          await input.upload({ key: input.sourceObjectPath, body: input.generated.source, contentType: 'image/webp' })
          return {
            originalUrl: null,
            originalObjectKey: null,
            sourceUrl: 'https://media.fixture.invalid/content.webp',
            sourceObjectKey: input.sourceObjectPath,
            variantUrls: {},
            variantObjectKeys: {},
          }
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    route = await import('../app/api/uploads/content-image/route')
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

after(() => {
  console.error = originalConsoleError
  ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
})

beforeEach(() => {
  logs.length = 0
  uploaded.length = 0
  uploadFamilyShouldFail = false
  authShouldThrow = false
  rateLimitShouldFail = false
})

function requestHeaders(auth: 'cookie' | 'bearer' | 'anonymous' = 'cookie'): Record<string, string> {
  if (auth === 'cookie') return { cookie: 'eason_fans_session=fixture-cookie' }
  if (auth === 'bearer') return { authorization: 'Bearer fixture-bearer' }
  return {}
}

function imageFile(bytes: Buffer, name: string, type: string) {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function imageRequest(file: File | null, auth: 'cookie' | 'bearer' | 'anonymous' = 'cookie') {
  const form = new FormData()
  if (file) form.append('file', file)
  return route.POST(new Request('https://ecfc.invalid/api/uploads/content-image', {
    method: 'POST',
    headers: requestHeaders(auth),
    body: form,
  }))
}

async function realImage(format: 'jpeg' | 'png' | 'webp' | 'gif') {
  const input = sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 24, g: 96, b: 160 },
    },
  })
  if (format === 'jpeg') return input.jpeg().toBuffer()
  if (format === 'png') return input.png().toBuffer()
  if (format === 'webp') return input.webp().toBuffer()
  return input.gif().toBuffer()
}

async function heifFixture() {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 24, g: 96, b: 160 },
    },
  }).heif({ compression: 'av1' }).toBuffer()
}

async function responseJson(response: Response) {
  return await response.json() as Record<string, unknown>
}

function traceFor(response: Response, expected: { code: string; stage?: string; status?: number; mime?: string; size?: number; format?: string; heic?: boolean }) {
  const traceId = response.headers.get('x-content-image-trace-id')
  assert.match(traceId || '', /^[0-9a-f-]{36}$/)
  const matching = logs.filter((args) => (args[1] as TraceLog | undefined)?.traceId === traceId)
  assert.equal(matching.length, 1)
  assert.equal(matching[0]?.[0], '[content-image.upload.failed]')
  const trace = matching[0]?.[1] as TraceLog
  assert.equal(trace.code, expected.code)
  assert.equal(trace.status, expected.status ?? response.status)
  if (expected.stage) assert.equal(trace.stage, expected.stage)
  if (expected.mime) assert.equal(trace.mime, expected.mime)
  if (expected.size !== undefined) assert.equal(trace.size, expected.size)
  if (expected.format) assert.equal(trace.format, expected.format)
  if (expected.heic !== undefined) assert.equal(trace.heic, expected.heic)
  const serialized = JSON.stringify(trace)
  assert.doesNotMatch(serialized, /server|private|secret|Bearer|C:\\\\|\/Users\/|\/home\//i)
  return trace
}

test('Cookie and Bearer authenticated requests keep the existing upload response contract and expose a trace header', async () => {
  for (const auth of ['cookie', 'bearer'] as const) {
    const response = await imageRequest(imageFile(await realImage('png'), 'photo.png', 'image/png'), auth)
    assert.equal(response.status, 200, auth)
    assert.deepEqual(await responseJson(response), {
      url: 'https://media.fixture.invalid/content.webp',
      mimeType: 'image/webp',
    })
    assert.match(response.headers.get('x-content-image-trace-id') || '', /^[0-9a-f-]{36}$/)
    assert.equal(logs.length, 0)
  }
})

test('anonymous upload requests remain unauthorized and receive a safe trace header', async () => {
  const response = await imageRequest(null, 'anonymous')
  assert.equal(response.status, 401)
  assert.deepEqual(await responseJson(response), { code: 'AUTH_REQUIRED', message: '请先登录' })
  traceFor(response, { code: 'AUTH_REQUIRED', stage: 'auth', status: 401 })
})

test('JPEG, PNG, WebP, and GIF real bytes use Sharp magic detection and the unchanged normalized output path', async () => {
  const inputs = [
    ['jpeg', 'photo.jpg', 'image/jpeg'],
    ['png', 'photo.png', 'image/png'],
    ['webp', 'photo.webp', 'image/webp'],
    ['gif', 'photo.gif', 'image/gif'],
  ] as const
  for (const [format, name, mime] of inputs) {
    const response = await imageRequest(imageFile(await realImage(format), name, mime))
    assert.equal(response.status, 200, format)
    assert.deepEqual(await responseJson(response), {
      url: 'https://media.fixture.invalid/content.webp',
      mimeType: 'image/webp',
    })
    assert.match(response.headers.get('x-content-image-trace-id') || '', /^[0-9a-f-]{36}$/)
  }
  assert.equal(uploaded.length, inputs.length)
  assert.ok(uploaded.every((entry) => entry.contentType === 'image/webp'))
})

test('a generic browser MIME does not reject valid bytes when the accepted extension identifies the image', async () => {
  const response = await imageRequest(imageFile(await realImage('png'), 'photo.png', 'application/octet-stream'))
  assert.equal(response.status, 200)
  assert.equal((await responseJson(response)).mimeType, 'image/webp')
  assert.equal(logs.length, 0)
})

test('HEIC/HEIF-labelled fixture bytes exercise Sharp decode and undecodable bytes return explicit conversion errors', async () => {
  const fixture = await heifFixture()
  for (const [name, mime] of [['photo.heic', 'image/heic'], ['photo.heif', 'image/heif']] as const) {
    const response = await imageRequest(imageFile(fixture, name, mime))
    assert.equal(response.status, 200, name)
    assert.equal((await responseJson(response)).mimeType, 'image/webp')
  }

  for (const [name, mime] of [['photo.heic', 'image/heic'], ['photo.heif', 'image/heif']] as const) {
    const response = await imageRequest(imageFile(Buffer.from('not a HEIF decoder fixture'), name, mime))
    assert.equal(response.status, 400, name)
    assert.equal((await responseJson(response)).code, 'HEIC_CONVERSION_FAILED')
    traceFor(response, { code: 'HEIC_CONVERSION_FAILED', stage: 'sharp.decode', mime, heic: true })
  }
})

test('fake executable bytes and a real unsupported format are rejected by bytes, not filename or browser MIME', async () => {
  const executable = await imageRequest(imageFile(Buffer.from('MZfake executable bytes'), 'photo.jpg', 'image/jpeg'))
  assert.equal(executable.status, 400)
  assert.equal((await responseJson(executable)).code, 'IMAGE_PROCESSING_FAILED')
  traceFor(executable, { code: 'IMAGE_PROCESSING_FAILED', stage: 'sharp.decode', mime: 'image/jpeg', heic: false })

  const tiff = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 24, g: 96, b: 160 } },
  }).tiff().toBuffer()
  const unsupported = await imageRequest(imageFile(tiff, 'photo.jpg', 'image/jpeg'))
  assert.equal(unsupported.status, 400)
  assert.equal((await responseJson(unsupported)).code, 'UNSUPPORTED_FORMAT')
  traceFor(unsupported, { code: 'UNSUPPORTED_FORMAT', stage: 'sharp.format', mime: 'image/jpeg', format: 'tiff' })
})

test('oversize files preserve 413 policy and log sanitized MIME and size', async () => {
  const response = await imageRequest(imageFile(Buffer.alloc(CONTENT_IMAGE_MAX_FILE_SIZE + 1), 'large.jpg', 'image/jpeg'))
  assert.equal(response.status, 413)
  assert.equal((await responseJson(response)).code, 'FILE_TOO_LARGE')
  traceFor(response, {
    code: 'FILE_TOO_LARGE',
    stage: 'file.size',
    status: 413,
    mime: 'image/jpeg',
    size: CONTENT_IMAGE_MAX_FILE_SIZE + 1,
    heic: false,
  })
})

test('multipart, missing-file, rate-limit, storage, and unexpected failures all return traceable safe errors', async () => {
  const invalidContentType = await route.POST(new Request('https://ecfc.invalid/api/uploads/content-image', {
    method: 'POST',
    headers: { ...requestHeaders('cookie'), 'content-type': 'application/json' },
    body: '{}',
  }))
  assert.equal(invalidContentType.status, 400)
  traceFor(invalidContentType, { code: 'INVALID_MULTIPART', stage: 'multipart.content-type', mime: undefined })

  const missingFile = await imageRequest(null)
  assert.equal(missingFile.status, 400)
  assert.equal((await responseJson(missingFile)).code, 'FILE_REQUIRED')
  traceFor(missingFile, { code: 'FILE_REQUIRED', stage: 'file.required' })

  rateLimitShouldFail = true
  const rateLimited = await imageRequest(null)
  assert.equal(rateLimited.status, 429)
  assert.equal((await responseJson(rateLimited)).code, 'RATE_LIMITED')
  traceFor(rateLimited, { code: 'RATE_LIMITED', stage: 'rate-limit', status: 429 })
  rateLimitShouldFail = false

  uploadFamilyShouldFail = true
  const storageFailure = await imageRequest(imageFile(await realImage('png'), 'photo.png', 'image/png'))
  assert.equal(storageFailure.status, 502)
  assert.deepEqual(await responseJson(storageFailure), { code: 'UPLOAD_FAILED', message: '图片上传失败，请稍后重试' })
  traceFor(storageFailure, { code: 'UPLOAD_FAILED', stage: 'cos.upload', mime: 'image/png', format: 'png' })
  uploadFamilyShouldFail = false

  authShouldThrow = true
  const unexpected = await imageRequest(null)
  assert.equal(unexpected.status, 500)
  assert.deepEqual(await responseJson(unexpected), { code: 'INTERNAL_ERROR', message: '图片上传失败，请稍后重试' })
  traceFor(unexpected, { code: 'INTERNAL_ERROR', stage: 'unexpected', status: 500 })
})
