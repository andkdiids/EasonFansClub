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
import { CODE32_ROLLBACK_OBJECT_KEY } from '../scripts/android-rc13-release.mjs'

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

test('read-only COS gate verifies bucket versioning and authenticated HEAD, then reads the rollback object via the HTTPS custom domain', async () => {
  const calls = []
  const logs = []
  const rangeUrl = 'https://media.ecfc.fans/media/' + CODE32_ROLLBACK_OBJECT_KEY
  let rangeInit
  const cos = {
    getBucketVersioning: async (options) => { calls.push(['versioning', options]); return { VersioningConfiguration: {} } },
    headObject: async (options) => { calls.push(['head', options]); return { statusCode: 200, headers: { 'content-length': '180263015' } } },
  }
  const fetchImpl = async (input, init) => {
    assert.equal(String(input), rangeUrl)
    rangeInit = init
    const response = new Response(Uint8Array.of(0), {
      status: 206,
      headers: { 'content-length': '1', 'content-range': 'bytes 0-0/180263015' },
    })
    Object.defineProperty(response, 'url', { value: rangeUrl })
    return response
  }
  const result = await verifyCosReadOnlyAccess({
    cos,
    bucket: 'ecfc-1306412725',
    region: 'ap-guangzhou',
    log: (line) => logs.push(line),
    fetchImpl,
  })
  assert.deepEqual(calls.map(([method]) => method), ['versioning', 'head'])
  assert.equal(calls[1][1].Key, CODE32_ROLLBACK_OBJECT_KEY)
  assert.equal(rangeInit.method, 'GET')
  assert.deepEqual(rangeInit.headers, { Range: 'bytes=0-0' })
  assert.equal(rangeInit.redirect, 'error')
  assert.equal(new Headers(rangeInit.headers).has('authorization'), false)
  assert.equal(result.versioning, 'DISABLED')
  assert.equal(result.customDomainRangeGet, 'PASS')
  assert.match(logs.join('\n'), /COS_BUCKET_VERSIONING_RESPONSE=\{"VersioningConfiguration":\{\}\}/)
  assert.match(logs.join('\n'), /CustomDomainRangeGet=PASS/)
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
  assert.match(logs.join('\n'), /request_type=GetBucketVersioning method=GET http_status=403 cos_code=AccessDenied/)
  assert.match(logs.join('\n'), /request_id=NWQ1NTRhMWRfODhjMjJhMDlfMWNkOF8xZTRmYWJjZA==/)
  assert.doesNotMatch(logs.join('\n'), /secret and provider data/)
})

test('COS failure diagnostics include request and response fields without leaking secrets', () => {
  const requestId = 'NmFlYjQyNjVfOGU1NTdiMGJfZWQ4MV83MTJhNGJh'
  const error = Object.assign(new Error('authorization must not be logged'), {
    code: '403',
    statusCode: 403,
    headers: {
      'X-COS-Request-ID': requestId,
      Authorization: 'Bearer fake-authorization-secret',
    },
    error: {
      Code: 'AccessDenied',
      Message: 'Access denied: https://cos.example.test/object?sign=opaque Authorization: Bearer fake-session-token q-signature=opaque-signature',
    },
  })
  const output = safeCosError(error, { requestType: 'GetObject', method: 'GET' })
  assert.match(output, /request_type=GetObject method=GET http_status=403 cos_code=AccessDenied/)
  assert.match(output, new RegExp(`request_id=${requestId}`))
  assert.match(output, /response=Access denied: \[REDACTED_URL\] Authorization=\[REDACTED\]/)
  assert.doesNotMatch(output, /fake-authorization-secret|fake-session-token|opaque-signature|cos\.example\.test|sign=opaque/)
  const longCredentialCode = safeCosError({ error: { Code: 'private-session-secret-value-that-must-not-appear' } })
  assert.match(longCredentialCode, /cos_code=UNKNOWN/)
  assert.doesNotMatch(longCredentialCode, /private-session-secret/)
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
      getObject: async ({ Headers }) => Headers?.Range === 'bytes=0-0' ? { statusCode: 206, Body: Buffer.from([0]) } : { statusCode: 200, Body: Buffer.alloc(0) },
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
  const cos = mockCos({ multipartUpload: async () => { attempts++; throw Object.assign(new Error('interrupted'), { code: 'ECONNRESET' }) }, multipartAbort: async (p) => { aborted.push(p.UploadId) } })
  await assert.rejects(multipartUpload(args(cos, filePath)), /COS_MULTIPART_UPLOAD_FAILED/)
  assert.equal(attempts, 3)
  assert.deepEqual(aborted, ['owned-id'])
}))

test('large files use three bounded concurrent 8 MiB parts', async () => fixture(async (filePath) => {
  const size = 17 * 1024 * 1024
  await writeFile(filePath, Buffer.alloc(size))
  let active = 0; let peak = 0
  const lengths = []
  let releaseAllParts
  let timeout
  const allPartsStarted = new Promise((resolve) => { releaseAllParts = resolve })
  const allPartsGate = Promise.race([
    allPartsStarted,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('COS_PART_CONCURRENCY_NOT_REACHED')), 1000) }),
  ]).finally(() => clearTimeout(timeout))
  const cos = mockCos({ multipartUpload: async (part) => {
    active++; peak = Math.max(peak, active); lengths.push(part.ContentLength)
    if (active === 3) releaseAllParts()
    await allPartsGate
    await new Promise((resolve) => setTimeout(resolve, 20))
    active--; return { ETag: 'abc123' }
  } })
  await multipartUpload({ ...args(cos, filePath), size })
  assert.equal(peak, 3)
  assert.deepEqual(lengths.sort((a, b) => b - a), [8 * 1024 * 1024, 8 * 1024 * 1024, 1024 * 1024])
}))

test('configured concurrency one keeps only one 8 MiB part in flight', async () => fixture(async (filePath) => {
  const size = 17 * 1024 * 1024
  await writeFile(filePath, Buffer.alloc(size))
  let active = 0; let peak = 0; const lengths = []
  const cos = mockCos({ multipartUpload: async (part) => {
    active++; peak = Math.max(peak, active); lengths.push(part.ContentLength)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--; return { ETag: 'abc123' }
  } })
  await multipartUpload({ ...args(cos, filePath), size, concurrency: 1 })
  assert.equal(peak, 1)
  assert.deepEqual(lengths, [8 * 1024 * 1024, 8 * 1024 * 1024, 1024 * 1024])
}))

test('concurrent failures abort only their own UploadId', async () => fixture(async (filePath) => {
  const aborted = []
  const cos = mockCos({ request: async (p) => ({ InitiateMultipartUploadResult: { UploadId: `id-${p.Key}` } }), multipartUpload: async () => { throw new Error('interrupted') }, multipartAbort: async (p) => { aborted.push([p.Key, p.UploadId]) } })
  const results = await Promise.allSettled(['one', 'two'].map((key) => multipartUpload({ ...args(cos, filePath), key })))
  assert.ok(results.every((result) => result.status === 'rejected'))
  assert.deepEqual(aborted.sort(), [['one', 'id-one'], ['two', 'id-two']])
}))

test('stalled upload warns at 60 seconds, cancels requests, then aborts after active parts settle', async () => fixture(async (filePath) => {
  let now = 0; let tick; let rejectPart; let started; const activeTaskIds = new Set()
  const logs = []; const aborted = []; const events = []
  const ready = new Promise((resolve) => { started = resolve })
  const clock = { now: () => now, setInterval: (fn) => { tick = fn; return 1 }, clearInterval: () => {} }
  const cos = mockCos({
    options: {},
    _isRunningTask: (id) => activeTaskIds.has(id),
    emit: (event, info) => {
      if (event === 'inner-kill-task') { events.push(`cancel-${info.TaskId}`); rejectPart(Object.assign(new Error('request canceled'), { code: 'ECONNRESET' })) }
    },
    multipartUpload: async (part) => {
      activeTaskIds.add(part.TaskId)
      part.Body.resume()
      started()
      return new Promise((resolve, reject) => { rejectPart = reject }).finally(() => events.push('part-settled'))
    },
    multipartAbort: async (p) => { events.push(`abort-${aborted.length + 1}`); aborted.push(p.UploadId) },
  })
  const upload = multipartUpload({ ...args(cos, filePath), clock, log: (line) => logs.push(line) })
  await ready
  await new Promise((resolve) => setImmediate(resolve))
  now = 60000; tick()
  assert.ok(logs.some((line) => line.includes('STALLED=YES')))
  assert.ok(logs.some((line) => line.includes('progress_source=SDK_SOCKET_CALLBACK') && line.includes('body_stream_emitted_bytes=1024') && line.includes('cos_acknowledged_part_bytes=0')))
  now = 300000; tick()
  assert.ok(logs.some((line) => line.includes('COS_UPLOAD_STALLED_CANCEL=START')))
  assert.equal(aborted.length, 0)
  await assert.rejects(upload, /COS_MULTIPART_UPLOAD_STALLED/)
  assert.deepEqual(aborted, ['owned-id'])
  assert.equal(events.length, 3)
  assert.match(events[0], /^cancel-rc13-part-/)
  assert.deepEqual(events.slice(1), ['part-settled', 'abort-1'])
}))

test('UserNetworkTooSlow is terminal and does not retry a part', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let partRequests = 0; let aborts = 0
  const logs = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.url.includes('versioning')) return res.end('<VersioningConfiguration/>')
      if (req.url.includes('uploads')) return res.end('<InitiateMultipartUploadResult><UploadId>network-slow-id</UploadId></InitiateMultipartUploadResult>')
      if (req.method === 'PUT') {
        partRequests++
        assert.equal(Buffer.concat(chunks).length, 1024)
        res.statusCode = 400
        return res.end('<Error><Code>UserNetworkTooSlow</Code><Message>slow</Message></Error>')
      }
      if (req.method === 'DELETE') { aborts++; res.statusCode = 204; return res.end() }
      res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 2000 })
    await assert.rejects(multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou', log: (line) => logs.push(line) }), /COS_MULTIPART_PART_NON_RETRYABLE_UserNetworkTooSlow/)
    assert.equal(partRequests, 1)
    assert.equal(aborts, 1)
    assert.match(logs.join('\n'), /retry_class=NON_RETRYABLE cos_code=UserNetworkTooSlow/)
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('multipart failure diagnostics allowlist internal codes and suppress arbitrary uppercase messages', async () => fixture(async (filePath) => {
  const logs = []
  const secret = 'TMP_SECRET_ABCDEFGHIJKLMNOPQRSTUVWX'
  const cos = mockCos({ multipartUpload: async () => { throw Object.assign(new Error(secret), { code: 'UserNetworkTooSlow' }) } })
  await assert.rejects(multipartUpload({ ...args(cos, filePath), log: (line) => logs.push(line) }), /COS_MULTIPART_PART_NON_RETRYABLE_UserNetworkTooSlow/)
  assert.match(logs.join('\n'), /COS_MULTIPART_FAILURE reason=UNKNOWN/)
  assert.doesNotMatch(logs.join('\n'), new RegExp(secret))
}))

test('slow HTTP body consumption can finish with exact Content-Length', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let received = 0; const logs = []
  const server = http.createServer((req, res) => {
    if (req.url.includes('versioning')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<VersioningConfiguration/>') }); return }
    if (req.url.includes('uploads')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<InitiateMultipartUploadResult><UploadId>slow-id</UploadId></InitiateMultipartUploadResult>') }); return }
    if (req.method === 'PUT') {
      assert.equal(req.headers['content-length'], '1024')
      req.pause()
      setTimeout(() => req.resume(), 30)
      req.on('data', (chunk) => { received += chunk.length })
      req.on('end', () => { res.setHeader('ETag', '"abc123"'); res.end('') })
      return
    }
    req.resume()
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.method === 'POST' && req.url.includes('uploadId')) return res.end('<CompleteMultipartUploadResult><ETag>"abc123"</ETag></CompleteMultipartUploadResult>')
      if (req.method === 'DELETE') { res.statusCode = 204; return res.end() }
      res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 2000 })
    try { await multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou', log: (line) => logs.push(line) }) }
    catch (error) { throw new Error(`${error.message}; ${logs.join(' | ')}`) }
    assert.equal(received, 1024)
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('COS SDK sends exact signed lengths for full 8 MiB parts and final tail', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  const size = 17 * 1024 * 1024
  await writeFile(filePath, Buffer.alloc(size))
  const partsSeen = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.searchParams.has('versioning')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<VersioningConfiguration/>') }); return }
    if (url.searchParams.has('uploads')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<InitiateMultipartUploadResult><UploadId>length-check-id</UploadId></InitiateMultipartUploadResult>') }); return }
    if (req.method === 'PUT') {
      const hash = createHash('sha256'); let bodyBytes = 0
      req.on('data', (chunk) => { bodyBytes += chunk.length; hash.update(chunk) })
      req.on('end', () => {
        partsSeen.push({ partNumber: Number(url.searchParams.get('partNumber')), contentLength: req.headers['content-length'], transferEncoding: req.headers['transfer-encoding'], bodyBytes, bodySha256: hash.digest('hex'), signedHeaders: /q-header-list=([^&]+)/.exec(req.headers.authorization || '')?.[1] || '' })
        res.setHeader('ETag', '"abc123"'); res.end('')
      })
      return
    }
    req.resume()
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/xml')
      if (req.method === 'POST' && url.searchParams.has('uploadId')) return res.end('<CompleteMultipartUploadResult><ETag>"abc123"</ETag></CompleteMultipartUploadResult>')
      if (req.method === 'DELETE') { res.statusCode = 204; return res.end() }
      res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 5000 })
    await multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou', size, sha256: 'A'.repeat(64), log: () => {} })
    assert.deepEqual(partsSeen.map((part) => part.bodyBytes).sort((a, b) => b - a), [8 * 1024 * 1024, 8 * 1024 * 1024, 1024 * 1024])
    for (const part of partsSeen) {
      assert.equal(Number(part.contentLength), part.bodyBytes)
      assert.equal(part.transferEncoding, undefined)
      assert.match(part.signedHeaders, /(^|;)content-length($|;)/)
      assert.equal(part.bodySha256, createHash('sha256').update(Buffer.alloc(part.bodyBytes)).digest('hex'))
    }
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}))

test('SDK socket timeout is bounded, retries only the owned part, and aborts the UploadId', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let partRequests = 0; let aborts = 0
  const server = http.createServer((req, res) => {
    if (req.url.includes('versioning')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<VersioningConfiguration/>') }); return }
    if (req.url.includes('uploads')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<InitiateMultipartUploadResult><UploadId>timeout-id</UploadId></InitiateMultipartUploadResult>') }); return }
    if (req.method === 'PUT') { partRequests++; req.resume(); req.on('end', () => {}) ; return }
    if (req.method === 'DELETE') { aborts++; req.resume(); req.on('end', () => { res.statusCode = 204; res.end() }); return }
    req.resume(); req.on('end', () => { res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 100 })
    await assert.rejects(multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou' }), /COS_MULTIPART_UPLOAD_FAILED/)
    assert.equal(partRequests, 3)
    assert.equal(aborts, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
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
  await assert.rejects(uploadImmutableObject({ cos, env: { TENCENT_COS_BUCKET: 'bucket', TENCENT_COS_REGION: 'region' }, key: CODE32_ROLLBACK_OBJECT_KEY, filePath, expected: { size: 1024, sha256 }, stage: 'TEST', downloadFile: async (url, dest, expected) => { reads++; assert.equal(expected.expectedSha256, sha256); throw new Error('APK_SHA256_MISMATCH') } }), /APK_SHA256_MISMATCH/)
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

test('custom-domain readback hashes complete bytes and rejects a mismatch', async () => fixture(async (filePath) => {
  const data = Buffer.from('custom-domain')
  const sha256 = createHash('sha256').update(data).digest('hex').toUpperCase()
  const key = CODE32_ROLLBACK_OBJECT_KEY
  const url = 'https://media.ecfc.fans/media/' + key
  let calls = 0
  const fetchImpl = async (input) => {
    calls++
    assert.equal(String(input), url)
    const response = new Response(data, { status: 200, headers: { 'content-length': String(data.length) } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  await downloadCosObject({ key, filePath: `${filePath}.readback`, expected: { size: data.length, sha256 }, fetchImpl })
  await assert.rejects(downloadCosObject({
    key,
    filePath: `${filePath}.bad`,
    expected: { size: data.length, sha256: 'A'.repeat(64) },
    fetchImpl,
  }), /APK_SHA256_MISMATCH/)
  assert.equal(calls, 2)
}))

test('custom-domain readback rejects a forbidden download response', async () => fixture(async (filePath) => {
  const key = CODE32_ROLLBACK_OBJECT_KEY
  const url = 'https://media.ecfc.fans/media/' + key
  let requestInit
  await assert.rejects(downloadCosObject({
    key,
    filePath: `${filePath}.forbidden`,
    expected: { size: 1024, sha256: 'A'.repeat(64) },
    fetchImpl: async (input, init) => {
      assert.equal(String(input), url)
      requestInit = init
      const response = new Response('DownloadForbidden', { status: 403 })
      Object.defineProperty(response, 'url', { value: url })
      return response
    },
  }), /APK_DOWNLOAD_FAILED/)
  assert.equal(requestInit.redirect, 'error')
  assert.equal(new Headers(requestInit.headers).has('authorization'), false)
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
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, bodyBytes: body.length, bodySha256: createHash('sha256').update(body).digest('hex') })
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
    const part = seen.find((x) => x.method === 'PUT' && x.url.includes('partNumber'))
    assert.equal(init.headers['x-cos-forbid-overwrite'], 'true')
    assert.equal(complete.headers['x-cos-forbid-overwrite'], 'true')
    assert.equal(init.headers['x-cos-meta-sha256'], 'A'.repeat(64))
    assert.equal(init.headers['content-type'], 'application/vnd.android.package-archive')
    assert.equal(init.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.ok(init.headers.authorization)
    assert.ok(complete.headers.authorization)
    assert.match(init.headers.authorization, /x-cos-forbid-overwrite/)
    assert.match(complete.headers.authorization, /x-cos-forbid-overwrite/)
    assert.ok(part)
    assert.equal(part.headers['content-length'], '1024')
    assert.equal(part.headers['transfer-encoding'], undefined)
    assert.equal(part.bodyBytes, 1024)
    assert.equal(part.bodySha256, createHash('sha256').update(Buffer.alloc(1024)).digest('hex'))
    assert.match(part.headers.authorization, /q-header-list=[^&]*content-length/)
    assert.ok(init.headers.authorization.includes('q-header-list='))
    assert.ok(complete.headers.authorization.includes('q-header-list='))
  } finally { await new Promise((resolve) => server.close(resolve)) }
}))

test('stall cancellation closes an actual COS SDK part request before aborting its UploadId', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  let tick; let now = 0; let partStartedResolve; let partSocketClosedResolve
  let partSocketClosed = false; const abortedUploadIds = []; const logs = []; const requestsSeen = []
  const partStarted = new Promise((resolve) => { partStartedResolve = resolve })
  const partSocketClosedPromise = new Promise((resolve) => { partSocketClosedResolve = resolve })
  const clock = { now: () => now, setInterval: (fn) => { tick = fn; return 1 }, clearInterval: () => {} }
  const server = http.createServer((req, res) => {
    requestsSeen.push(`${req.method} ${req.url}`)
    if (req.url.includes('versioning')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<VersioningConfiguration/>') }); return }
    if (req.url.includes('uploads')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<InitiateMultipartUploadResult><UploadId>stall-owned-id</UploadId></InitiateMultipartUploadResult>') }); return }
    if (req.method === 'PUT') {
      req.pause()
      req.socket.once('close', () => { partSocketClosed = true; partSocketClosedResolve() })
      partStartedResolve()
      return
    }
    if (req.method === 'DELETE') {
      abortedUploadIds.push(new URL(req.url, 'http://localhost').searchParams.get('uploadId'))
      req.resume(); req.on('end', () => { res.statusCode = 204; res.end() })
      return
    }
    req.resume(); req.on('end', () => { res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 60_000 })
    const upload = multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou', clock, log: (line) => logs.push(line) })
    await Promise.race([partStarted, new Promise((_, reject) => setTimeout(() => reject(new Error(`COS_PART_NOT_STARTED requests=${requestsSeen.join('|')} logs=${logs.join('|')}`)), 1500))])
    now = 60_000; tick()
    assert.ok(logs.some((line) => line.includes('STALLED=YES')))
    now = 300_000; tick()
    await Promise.race([assert.rejects(upload, /COS_MULTIPART_UPLOAD_STALLED/), new Promise((_, reject) => setTimeout(() => reject(new Error(`COS_PART_CANCEL_NOT_SETTLED requests=${requestsSeen.join('|')} logs=${logs.join('|')}`)), 1500))])
    await Promise.race([partSocketClosedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('COS_PART_SOCKET_NOT_CLOSED')), 1000))])
    assert.equal(partSocketClosed, true)
    assert.deepEqual(abortedUploadIds, ['stall-owned-id'])
    assert.ok(logs.some((line) => line.includes('COS_PART_CANCEL_REQUESTED part=1 reason=stall')))
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}))

test('canceling one SDK part request does not cancel another task on the same client', async () => fixture(async (filePath) => {
  const require = createRequire(import.meta.url)
  const COS = require('cos-nodejs-sdk-v5')
  const logs = []; const abortedUploadIds = []; const partRequests = new Map(); const closedParts = new Set()
  let readyResolve; let readyCount = 0; let nowOne = 0; let tickOne
  const bothPartsReady = new Promise((resolve) => { readyResolve = resolve })
  const clockOne = { now: () => nowOne, setInterval: (fn) => { tickOne = fn; return 1 }, clearInterval: () => {} }
  const clockTwo = { now: () => 0, setInterval: () => 1, clearInterval: () => {} }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const key = url.pathname.slice(1)
    if (url.searchParams.has('versioning')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<VersioningConfiguration/>') }); return }
    if (url.searchParams.has('uploads')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end(`<InitiateMultipartUploadResult><UploadId>id-${key}</UploadId></InitiateMultipartUploadResult>`) }); return }
    if (req.method === 'PUT') {
      req.pause()
      req.socket.once('close', () => closedParts.add(key))
      partRequests.set(key, { req, res })
      readyCount++
      if (readyCount === 2) readyResolve()
      req.on('end', () => { res.setHeader('ETag', '"abc123"'); res.end('') })
      return
    }
    if (req.method === 'DELETE') {
      abortedUploadIds.push(url.searchParams.get('uploadId'))
      req.resume(); req.on('end', () => { res.statusCode = 204; res.end() })
      return
    }
    if (req.method === 'POST' && url.searchParams.has('uploadId')) {
      req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/xml'); res.end('<CompleteMultipartUploadResult><ETag>"complete123"</ETag></CompleteMultipartUploadResult>') })
      return
    }
    req.resume(); req.on('end', () => { res.statusCode = 404; res.end('<Error><Code>NoSuchKey</Code></Error>') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const cos = new COS({ SecretId: 'test-id', SecretKey: 'test-key', Domain: `127.0.0.1:${server.address().port}`, Protocol: 'http:', Timeout: 60_000 })
    const first = multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou', key: 'one', clock: clockOne, log: (line) => logs.push(line) })
    const second = multipartUpload({ ...args(cos, filePath), bucket: 'example-1234567890', region: 'ap-guangzhou', key: 'two', clock: clockTwo, log: (line) => logs.push(line) })
    await Promise.race([bothPartsReady, new Promise((_, reject) => setTimeout(() => reject(new Error('COS_CONCURRENT_PARTS_NOT_READY')), 1500))])
    nowOne = 300_000; tickOne()
    await assert.rejects(first, /COS_MULTIPART_UPLOAD_STALLED/)
    assert.ok(closedParts.has('one'))
    assert.equal(closedParts.has('two'), false)
    assert.deepEqual(abortedUploadIds, ['id-one'])
    partRequests.get('two').req.resume()
    await second
    assert.deepEqual(abortedUploadIds, ['id-one'])
    assert.ok(partRequests.has('one') && partRequests.has('two'))
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
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
