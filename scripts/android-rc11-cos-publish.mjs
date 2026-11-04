import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { CODE32_BASELINE, CODE32_ROLLBACK_OBJECT_KEY, loadRc13Pin, validateCode32VersionApi } from './android-rc13-release.mjs'
import { multipartUpload, safeCosError } from './android-rc13-multipart.mjs'

const require = createRequire(import.meta.url)
const INGRESS_FILENAME = 'ECFC-1.0.0-beta.21-release-RC11-20261102-152136.apk'
export const RC11_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app',
  versionCode: 31,
  versionName: '1.0.0-beta.21',
  size: 183802143,
  sha256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
})
export const CODE30_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app',
  versionCode: 30,
  versionName: '1.0.0-beta.21',
  size: 184246197,
  sha256: 'D2CA0817E23431EFAB87E992BA544C4B213981E3E8651D67AF49324B440FC967',
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
})
export const CODE31_BASELINE = Object.freeze({
  ...RC11_BASELINE,
})
export const CODE30_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-code30-backup-20261102-205634-run41523510243-attempt1.apk'
export const CODE31_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk'
export const RC12_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app',
  versionCode: 32,
  versionName: '1.0.0-beta.21',
  size: 180263015,
  sha256: '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271',
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
})
const RC12_INGRESS_FILENAME = 'ECFC-1.0.0-beta.21-release-RC12-code32.apk'

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive'
const APK_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const APK_DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000
export const COS_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
export const COS_STS_DURATION_SECONDS = 7200
export const COS_STS_MINIMUM_UPLOAD_REMAINING_SECONDS = 900
const DOWNLOAD_PROGRESS_INTERVAL_BYTES = 25 * 1024 * 1024
const API_VERSION_URL = 'https://ecfc.fans/api/app/version?platform=android'
const CODE30_DOWNLOAD_URL = 'https://ecfc.fans/api/app/download/android'
const CDN_BASE_URL = 'https://media.ecfc.fans/media/'
const CDN_HOSTNAME = new URL(CDN_BASE_URL).hostname
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
export const EXPECTED_OIDC_WORKFLOW_REF = 'andkdiids/EasonFansClub/.github/workflows/publish-android-rc11.yml@refs/heads/main'
export const EXPECTED_OIDC_SUBJECT = `repo:andkdiids/EasonFansClub:environment:Production:workflow_ref:${EXPECTED_OIDC_WORKFLOW_REF}`

const requiredStsConfig = Object.freeze([
  'TENCENT_CAM_OIDC_AUDIENCE',
  'TENCENT_EXPECTED_OIDC_SUBJECT',
  'TENCENT_CAM_PROVIDER_ID',
  'TENCENT_CAM_ROLE_ARN',
  'TENCENT_STS_REGION',
])
const requiredCosConfig = Object.freeze(['TENCENT_COS_BUCKET', 'TENCENT_COS_REGION'])
export const EXPECTED_COS_BUCKET = 'ecfc-1306412725'
export const EXPECTED_COS_REGION = 'ap-guangzhou'

function assertSha(value, expected, code) {
  if (typeof value !== 'string' || value.toUpperCase() !== expected) throw new Error(code)
}

function assertSize(value, expected, code) {
  if (Number(value) !== expected) throw new Error(code)
}

function createCdnObjectUrl(key) {
  if (typeof key !== 'string'
    || !/^android\/releases\/[A-Za-z0-9][A-Za-z0-9._/-]{0,220}\.apk$/.test(key)
    || key.includes('\\')
    || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('COS_CUSTOM_DOMAIN_OBJECT_KEY_INVALID')
  }
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const url = new URL(encodedKey, CDN_BASE_URL)
  if (url.protocol !== 'https:' || url.hostname !== CDN_HOSTNAME
    || url.username || url.password || url.port || url.search || url.hash
    || !url.pathname.startsWith('/media/android/releases/')
    || url.pathname !== '/media/' + encodedKey) {
    throw new Error('COS_CUSTOM_DOMAIN_URL_INVALID')
  }
  return url
}

function safeResponseHeader(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/=_: .-]{1,160}$/.test(value)) return 'NONE'
  return value
}

function getSafeResponseDiagnostics(response) {
  const contentRange = safeResponseHeader(response.headers.get('content-range') ?? '')
  const contentLength = safeResponseHeader(response.headers.get('content-length') ?? '')
  const requestId = safeResponseHeader(
    response.headers.get('x-cos-request-id')
      ?? response.headers.get('x-request-id')
      ?? response.headers.get('x-amz-request-id')
      ?? '',
  )
  return `http_status=${response.status} content_range=${contentRange} content_length=${contentLength} request_id=${requestId}`
}

async function responseContainsExactlyOneByte(response) {
  if (!response.body) return false
  const reader = response.body.getReader()
  try {
    const first = await reader.read()
    if (first.done || !first.value || first.value.byteLength !== 1) return false
    const second = await reader.read()
    return second.done === true
  } catch {
    return false
  } finally {
    try { await reader.cancel() } catch {}
    try { reader.releaseLock() } catch {}
  }
}

function safeFetchErrorClass(error) {
  return error instanceof Error && ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
    ? error.name
    : 'NETWORK_ERROR'
}

function validateVersionApiBaseline(body, baseline, code) {
  if (!body || body.platform !== 'android' || body.versionName !== baseline.versionName
    || Number(body.versionCode) !== baseline.versionCode
    || Number(body.size) !== baseline.size
    || String(body.apkSha256).toUpperCase() !== baseline.sha256
    || Number(body.minimumVersionCode) !== 19 || body.forceUpdate !== false
    || body.downloadUrl !== CODE30_DOWNLOAD_URL
    || !Array.isArray(body.releaseNotes) || body.releaseNotes.length !== 6
    || typeof body.publishedAt !== 'string' || !body.publishedAt) {
    throw new Error(code)
  }
  return body
}

export function validateCode30VersionApi(body) {
  return validateVersionApiBaseline(body, CODE30_BASELINE, 'PRODUCTION_VERSION_API_NOT_EXPECTED_CODE30')
}

export function validateCode31VersionApi(body) {
  return validateVersionApiBaseline(body, CODE31_BASELINE, 'PRODUCTION_VERSION_API_NOT_EXPECTED_CODE31')
}

export function validateIngressManifest(manifest, {
  candidate = 'rc11',
  runId = process.env.GITHUB_RUN_ID,
  runAttempt = process.env.GITHUB_RUN_ATTEMPT,
  ref = process.env.GITHUB_REF,
  workflowRef = process.env.GITHUB_WORKFLOW_REF,
  workflowSha = process.env.GITHUB_SHA,
} = {}) {
  const baseline = candidate === 'rc11' ? RC11_BASELINE : candidate === 'rc12' ? RC12_BASELINE : candidate === 'rc13' ? loadRc13Pin() : null
  const sourceFile = candidate === 'rc11' ? INGRESS_FILENAME : candidate === 'rc12' ? RC12_INGRESS_FILENAME : candidate === 'rc13' ? baseline.sourceFile : null
  const prefix = candidate === 'rc11' ? 'RC11' : candidate === 'rc12' ? 'RC12' : candidate === 'rc13' ? 'RC13' : null
  if (!baseline || !sourceFile || !prefix) throw new Error('RELEASE_CANDIDATE_INVALID')
  if (!manifest || manifest.release_candidate !== candidate || manifest.source_file !== sourceFile
    || String(manifest.run_id) !== String(runId)
    || String(manifest.run_attempt) !== String(runAttempt)
    || manifest.ref !== 'refs/heads/main' || ref !== 'refs/heads/main'
    || typeof workflowRef !== 'string'
    || !workflowRef.endsWith('/.github/workflows/publish-android-rc11.yml@refs/heads/main')
    || manifest.workflow_ref !== workflowRef
    || manifest.workflow_sha !== workflowSha
    || manifest.application_id !== baseline.applicationId
    || Number(manifest.version_code) !== baseline.versionCode
    || manifest.version_name !== baseline.versionName
    || String(manifest.size) !== String(baseline.size)) {
    throw new Error(prefix + '_INGRESS_PROVENANCE_INVALID')
  }
  assertSha(manifest.source_sha256, baseline.sha256, prefix + '_INGRESS_SOURCE_SHA256_MISMATCH')
  assertSha(manifest.sha256, baseline.sha256, prefix + '_INGRESS_SHA256_MISMATCH')
  assertSha(manifest.signer_sha256, baseline.signerSha256, prefix + '_INGRESS_SIGNER_MISMATCH')
  return manifest
}

export function createVersionedObjectKey(kind, { date = new Date(), runId, runAttempt } = {}) {
  if (!['rc11', 'rc12', 'rc13'].includes(kind)) throw new Error('COS_OBJECT_KIND_INVALID')
  if (!/^\d+$/.test(String(runId ?? '')) || !/^[1-9]\d*$/.test(String(runAttempt ?? ''))) {
    throw new Error('GITHUB_RUN_ID_INVALID')
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('OBJECT_TIMESTAMP_INVALID')
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, '')
  const filename = 'ECFC-1.0.0-beta.21-release-beta21-' + kind + '-' + timestamp + '-run' + runId + '-attempt' + runAttempt + '.apk'
  return 'android/releases/' + filename
}

export function validateVersionedObjectKey(key, kind, { runId, runAttempt } = {}) {
  if (typeof key !== 'string' || !key.startsWith('android/releases/')) throw new Error('COS_OBJECT_KEY_INVALID')
  const pattern = kind === 'rc11'
    ? /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc11-\d{8}-\d{6}-run\d+-attempt\d+\.apk$/
    : kind === 'rc12'
      ? /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc12-\d{8}-\d{6}-run\d+-attempt\d+\.apk$/
      : kind === 'rc13'
        ? /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc13-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/
      : null
  if (!pattern || !pattern.test(key)) throw new Error('COS_OBJECT_KEY_INVALID')
  if (runId !== undefined && !key.includes('-run' + runId + '-attempt' + runAttempt + '.apk')) {
    throw new Error('COS_OBJECT_KEY_RUN_MISMATCH')
  }
  return key
}

function validateStsConfig(env = process.env) {
  for (const name of requiredStsConfig) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`COS_OIDC_CONFIG_MISSING:${name}`)
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(env.TENCENT_CAM_PROVIDER_ID)) throw new Error('COS_OIDC_PROVIDER_ID_INVALID')
  if (!/^qcs::cam::uin\/\d+:roleName\/[A-Za-z0-9+=,.@_-]+$/.test(env.TENCENT_CAM_ROLE_ARN)) {
    throw new Error('COS_OIDC_ROLE_ARN_INVALID')
  }
  if (!/^[A-Za-z0-9._:/-]{1,256}$/.test(env.TENCENT_CAM_OIDC_AUDIENCE)) throw new Error('COS_OIDC_AUDIENCE_INVALID')
  if (env.TENCENT_EXPECTED_OIDC_SUBJECT !== EXPECTED_OIDC_SUBJECT) throw new Error('COS_OIDC_SUBJECT_NOT_WORKFLOW_PINNED')
  if (!/^[A-Za-z0-9-]{2,40}$/.test(env.TENCENT_STS_REGION)) throw new Error('COS_REGION_OR_BUCKET_INVALID')
  return env
}

export function validateCosConfig(env = process.env) {
  validateStsConfig(env)
  for (const name of requiredCosConfig) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`COS_OIDC_CONFIG_MISSING:${name}`)
  }
  if (!/^[A-Za-z0-9-]{2,40}$/.test(env.TENCENT_COS_REGION)
    || !/^[a-z0-9-]{1,63}-\d{5,}$/.test(env.TENCENT_COS_BUCKET)) {
    throw new Error('COS_REGION_OR_BUCKET_INVALID')
  }
  if (env.TENCENT_COS_BUCKET !== EXPECTED_COS_BUCKET || env.TENCENT_COS_REGION !== EXPECTED_COS_REGION) {
    throw new Error('COS_RELEASE_TARGET_MISMATCH')
  }
  return env
}

function decodeJwtPayload(jwt) {
  const segments = jwt.split('.')
  if (segments.length !== 3) throw new Error('GITHUB_OIDC_TOKEN_INVALID')
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('GITHUB_OIDC_TOKEN_INVALID')
  }
}

export function validateOidcClaims(claims, { audience, expectedSubject, workflowRef }) {
  const tokenAudience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud]
  if (claims?.iss !== OIDC_ISSUER || !tokenAudience.includes(audience)
    || claims?.sub !== expectedSubject || claims?.environment !== 'Production'
    || claims?.repository !== 'andkdiids/EasonFansClub'
    || claims?.ref !== 'refs/heads/main'
    || claims?.event_name !== 'workflow_dispatch'
    || claims?.workflow_ref !== workflowRef) {
    throw new Error('GITHUB_OIDC_TRUST_BOUNDARY_MISMATCH')
  }
  return true
}

export function validateObjectMetadata(result, { size, sha256 }) {
  const headers = Object.fromEntries(Object.entries(result?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]))
  if (Number(result?.statusCode) !== 200
    || Number(headers['content-length']) !== size
    || headers['content-type']?.split(';')[0].trim().toLowerCase() !== APK_CONTENT_TYPE
    || headers['cache-control'] !== APK_CACHE_CONTROL
    || headers['x-cos-meta-sha256']?.toUpperCase() !== sha256) {
    throw new Error('COS_OBJECT_METADATA_MISMATCH')
  }
  return true
}

export async function hashFile(filePath) {
  const hash = createHash('sha256')
  let size = 0
  await pipeline(
    createReadStream(filePath),
    new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        hash.update(chunk)
        callback(null, chunk)
      },
    }),
    new Transform({ transform(_chunk, _encoding, callback) { callback() } }),
  )
  return { size, sha256: hash.digest('hex').toUpperCase() }
}

function logReleaseProgress(stage, event, details = '', logImpl = console.log) {
  if (!/^[A-Z0-9_]+$/.test(stage) || !/^[A-Z]+$/.test(event)) throw new Error('RELEASE_PROGRESS_LABEL_INVALID')
  logImpl(`RELEASE_PROGRESS=${stage}_${event}${details ? ` ${details}` : ''}`)
}

async function runReleaseStage(stage, operation, logImpl = console.log) {
  const startedAt = Date.now()
  logReleaseProgress(stage, 'START', '', logImpl)
  try {
    const result = await operation()
    logReleaseProgress(stage, 'COMPLETE', `duration_ms=${Date.now() - startedAt}`, logImpl)
    return result
  } catch (error) {
    logReleaseProgress(stage, 'FAILED', `duration_ms=${Date.now() - startedAt}`, logImpl)
    throw error
  }
}

export async function verifyRollbackSourceRange(candidate, fetchImpl) {
  const source = candidate === 'rc11'
    ? { key: CODE30_ROLLBACK_OBJECT_KEY, size: CODE30_BASELINE.size, code: 30 }
    : candidate === 'rc12' ? { key: CODE31_ROLLBACK_OBJECT_KEY, size: CODE31_BASELINE.size, code: 31 }
      : candidate === 'rc13' ? { key: CODE32_ROLLBACK_OBJECT_KEY, size: CODE32_BASELINE.size, code: 32 } : null
  if (!source) throw new Error('RELEASE_CANDIDATE_INVALID')
  const url = createCdnObjectUrl(source.key).toString()
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error(`CODE${source.code}_ROLLBACK_SOURCE_UNAVAILABLE`)
  }
  if (!response.ok || response.status !== 206 || response.url !== url
    || response.headers.get('content-range') !== `bytes 0-0/${source.size}`
    || !await responseContainsExactlyOneByte(response)) {
    throw new Error(`CODE${source.code}_ROLLBACK_SOURCE_UNAVAILABLE`)
  }
  return source
}

export async function captureVersionApiBaseline({ candidate = process.env.RELEASE_CANDIDATE, env = process.env, fetchImpl = fetch } = {}) {
  if (candidate === 'rc13') loadRc13Pin()
  const expectedVersionCode = candidate === 'rc11' ? 30 : candidate === 'rc12' ? 31 : candidate === 'rc13' ? 32 : null
  if (expectedVersionCode === null) throw new Error('RELEASE_CANDIDATE_INVALID')
  const body = await runReleaseStage(`PRODUCTION_VERSION_API_CODE${expectedVersionCode}`, async () => {
    let response
    try {
      response = await fetchImpl(API_VERSION_URL, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    } catch {
      throw new Error('PRODUCTION_VERSION_API_UNAVAILABLE')
    }
    if (!response.ok) throw new Error('PRODUCTION_VERSION_API_UNAVAILABLE')
    let body
    try { body = await response.json() } catch { throw new Error('PRODUCTION_VERSION_API_INVALID') }
    return expectedVersionCode === 30 ? validateCode30VersionApi(body) : expectedVersionCode === 31 ? validateCode31VersionApi(body) : validateCode32VersionApi(body)
  })
  const rollbackSource = await verifyRollbackSourceRange(candidate, fetchImpl)
  const fileName = `android-version-api-code${expectedVersionCode}-baseline.json`
  const baselinePath = path.join(env.RUNNER_TEMP || os.tmpdir(), fileName)
  await writeFile(baselinePath, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' })
  console.log(`VERSION_API_CODE${expectedVersionCode}_READ_ONLY_BASELINE=VERIFIED`)
  console.log(`CODE${rollbackSource.code}_ROLLBACK_SOURCE_RANGE=VERIFIED`)
  return { body, baselinePath, rollbackSource }
}

export async function downloadToFile(url, filePath, {
  fetchImpl = fetch,
  expectedSize,
  expectedSha256,
  stage = 'APK_DOWNLOAD',
  logImpl = console.log,
  redirect = 'follow',
  expectedHostname,
} = {}) {
  return runReleaseStage(stage, async () => {
    let requestedUrl
    try {
      requestedUrl = new URL(url)
    } catch {
      throw new Error('APK_DOWNLOAD_URL_INVALID')
    }
    if (requestedUrl.protocol !== 'https:' || requestedUrl.username || requestedUrl.password
      || (expectedHostname && (requestedUrl.hostname !== expectedHostname
        || requestedUrl.port || requestedUrl.search || requestedUrl.hash))) {
      throw new Error('APK_DOWNLOAD_URL_INVALID')
    }

    let response
    try {
      response = await fetchImpl(url, { redirect, signal: AbortSignal.timeout(APK_DOWNLOAD_TIMEOUT_MS) })
    } catch {
      throw new Error('APK_DOWNLOAD_FAILED')
    }
    logReleaseProgress(stage, 'RESPONSE', `status=${response.status}`, logImpl)
    let finalUrl
    try { finalUrl = new URL(response.url) } catch { throw new Error('APK_DOWNLOAD_FAILED') }
    if (!response.ok || !response.body || finalUrl.protocol !== 'https:'
      || finalUrl.username || finalUrl.password
      || (expectedHostname && (finalUrl.hostname !== expectedHostname || response.url !== requestedUrl.toString()))) {
      throw new Error('APK_DOWNLOAD_FAILED')
    }

    await mkdir(path.dirname(filePath), { recursive: true })
    const hash = createHash('sha256')
    let size = 0
    let nextProgressBytes = DOWNLOAD_PROGRESS_INTERVAL_BYTES
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        hash.update(chunk)
        if (size >= nextProgressBytes) {
          logReleaseProgress(stage, 'PROGRESS', `bytes=${size}`, logImpl)
          nextProgressBytes = size + DOWNLOAD_PROGRESS_INTERVAL_BYTES
        }
        callback(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(filePath, { flags: 'wx' }))
    } catch {
      throw new Error('APK_DOWNLOAD_WRITE_FAILED')
    }
    const sha256 = hash.digest('hex').toUpperCase()
    assertSize(size, expectedSize, 'APK_SIZE_MISMATCH')
    assertSha(sha256, expectedSha256, 'APK_SHA256_MISMATCH')
    return { size, sha256, url: response.url }
  }, logImpl)
}

const GITHUB_ACTIONS_RUNNER_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+actions\.githubusercontent\.com$/

function isAllowedGithubOidcEndpoint(url) {
  const hostname = url.hostname.toLowerCase()
  const allowedHost = hostname === 'pipelines.actions.githubusercontent.com'
    || GITHUB_ACTIONS_RUNNER_HOST.test(hostname)
  return url.protocol === 'https:'
    && url.port === ''
    && url.username === ''
    && url.password === ''
    && allowedHost
}

async function getGithubOidcToken(env, fetchImpl) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!requestUrl || !requestToken) throw new Error('GITHUB_OIDC_ENDPOINT_UNAVAILABLE')
  let url
  try {
    url = new URL(requestUrl)
  } catch {
    throw new Error('GITHUB_OIDC_ENDPOINT_INVALID')
  }
  if (!isAllowedGithubOidcEndpoint(url)) {
    throw new Error('GITHUB_OIDC_ENDPOINT_INVALID')
  }
  url.searchParams.set('audience', env.TENCENT_CAM_OIDC_AUDIENCE)
  let response
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${requestToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error('GITHUB_OIDC_TOKEN_REQUEST_FAILED')
  }
  if (!response.ok) throw new Error('GITHUB_OIDC_TOKEN_REQUEST_FAILED')
  const payload = await response.json().catch(() => null)
  if (typeof payload?.value !== 'string') throw new Error('GITHUB_OIDC_TOKEN_INVALID')
  validateOidcClaims(decodeJwtPayload(payload.value), {
    audience: env.TENCENT_CAM_OIDC_AUDIENCE,
    expectedSubject: env.TENCENT_EXPECTED_OIDC_SUBJECT,
    workflowRef: env.GITHUB_WORKFLOW_REF,
  })
  return payload.value
}

async function exchangeForSts(env, fetchImpl) {
  const webIdentityToken = await getGithubOidcToken(env, fetchImpl)
  let response
  try {
    response = await fetchImpl('https://sts.tencentcloudapi.com', {
      method: 'POST',
      headers: {
        authorization: 'SKIP',
        'content-type': 'application/json; charset=utf-8',
        host: 'sts.tencentcloudapi.com',
        'x-tc-action': 'AssumeRoleWithWebIdentity',
        'x-tc-region': env.TENCENT_STS_REGION,
        'x-tc-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-tc-version': '2018-08-13',
      },
      body: JSON.stringify({
        DurationSeconds: COS_STS_DURATION_SECONDS,
        RoleSessionName: `gha-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
        WebIdentityToken: webIdentityToken,
        RoleArn: env.TENCENT_CAM_ROLE_ARN,
        ProviderId: env.TENCENT_CAM_PROVIDER_ID,
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error('TENCENT_STS_EXCHANGE_FAILED')
  }
  if (!response.ok) throw new Error('TENCENT_STS_EXCHANGE_FAILED')
  const payload = await response.json().catch(() => null)
  const stsError = payload?.Response?.Error
  const credentials = payload?.Response?.Credentials
  if (stsError) throw new Error('TENCENT_STS_REJECTED_WEB_IDENTITY')
  if (!credentials?.TmpSecretId || !credentials?.TmpSecretKey || !credentials?.Token) {
    throw new Error('TENCENT_STS_CREDENTIALS_UNAVAILABLE')
  }
  return {
    SecretId: credentials.TmpSecretId,
    SecretKey: credentials.TmpSecretKey,
    SecurityToken: credentials.Token,
    ExpiredTime: Number(payload.Response.ExpiredTime),
  }
}

export function getStsExpiryInfo(credentials, now = Date.now()) {
  const expiredTime = Number(credentials?.ExpiredTime)
  if (!Number.isFinite(expiredTime) || expiredTime <= 0 || !Number.isFinite(now)) {
    throw new Error('TENCENT_STS_EXPIRY_INVALID')
  }
  const expiredAtMs = expiredTime * 1000
  const expiredAt = new Date(expiredAtMs)
  if (!Number.isFinite(expiredAt.getTime())) throw new Error('TENCENT_STS_EXPIRY_INVALID')
  return { expiredTime, expiredAt: expiredAt.toISOString(), remainingSeconds: Math.floor((expiredAtMs - now) / 1000) }
}

export function assertStsCredentialLifetime(credentials, minimumRemainingSeconds, now = Date.now()) {
  const info = getStsExpiryInfo(credentials, now)
  if (!Number.isFinite(minimumRemainingSeconds) || minimumRemainingSeconds < 0
    || info.remainingSeconds < minimumRemainingSeconds) {
    throw new Error('TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME')
  }
  return info
}

function logAndRequireStsLifetime(credentials, { minimumRemainingSeconds, now = Date.now(), log = console.log }) {
  const info = getStsExpiryInfo(credentials, now)
  log(`TENCENT_STS_EXPIRED_TIME=${info.expiredAt} TENCENT_STS_REMAINING_SECONDS=${info.remainingSeconds}`)
  return assertStsCredentialLifetime(credentials, minimumRemainingSeconds, now)
}

export async function verifyOidcSts({ env = process.env, fetchImpl = fetch, log = console.log, now = Date.now } = {}) {
  validateStsConfig(env)
  if (env.GITHUB_WORKFLOW_REF !== EXPECTED_OIDC_WORKFLOW_REF) throw new Error('GITHUB_OIDC_WORKFLOW_REF_MISMATCH')
  if (!/^\d+$/.test(String(env.GITHUB_RUN_ID ?? '')) || !/^[1-9]\d*$/.test(String(env.GITHUB_RUN_ATTEMPT ?? ''))) {
    throw new Error('GITHUB_OIDC_RUN_CONTEXT_INVALID')
  }
  const credentials = await exchangeForSts(env, fetchImpl)
  logAndRequireStsLifetime(credentials, { minimumRemainingSeconds: COS_STS_MINIMUM_UPLOAD_REMAINING_SECONDS, log, now: now() })
  return true
}

export function createCosClient(credentials, COS = require('cos-nodejs-sdk-v5')) {
  return new COS({
    SecretId: credentials.SecretId,
    SecretKey: credentials.SecretKey,
    SecurityToken: credentials.SecurityToken,
    Protocol: 'https:',
    UseAccelerate: false,
    FileParallelLimit: 1,
    ChunkParallelLimit: 1,
    Timeout: COS_REQUEST_TIMEOUT_MS,
  })
}

function isCosNotFound(error) {
  return Number(error?.statusCode) === 404 || ['NoSuchKey', 'NotFound'].includes(error?.code)
}

export async function assertObjectAbsent(cos, bucket, region, key) {
  try {
    const result = await cos.headObject({ Bucket: bucket, Region: region, Key: key })
    if (Number(result?.statusCode) === 200) throw new Error('COS_OBJECT_KEY_ALREADY_EXISTS')
    if (Number(result?.statusCode) === 404) return
    throw new Error('COS_OBJECT_EXISTENCE_UNVERIFIED')
  } catch (error) {
    if (error instanceof Error && error.message === 'COS_OBJECT_KEY_ALREADY_EXISTS') throw error
    if (!isCosNotFound(error)) throw new Error('COS_OBJECT_EXISTENCE_UNVERIFIED')
  }
}

export async function downloadCosObject({
  key,
  filePath,
  expected,
  downloadFile = downloadToFile,
  fetchImpl = fetch,
  stage = 'COS_CUSTOM_DOMAIN_READBACK',
}) {
  const url = createCdnObjectUrl(key)
  return downloadFile(url.toString(), filePath, {
    fetchImpl,
    expectedSize: expected.size,
    expectedSha256: expected.sha256,
    stage,
    redirect: 'error',
    expectedHostname: CDN_HOSTNAME,
  })
}

export async function uploadImmutableObject({ cos, env, key, filePath, expected, stage, credentialsExpiredTime, downloadFile = downloadToFile, downloadCos = downloadCosObject, fetchImpl = fetch }) {
  await runReleaseStage(`${stage}_COS_PREFLIGHT`, async () => {
    await assertObjectAbsent(cos, env.TENCENT_COS_BUCKET, env.TENCENT_COS_REGION, key)
  })
  try {
    await runReleaseStage(`${stage}_COS_PUT`, async () => {
      await multipartUpload({ cos, bucket: env.TENCENT_COS_BUCKET, region: env.TENCENT_COS_REGION, key, filePath, size: expected.size, sha256: expected.sha256, concurrency: Number(env.COS_MULTIPART_CONCURRENCY || 3), credentialsExpiredTime })
    })
  } catch (error) {
    if (error?.message !== 'COS_COMPLETE_UNCERTAIN') throw error
    // Only HEAD plus complete custom-domain SHA readback can resolve an ambiguous response.
    logReleaseProgress(`${stage}_COS_PUT`, 'REVALIDATE')
  }

  const metadata = await runReleaseStage(`${stage}_COS_METADATA`, async () => {
    try {
      return await cos.headObject({ Bucket: env.TENCENT_COS_BUCKET, Region: env.TENCENT_COS_REGION, Key: key })
    } catch {
      throw new Error('COS_OBJECT_METADATA_UNAVAILABLE')
    }
  })
  await runReleaseStage(`${stage}_COS_METADATA_VALIDATE`, () => validateObjectMetadata(metadata, expected))

  const cdnUrl = createCdnObjectUrl(key).toString()
  const readbackPath = path.join(os.tmpdir(), `ecfc-${expected.sha256}.apk`)
  // COS default-domain APK reads are forbidden. Read exactly once through the existing
  // HTTPS custom domain; downloadToFile verifies every byte, size, and SHA-256.
  await downloadCos({
    cos,
    bucket: env.TENCENT_COS_BUCKET,
    region: env.TENCENT_COS_REGION,
    key,
    filePath: readbackPath,
    expected,
    downloadFile,
    fetchImpl,
    stage: `${stage}_CDN_READBACK`,
  })
  return { key, cdnUrl, metadata }
}

function writeOutput(name, value, env = process.env) {
  if (!/^[A-Z0-9_]+$/.test(name) || /[\r\n]/.test(String(value))) throw new Error('GITHUB_OUTPUT_INVALID')
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT_UNAVAILABLE')
  return writeFile(env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' })
}

async function readIngressArtifact(env, candidate = env.RELEASE_CANDIDATE || 'rc11') {
  const baseline = candidate === 'rc11' ? RC11_BASELINE : candidate === 'rc12' ? RC12_BASELINE : candidate === 'rc13' ? loadRc13Pin() : null
  const prefix = candidate === 'rc11' ? 'RC11' : candidate === 'rc12' ? 'RC12' : candidate === 'rc13' ? 'RC13' : null
  const fileName = candidate === 'rc11' ? INGRESS_FILENAME : candidate === 'rc12' ? RC12_INGRESS_FILENAME : candidate === 'rc13' ? baseline.sourceFile : null
  if (!baseline || !prefix || !fileName) throw new Error('RELEASE_CANDIDATE_INVALID')
  const ingressDir = env.RC11_INGRESS_DIRECTORY
  if (!ingressDir) throw new Error(prefix + '_INGRESS_DIRECTORY_MISSING')
  const apkPath = path.join(ingressDir, fileName)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(ingressDir, 'manifest.json'), 'utf8'))
  } catch {
    throw new Error(prefix + '_INGRESS_MANIFEST_INVALID')
  }
  validateIngressManifest(manifest, { candidate })
  const actual = await hashFile(apkPath)
  assertSize(actual.size, baseline.size, prefix + '_APK_SIZE_MISMATCH')
  assertSha(actual.sha256, baseline.sha256, prefix + '_APK_SHA256_MISMATCH')
  return { apkPath, manifest }
}

async function getCos(env, fetchImpl = fetch, { cosFactory = createCosClient, log = console.log, now = Date.now } = {}) {
  validateCosConfig(env)
  const credentials = await runReleaseStage('TENCENT_STS_EXCHANGE', () => exchangeForSts(env, fetchImpl))
  const expiry = logAndRequireStsLifetime(credentials, {
    minimumRemainingSeconds: COS_STS_MINIMUM_UPLOAD_REMAINING_SECONDS,
    log,
    now: now(),
  })
  return { cos: cosFactory(credentials), credentialsExpiredTime: expiry.expiredTime, expiry }
}

export async function verifyCosReadOnlyAccess({ cos, bucket, region, log = console.log, fetchImpl = fetch }) {
  const base = { Bucket: bucket, Region: region }
  let versioning
  try {
    versioning = await cos.getBucketVersioning(base)
  } catch (error) {
    log(`COS_GET_BUCKET_VERSIONING_FAILED ${safeCosError(error, { requestType: 'GetBucketVersioning', method: 'GET' })}`)
    throw new Error('COS_GET_BUCKET_VERSIONING_FAILED')
  }
  const configuration = versioning?.VersioningConfiguration
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new Error('COS_BUCKET_VERSIONING_RESPONSE_INVALID')
  }
  log(`COS_BUCKET_VERSIONING_RESPONSE=${JSON.stringify(versioning)}`)
  if (Object.keys(configuration).length !== 0) {
    const state = configuration.Status === 'Enabled' ? 'ENABLED'
      : configuration.Status === 'Suspended' ? 'SUSPENDED' : 'UNKNOWN'
    throw new Error(`COS_BUCKET_VERSIONING_${state}`)
  }

  const object = { ...base, Key: CODE32_ROLLBACK_OBJECT_KEY }
  let head
  try {
    head = await cos.headObject(object)
  } catch (error) {
    log(`COS_HEAD_OBJECT_FAILED ${safeCosError(error, { requestType: 'HeadObject', method: 'HEAD' })}`)
    throw new Error('COS_HEAD_OBJECT_FAILED')
  }
  const responseHeaders = Object.fromEntries(Object.entries(head?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  const contentLength = Number(responseHeaders['content-length'] ?? head?.ContentLength ?? head?.contentLength)
  if (Number(head?.statusCode) !== 200 || contentLength !== CODE32_BASELINE.size) throw new Error('COS_CODE32_HEAD_MISMATCH')

  const rangeUrl = createCdnObjectUrl(CODE32_ROLLBACK_OBJECT_KEY).toString()
  let rangeRead
  try {
    rangeRead = await fetchImpl(rangeUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    log(`COS_CUSTOM_DOMAIN_RANGE_GET_FAILED error_class=${safeFetchErrorClass(error)}`)
    throw new Error('COS_CUSTOM_DOMAIN_RANGE_GET_FAILED')
  }
  const contentRange = rangeRead.headers.get('content-range')
  const validRange = rangeRead.ok && rangeRead.status === 206 && rangeRead.url === rangeUrl
    && contentRange === `bytes 0-0/${CODE32_BASELINE.size}`
    && (!rangeRead.headers.get('content-length') || rangeRead.headers.get('content-length') === '1')
  if (!validRange || !await responseContainsExactlyOneByte(rangeRead)) {
    log(`COS_CUSTOM_DOMAIN_RANGE_GET_FAILED ${getSafeResponseDiagnostics(rangeRead)}`)
    throw new Error('COS_CUSTOM_DOMAIN_RANGE_GET_FAILED')
  }
  log('COS_READ_ONLY_PREFLIGHT=PASS GetBucketVersioning=PASS HeadObject=PASS CustomDomainRangeGet=PASS')
  return { versioning: 'DISABLED', headObject: 'PASS', customDomainRangeGet: 'PASS', objectKey: CODE32_ROLLBACK_OBJECT_KEY }
}

export async function verifyCosReadOnly({ env = process.env, fetchImpl = fetch, cosFactory = createCosClient, log = console.log, now = Date.now } = {}) {
  const { cos } = await getCos(env, fetchImpl, { cosFactory, log, now })
  log(`CAM_ROLE=ASSUMED COS_BUCKET=${env.TENCENT_COS_BUCKET} COS_REGION=${env.TENCENT_COS_REGION}`)
  return verifyCosReadOnlyAccess({ cos, bucket: env.TENCENT_COS_BUCKET, region: env.TENCENT_COS_REGION, log })
}

function runIdentifiers(env) {
  if (!/^\d+$/.test(String(env.GITHUB_RUN_ID ?? '')) || !/^[1-9]\d*$/.test(String(env.GITHUB_RUN_ATTEMPT ?? ''))
    || env.GITHUB_REF !== 'refs/heads/main'
    || !String(env.GITHUB_WORKFLOW_REF ?? '').endsWith('/.github/workflows/publish-android-rc11.yml@refs/heads/main')) {
    throw new Error('GITHUB_RELEASE_CONTEXT_INVALID')
  }
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }
}

export async function publishRc11Artifact({ env = process.env, fetchImpl = fetch, date = new Date() } = {}) {
  const ids = runIdentifiers(env)
  const { apkPath } = await readIngressArtifact(env)
  const { cos, credentialsExpiredTime } = await getCos(env, fetchImpl)
  const key = createVersionedObjectKey('rc11', { ...ids, date })
  await uploadImmutableObject({ cos, env, key, filePath: apkPath, expected: RC11_BASELINE, stage: 'RC11_RELEASE', credentialsExpiredTime })
  await writeOutput('RC11_OBJECT_KEY', key, env)
  await writeOutput('RC11_CDN_URL', createCdnObjectUrl(key).toString(), env)
  await writeOutput('RC11_SHA256', RC11_BASELINE.sha256, env)
  await writeOutput('RC11_SIZE', RC11_BASELINE.size, env)
  return { key, cdnUrl: createCdnObjectUrl(key).toString() }
}

export async function publishRc12Artifact({ env = process.env, fetchImpl = fetch, date = new Date() } = {}) {
  const ids = runIdentifiers(env)
  const { apkPath } = await readIngressArtifact(env, 'rc12')
  const { cos, credentialsExpiredTime } = await getCos(env, fetchImpl)
  const key = createVersionedObjectKey('rc12', { ...ids, date })
  await uploadImmutableObject({ cos, env, key, filePath: apkPath, expected: RC12_BASELINE, stage: 'RC12_RELEASE', credentialsExpiredTime })
  await writeOutput('RC12_OBJECT_KEY', key, env)
  await writeOutput('RC12_CDN_URL', createCdnObjectUrl(key).toString(), env)
  await writeOutput('RC12_SHA256', RC12_BASELINE.sha256, env)
  await writeOutput('RC12_SIZE', RC12_BASELINE.size, env)
  return { key, cdnUrl: createCdnObjectUrl(key).toString() }
}

export async function publishRc13Artifact({ env = process.env, fetchImpl = fetch, date = new Date() } = {}) {
  // Validate the reviewed pin and same-run ingress before requesting STS.
  const baseline = loadRc13Pin()
  const ids = runIdentifiers(env)
  const { apkPath } = await readIngressArtifact(env, 'rc13')
  const { cos, credentialsExpiredTime } = await getCos(env, fetchImpl)
  const key = createVersionedObjectKey('rc13', { ...ids, date })
  await uploadImmutableObject({ cos, env, key, filePath: apkPath, expected: baseline, stage: 'RC13_RELEASE', credentialsExpiredTime })
  await writeOutput('RC13_OBJECT_KEY', key, env)
  await writeOutput('RC13_CDN_URL', createCdnObjectUrl(key).toString(), env)
  await writeOutput('RC13_SHA256', baseline.sha256, env)
  await writeOutput('RC13_SIZE', baseline.size, env)
  return { key, cdnUrl: createCdnObjectUrl(key).toString() }
}

async function main() {
  const command = process.argv[2]
  if (command === 'verify-oidc') {
    await verifyOidcSts()
    console.log('GITHUB_OIDC_CLAIMS=VERIFIED\nTENCENT_STS_EXCHANGE=SUCCESS')
    return
  }
  if (command === 'verify-cos-readonly') {
    const result = await verifyCosReadOnly()
    console.log(`COS_READ_ONLY_VERIFICATION=PASS\nCOS_BUCKET_VERSIONING=${result.versioning}\nCOS_CODE32_HEAD=${result.headObject}\nCOS_CODE32_RANGE_GET=${result.getObject}`)
    return
  }
  if (command === 'verify-version-baseline') {
    const result = await captureVersionApiBaseline()
    console.log(`VERSION_API_BASELINE_FILE=${result.baselinePath}`)
    return
  }
  if (command === 'publish-rc11') {
    const result = await publishRc11Artifact()
    console.log(`RC11_CDN_VERIFIED=YES\nRC11_OBJECT_KEY=${result.key}`)
    return
  }
  if (command === 'publish-rc12') {
    const result = await publishRc12Artifact()
    console.log('RC12_CDN_VERIFIED=YES\nRC12_OBJECT_KEY=' + result.key)
    return
  }
  if (command === 'publish-rc13') {
    const result = await publishRc13Artifact()
    console.log('RC13_CDN_VERIFIED=YES\nRC13_OBJECT_KEY=' + result.key)
    return
  }
  throw new Error('COS_PUBLISH_COMMAND_INVALID')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'RC11_COS_PUBLISH_FAILED')
    process.exitCode = 1
  })
}
