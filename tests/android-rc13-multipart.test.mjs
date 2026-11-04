import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { completeOnce, multipartUpload, safeCosError } from '../scripts/android-rc13-multipart.mjs'
import { downloadCosObject, downloadToFile, uploadImmutableObject, verifyCosReadOnly, verifyCosReadOnlyAccess } from '../scripts/android-rc11-cos-publish.mjs'

async function fixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rc13-multipart-'))
  const filePath = path.join(dir, 'file')
  await writeFile(filePath, Buffer.alloc(1024))
  try { await fn(filePath) } finally { await rm(dir, { recursive: true, force: true }) }
}

function mockCos(overrides = {}) {
  return {
    getBucketVersioning: async () => ({ VersioningConfiguration: {} }),
    multipartUpload: async () => ({ ETag: 'abc123' }),
    request: async (p) => p.Action === 'uploads' ? { InitiateMultipartUploadResult: { UploadId: 'owned-id' } } : { CompleteMultipartUploadResult: { ETag: 'abc123' } },
    multipartAbort: async () => ({}),
    headObject: async () => ({ statusCode: 200 }),
    ...overrides,
  }
}

const args = (cos, filePath) => ({ cos, bucket: 'bucket', region: 'region', key: 'unique', filePath, size: 1024, sha256: 'A'.repeat(64), log: () => {} })

test('read-only COS gate verifies empty versioning, authenticated HEAD, and a one-byte GET without mutations', async () => {
  const calls = []
  const logs = []
  const cos = {
    getBucketVersioning: async (options) => { calls.push(['versioning', options]); return { VersioningConfiguration: {} } },
    headObject: async (options) => { calls.push(['head', options]); return { statusCode: 200, headers: { 'content-length': '180263015' } } },
    getObject: async (options) => { calls.push(['get', options]); return { statusCode: 206, Body: Buffer.from([0]) } },
  }
  const result = await verifyCosReadOnlyAccess({ cos, bucket: 'ecfc-1306412725', region: 'ap-guangzhou', log: (line) => logs.push(line) })
  assert.deepEqual(calls.map(([method]) => method), ['versioning', 'head', 'get'])
  assert.equal(calls[1][1].Key, 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-185753-run41698377689-attempt1.apk')
  assert.equal(calls[2][1].Range, 'bytes=0-0')
  assert.equal(result.versioning, 'DISABLED')
  assert.match(logs.join('\n'), /COS_BUCKET_VERSIONING_RESPONSE=\{"VersioningConfiguration":\{\}\}/)
})

test('read-only COS gate fails closed and reports a safe error category on denied versioning access', async () => {
  const logs = []
  let objectCalls = 0
  const error = Object.assign(new Error('secret and provider data must not escape'), {
    code: 'AccessDenied', statusCode: 403, headers: { 'x-cos-request-id': 'NWQ1NTRhMWRfODhjMjJhMDlfMWNkOF8xZTRmYWJjZA==' },
  })
  await assert.rejects(verifyCosReadOnlyAccess({
    cos: {
      getBucketVersioning: async () => { throw error },
      headObject: async () => { objectCalls++; return {} },
      getObject: async () => { objectCalls++; return {} },
    },
    bucket: 'ecfc-1306412725',
    region: 'ap-guangzhou',
    log: (line) => logs.push(line),
  }), /COS_GET_BUCKET_VERSIONING_FAILED/)
  assert.equal(objectCalls, 0)
  assert.match(logs.join('\n'), /code=AccessDenied status=403 request_id=/)
  assert.doesNotMatch(logs.join('\n'), /secret and provider data/)
})

test('read-only COS gate rejects a HEAD or Range GET response with an unexpected HTTP status', async () => {
  let getCalls = 0
  await assert.rejects(verifyCosReadOnlyAccess({
    cos: {
      getBucketVersioning: async () => ({ VersioningConfiguration: {} }),
      headObject: async () => ({ statusCode: 206, headers: { 'content-length': '180263015' } }),
      getObject: async () => { getCalls++; return { statusCode: 206, Body: Buffer.from([0]) } },
    },
    bucket: 'ecfc-1306412725',
    region: 'ap-guangzhou',
    log: () => {},
  }), /COS_CODE32_HEAD_MISMATCH/)
  assert.equal(getCalls, 0)
})

test('read-only gate exchanges OIDC for a two-hour STS lease and never logs credentials', async () => {
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: ['sts.tencentcloudapi.com'],
    sub: 'repo:andkdiids/EasonFansClub:environment:Production:workflow_ref:andkdiids/EasonFansClub/.github/workflows/publish-android-rc11.yml@refs/heads/main',
    environment: 'Production',
    repository: 'andkdiids/EasonFansClub',
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    workflow_ref: 'andkdiids/EasonFansClub/.github/workflows/publish-android-rc11.yml@refs/heads/main',
  }
  const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  const env = {
    TENCENT_CAM_OIDC_AUDIENCE: 'sts.tencentcloudapi.com',
    TENCENT_EXPECTED_OIDC_SUBJECT: claims.sub,
    TENCENT_CAM_PROVIDER_ID: 'configured-provider',
    TENCENT_CAM_ROLE_ARN: 'qcs::cam::uin/1306412725:roleName/rc13-release',
    TENCENT_STS_REGION: 'ap-guangzhou',
    TENCENT_COS_BUCKET: 'ecfc-1306412725',
    TENCENT_COS_REGION: 'ap-guangzhou',
    GITHUB_WORKFLOW_REF: claims.workflow_ref,
    GITHUB_RUN_ID: '987654321',
    GITHUB_RUN_ATTEMPT: '1',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/request',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token-secret',
  }
  const calls = []
  const logs = []
  const expiry = 1_900_000_000
  const fetchImpl = async (input, init) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://pipelines.actions.githubusercontent.com/')) return new Response(JSON.stringify({ value: jwt }), { status: 200 })
    assert.equal(url, 'https://sts.tencentcloudapi.com')
    assert.equal(JSON.parse(String(init.body)).DurationSeconds, 7200)
    return new Response(JSON.stringify({ Response: {
      Credentials: { TmpSecretId: 'temporary-id-secret', TmpSecretKey: 'temporary-key-secret', Token: 'session-token-secret' },
      ExpiredTime: expiry,
    } }), { status: 200 })
  }
  const cosFactory = (credentials) => {
    assert.equal(credentials.ExpiredTime, expiry)
    assert.equal(credentials.SecretId, 'temporary-id-secret')
    return {
      getBucketVersioning: async () => ({ VersioningConfiguration: {} }),
      headObject: async () => ({ statusCode: 200, headers: { 'Content-Length': '180263015' } }),
      getObject: async ({ Range }) => Range === 'bytes=0-0' ? { statusCode: 206, Body: Buffer.from([0]) } : { statusCode: 200, Body: Buffer.alloc(0) },
    }
  }
  const result = await verifyCosReadOnly({ env, fetchImpl, cosFactory, log: (line) => logs.push(line), now: () => 1_800_000_000_000 })
  assert.equal(result.versioning, 'DISABLED')
  assert.equal(calls.length, 2)
  assert.ok(calls[0].startsWith('https://pipelines.actions.githubusercontent.com/request?audience=sts.tencentcloudapi.com'))
  assert.equal(calls[1], 'https://sts.tencentcloudapi.com')
  assert.match(logs.join('\n'), /TENCENT_STS_EXPIRED_TIME=2030-03-17T17:46:40\.000Z/)
  assert.match(logs.join('\n'), /COS_BUCKET_VERSIONING_RESPONSE=\{"VersioningConfiguration":\{\}\}/)
  assert.match(logs.join('\n'), /CAM_ROLE=ASSUMED COS_BUCKET=ecfc-1306412725 COS_REGION=ap-guangzhou/)
  assert.doesNotMatch(logs.join('\n'), /temporary-id-secret|temporary-key-secret|session-token-secret|request-token-secret/)
})

test('both multipart boundaries receive the forbid-overwrite condition', async () => fixture(async (filePath) => {
  const observed = []
  const cos = mockCos({ request: async (p) => { observed.push(p.Headers); return p.Action === 'uploads' ? { InitiateMultipartUploadResult: { UploadId: 'owned-id' } } : { CompleteMultipartUploadResult: { ETag: 'abc123' } } } })
  await multipartUpload(args(cos, filePath))
  assert.equal(observed.length, 2)
  for (const headers of observed) assert.equal(headers['x-cos-forbid-overwrite'], 'true')
}))

test('multipart upload refuses to initiate with less than fifteen minutes of STS lifetime', async () => fixture(async (filePath) => {
  let calls = 0
  const cos = mockCos({
    getBucketVersioning: async () => { calls++; return { VersioningConfiguration: {} } },
    request: async () => { calls++; return { InitiateMultipartUploadResult: { UploadId: 'owned-id' } } },
  })
  const expiresAtSeconds = Math.floor((Date.now() + 14 * 60 * 1000) / 1000)
  await assert.rejects(multipartUpload({ ...args(cos, filePath), credentialsExpiredTime: expiresAtSeconds }), /TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME/)
  assert.equal(calls, 0)
}))

test('multipart upload never completes after STS expiry and aborts only its current UploadId', async () => fixture(async (filePath) => {
  const start = Date.now()
  const expiresAtSeconds = Math.floor((start + 30 * 60 * 1000) / 1000)
  let now = start
  let versioningCalls = 0
  let completes = 0
  const aborted = []
  const clock = { now: () => now, setInterval: () => 1, clearInterval: () => {} }
  const cos = mockCos({
    getBucketVersioning: async () => {
      versioningCalls++
      if (versioningCalls === 2) now = expiresAtSeconds * 1000 + 1
      return { VersioningConfiguration: {} }
    },
    request: async (p) => {
      if (p.Action === 'uploads') return { InitiateMultipartUploadResult: { UploadId: 'task-owned-id' } }
      completes++
      return { CompleteMultipartUploadResult: { ETag: 'abc123' } }
    },
    multipartAbort: async (p) => { aborted.push(p.UploadId) },
  })
  await assert.rejects(multipartUpload({
    ...args(cos, filePath),
    credentialsExpiredTime: expiresAtSeconds,
    clock,
  }), /TENCENT_STS_CREDENTIALS_EXPIRED_BEFORE_COMPLETE/)
  assert.equal(completes, 0)
  assert.deepEqual(aborted, ['task-owned-id'])
}))

test('failed parts retry and abort only the owned upload', async () => fixture(async (filePath) => {
  let attempts = 0
  const aborted = []
  const cos = mockCos({ multipartUpload: async () => { attempts++; throw new Error('interrupted') }, multipartAbort: async (p) => { aborted.push(p.UploadId) } })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_MULTIPART_UPLOAD_FAILED/)
  assert.equal(attempts, 3)
  assert.deepEqual(aborted, ['owned-id'])
}))

test('large files use three bounded concurrent 8 MiB parts', async () => fixture(async (filePath) => {
  const size = 17 * 1024 * 1024
  await writeFile(filePath, Buffer.alloc(size))
  let active = 0; let peak = 0
  const lengths = []
  const cos = mockCos({ multipartUpload: async (part) => {
    active++; peak = Math.max(peak, active); lengths.push(part.ContentLength)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active--; return { ETag: 'abc123' }
  } })
  await multipartUpload({ ...args(cos, filePath), size })
  assert.equal(peak, 3)
  assert.deepEqual(lengths.sort((a, b) => b - a), [8 * 1024 * 1024, 8 * 1024 * 1024, 1024 * 1024])
}))

test('concurrent failures abort only their own UploadId', async () => fixture(async (filePath) => {
  const aborted = []
  const cos = mockCos({ request: async (p) => ({ InitiateMultipartUploadResult: { UploadId: `id-${p.Key}` } }), multipartUpload: async () => { throw new Error('interrupted') }, multipartAbort: async (p) => { aborted.push([p.Key, p.UploadId]) } })
  const results = await Promise.allSettled(['one', 'two'].map((key) => multipartUpload({ ...args(cos, filePath), key })))
  assert.ok(results.every((result) => result.status === 'rejected'))
  assert.deepEqual(aborted.sort(), [['one', 'id-one'], ['two', 'id-two']])
}))

test('stalled upload warns at 60 seconds, aborts promptly, and cleans again after active parts settle', async () => fixture(async (filePath) => {
  let now = 0; let tick; let rejectPart; let started
  const logs = []; const aborted = []; const events = []
  const ready = new Promise((resolve) => { started = resolve })
  const clock = { now: () => now, setInterval: (fn) => { tick = fn; return 1 }, clearInterval: () => {} }
  const cos = mockCos({ multipartUpload: async () => { started(); return new Promise((resolve, reject) => { rejectPart = reject }) }, multipartAbort: async (p) => { events.push(`abort-${aborted.length + 1}`); aborted.push(p.UploadId) } })
  const upload = multipartUpload({ ...args(cos, filePath), clock, log: (line) => logs.push(line) })
  await ready
  now = 60000; tick()
  assert.ok(logs.some((line) => line.includes('STALLED=YES')))
  now = 300000; tick()
  assert.ok(logs.some((line) => line.includes('COS_UPLOAD_STALLED_ABORT=START')))
  assert.deepEqual(aborted, ['owned-id'])
  events.push('part-settled')
  rejectPart(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT', statusCode: 504 }))
  await assert.rejects(upload, /COS_MULTIPART_UPLOAD_FAILED/)
  assert.deepEqual(aborted, ['owned-id', 'owned-id'])
  assert.deepEqual(events, ['abort-1', 'part-settled', 'abort-2'])
}))

test('ambiguous completion is checked and never blindly retried or aborted', async () => fixture(async (filePath) => {
  let completes = 0; let heads = 0; let aborts = 0
  const cos = mockCos({ request: async (p) => { if (p.Action === 'uploads') return { InitiateMultipartUploadResult: { UploadId: 'owned-id' } }; completes++; throw new Error('timeout') }, headObject: async () => { heads++; return { statusCode: 200 } }, multipartAbort: async () => { aborts++ } })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_COMPLETE_UNCERTAIN/)
  assert.deepEqual([completes, heads, aborts], [1, 1, 0])
}))

test('ambiguous completion cannot pass when CDN SHA verification fails', async () => fixture(async (filePath) => {
  const sha256 = 'A'.repeat(64)
  let heads = 0; let reads = 0
  const cos = mockCos({
    request: async (p) => { if (p.Action === 'uploads') return { InitiateMultipartUploadResult: { UploadId: 'owned-id' } }; throw new Error('timeout') },
    headObject: async () => {
      heads++
      if (heads === 1) throw { statusCode: 404 }
      return { statusCode: 200, headers: { 'content-length': '1024', 'content-type': 'application/vnd.android.package-archive', 'cache-control': 'public, max-age=31536000, immutable', 'x-cos-meta-sha256': sha256 } }
    },
  })
  await assert.rejects(uploadImmutableObject({ cos, env: { TENCENT_COS_BUCKET: 'bucket', TENCENT_COS_REGION: 'region' }, key: 'unique', filePath, expected: { size: 1024, sha256 }, stage: 'TEST', downloadCos: async () => {}, downloadFile: async (url, dest, expected) => { reads++; assert.equal(expected.expectedSha256, sha256); throw new Error('APK_SHA256_MISMATCH') } }), /APK_SHA256_MISMATCH/)
  assert.equal(reads, 1)
}))

test('completion conflict aborts only its own upload and never accepts the existing object', async () => fixture(async (filePath) => {
  const aborted = []; let reads = 0
  const cos = mockCos({ request: async (p) => { if (p.Action === 'uploads') return { InitiateMultipartUploadResult: { UploadId: 'owned-id' } }; throw { statusCode: 409, code: 'FileAlreadyExists' } }, multipartAbort: async (p) => { aborted.push(p.UploadId) }, headObject: async () => { reads++; return { statusCode: 200 } } })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_OBJECT_KEY_ALREADY_EXISTS/)
  assert.deepEqual(aborted, ['owned-id'])
  assert.equal(reads, 0)
}))

test('a COS complete error envelope preserves the conflict code and aborts only its UploadId', async () => fixture(async (filePath) => {
  const aborted = []; let reads = 0
  const cos = mockCos({
    request: async (p) => p.Action === 'uploads'
      ? { InitiateMultipartUploadResult: { UploadId: 'owned-id' } }
      : { Error: { Code: 'FileAlreadyExists' }, statusCode: 200, headers: { 'x-cos-request-id': 'request-id-test-123456789012' } },
    multipartAbort: async (p) => { aborted.push(p.UploadId) },
    headObject: async () => { reads++; return { statusCode: 200 } },
  })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_OBJECT_KEY_ALREADY_EXISTS/)
  assert.deepEqual(aborted, ['owned-id'])
  assert.equal(reads, 0)
}))

test('local Complete XML validation failure aborts the owned UploadId without treating it as ambiguous', async () => fixture(async (filePath) => {
  let requestCount = 0; const aborted = []
  const cos = mockCos({
    request: async () => { requestCount++; return { InitiateMultipartUploadResult: { UploadId: 'owned-id' } } },
    multipartUpload: async () => ({ ETag: 'invalid*etag' }),
    multipartAbort: async (p) => { aborted.push(p.UploadId) },
  })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_MULTIPART_UPLOAD_FAILED/)
  assert.equal(requestCount, 1)
  assert.deepEqual(aborted, ['owned-id'])
}))

test('CDN readback rejects an APK with incorrect SHA-256', async () => fixture(async (filePath) => {
  const body = new Response(Buffer.alloc(1024)).body
  await assert.rejects(downloadToFile('https://cdn.example.test/file', `${filePath}.readback`, { expectedSize: 1024, expectedSha256: 'A'.repeat(64), logImpl: () => {}, fetchImpl: async () => ({ ok: true, status: 200, url: 'https://cdn.example.test/file', body }) }), /APK_SHA256_MISMATCH/)
}))

test('COS origin readback hashes complete bytes and rejects a mismatch', async () => fixture(async (filePath) => {
  const data = Buffer.from('cos-origin')
  const sha256 = createHash('sha256').update(data).digest('hex').toUpperCase()
  const cos = { getObject: async ({ Output }) => new Promise((resolve, reject) => { Output.on('finish', resolve); Output.on('error', reject); Output.end(data) }) }
  const base = { cos, bucket: 'bucket', region: 'region', key: 'key' }
  await downloadCosObject({ ...base, filePath: `${filePath}.origin`, expected: { size: data.length, sha256 } })
  await assert.rejects(downloadCosObject({ ...base, filePath: `${filePath}.bad`, expected: { size: data.length, sha256: 'A'.repeat(64) } }), /COS_READBACK_SHA256_MISMATCH/)
}))

test('SDK downloads and hashes full COS-origin response over HTTP', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  const data = Buffer.from('actual-sdk-cos-response')
  const sha256 = createHash('sha256').update(data).digest('hex').toUpperCase()
  const server = http.createServer((req, res) => { res.setHeader('Content-Length', data.length); res.end(data) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 5000 })
    await downloadCosObject({ cos, bucket: 'example-1234567890', region: 'ap-guangzhou', key: 'key', filePath: `${filePath}.real-origin`, expected: { size: data.length, sha256 } })
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('versioned or unknown buckets are rejected before initiation', async () => fixture(async (filePath) => {
  let initiated = false
  const cos = mockCos({ getBucketVersioning: async () => ({ VersioningConfiguration: { Status: 'Enabled' } }), request: async () => { initiated = true } })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_BUCKET_VERSIONING_UNSUPPORTED/)
  assert.equal(initiated, false)
}))

test('SDK sends signed forbid-overwrite headers over HTTP for init and complete', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers })
    req.resume()
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.url.includes('versioning')) return res.end('<VersioningConfiguration/>')
      if (req.url.includes('uploads')) return res.end('<InitiateMultipartUploadResult><UploadId>own123</UploadId></InitiateMultipartUploadResult>')
      if (req.method === 'PUT') { res.setHeader('ETag', '"abc123"'); return res.end('') }
      if (req.url.includes('uploadId')) return res.end('<CompleteMultipartUploadResult><ETag>"abc123"</ETag></CompleteMultipartUploadResult>')
      res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 5000 })
    await multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou' })
    const init = seen.find((x) => x.url.includes('uploads'))
    const complete = seen.find((x) => x.method === 'POST' && x.url.includes('uploadId'))
    assert.equal(init.headers['x-cos-forbid-overwrite'], 'true')
    assert.equal(complete.headers['x-cos-forbid-overwrite'], 'true')
    assert.equal(init.headers['x-cos-meta-sha256'], 'A'.repeat(64))
    assert.equal(init.headers['content-type'], 'application/vnd.android.package-archive')
    assert.equal(init.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.ok(init.headers.authorization)
    assert.ok(complete.headers.authorization)
    assert.match(init.headers.authorization, /x-cos-forbid-overwrite/)
    assert.match(complete.headers.authorization, /x-cos-forbid-overwrite/)
    assert.ok(seen.some((x) => x.method === 'PUT' && x.url.includes('partNumber')))
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('concurrent complete requests cannot replace an existing object', async () => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let object = Buffer.from('original')
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.headers['x-cos-forbid-overwrite'] === 'true' && object) {
        res.statusCode = 409
        return res.end('<Error><Code>FileAlreadyExists</Code><Message>conflict</Message></Error>')
      }
      object = Buffer.concat(chunks)
      res.end('<CompleteMultipartUploadResult><ETag>"new-object"</ETag></CompleteMultipartUploadResult>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 5000 })
    const base = { Bucket: 'example-1234567890', Region: 'ap-guangzhou', Key: 'same-key' }
    const results = await Promise.allSettled(['own-1', 'own-2'].map((id) => completeOnce(cos, base, id, [{ PartNumber: 1, ETag: 'abc123' }])))
    assert.ok(results.every((result) => result.status === 'rejected'))
    assert.equal(requests, 2)
    assert.equal(object.toString(), 'original')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('two completions for a new key produce one winner and one conflict', async () => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let object
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.headers['x-cos-forbid-overwrite'] !== 'true') { res.statusCode = 400; return res.end('<Error><Code>MissingCondition</Code></Error>') }
      if (object) { res.statusCode = 409; return res.end('<Error><Code>FileAlreadyExists</Code></Error>') }
      object = req.url
      res.end('<CompleteMultipartUploadResult><ETag>"abc123"</ETag></CompleteMultipartUploadResult>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 5000 })
    const base = { Bucket: 'example-1234567890', Region: 'ap-guangzhou', Key: 'same-key' }
    const results = await Promise.allSettled(['own-1', 'own-2'].map((id) => completeOnce(cos, base, id, [{ PartNumber: 1, ETag: 'abc123' }])))
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('completion connection loss sends exactly one signed request', async () => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let requests = 0
  const server = http.createServer((req) => { requests++; req.socket.destroy() })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 1000 })
    await assert.rejects(completeOnce(cos, { Bucket: 'example-1234567890', Region: 'ap-guangzhou', Key: 'key' }, 'own-1', [{ PartNumber: 1, ETag: 'abc123' }]))
    assert.equal(requests, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('initialization connection loss is not replayed and is reported uncertain', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let inits = 0; let aborts = 0
  const server = http.createServer((req, res) => {
    if (req.url.includes('uploads')) { inits++; return req.socket.destroy() }
    if (req.method === 'DELETE') aborts++
    req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<VersioningConfiguration/>') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 1000 })
    await assert.rejects(multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou' }), /COS_MULTIPART_INIT_UNCERTAIN/)
    assert.equal(inits, 1)
    assert.equal(aborts, 0)
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('SDK retries interrupted parts at most three times and aborts the owned upload', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let parts = 0; const aborted = []
  const server = http.createServer((req, res) => {
    if (req.method === 'PUT') { parts++; return req.socket.destroy() }
    req.resume()
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.url.includes('versioning')) return res.end('<VersioningConfiguration/>')
      if (req.url.includes('uploads')) return res.end('<InitiateMultipartUploadResult><UploadId>owned-id</UploadId></InitiateMultipartUploadResult>')
      if (req.method === 'DELETE') { aborted.push(new URL(req.url, 'http://localhost').searchParams.get('uploadId')); res.statusCode = 204; return res.end() }
      res.statusCode = 500; res.end('<Error><Code>Unexpected</Code></Error>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 1000 })
    await assert.rejects(multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou' }), /COS_MULTIPART_UPLOAD_FAILED/)
    assert.equal(parts, 3)
    assert.deepEqual(aborted, ['owned-id'])
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('error diagnostics do not expose messages or credentials', () => {
  const secret = 'private-secret-token'
  const output = safeCosError({ code: secret, message: secret, headers: { authorization: secret } })
  assert.doesNotMatch(output, /private-secret-token/)
})
