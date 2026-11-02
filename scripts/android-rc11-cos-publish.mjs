import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

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

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive'
const APK_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const API_VERSION_URL = 'https://ecfc.fans/api/app/version?platform=android'
const CODE30_DOWNLOAD_URL = 'https://ecfc.fans/api/app/download/android'
const CDN_BASE_URL = 'https://media.ecfc.fans/media/'
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
export const EXPECTED_OIDC_SUBJECT = 'repo:andkdiids/EasonFansClub:environment:Production:workflow_ref:andkdiids/EasonFansClub/.github/workflows/publish-android-rc11.yml@refs/heads/main'

const requiredConfig = Object.freeze([
  'TENCENT_CAM_OIDC_AUDIENCE',
  'TENCENT_EXPECTED_OIDC_SUBJECT',
  'TENCENT_CAM_PROVIDER_ID',
  'TENCENT_CAM_ROLE_ARN',
  'TENCENT_STS_REGION',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
])

function assertSha(value, expected, code) {
  if (typeof value !== 'string' || value.toUpperCase() !== expected) throw new Error(code)
}

function assertSize(value, expected, code) {
  if (Number(value) !== expected) throw new Error(code)
}

export function validateCode30VersionApi(body) {
  if (!body || body.platform !== 'android' || body.versionName !== CODE30_BASELINE.versionName
    || Number(body.versionCode) !== CODE30_BASELINE.versionCode
    || Number(body.size) !== CODE30_BASELINE.size
    || String(body.apkSha256).toUpperCase() !== CODE30_BASELINE.sha256
    || Number(body.minimumVersionCode) !== 19 || body.forceUpdate !== false
    || body.downloadUrl !== CODE30_DOWNLOAD_URL
    || !Array.isArray(body.releaseNotes) || body.releaseNotes.length !== 6
    || typeof body.publishedAt !== 'string' || !body.publishedAt) {
    throw new Error('PRODUCTION_VERSION_API_NOT_EXPECTED_CODE30')
  }
  return body
}

export function validateIngressManifest(manifest, {
  runId = process.env.GITHUB_RUN_ID,
  runAttempt = process.env.GITHUB_RUN_ATTEMPT,
  ref = process.env.GITHUB_REF,
  workflowRef = process.env.GITHUB_WORKFLOW_REF,
  workflowSha = process.env.GITHUB_SHA,
} = {}) {
  if (!manifest || manifest.source_file !== INGRESS_FILENAME
    || String(manifest.run_id) !== String(runId)
    || String(manifest.run_attempt) !== String(runAttempt)
    || manifest.ref !== 'refs/heads/main' || ref !== 'refs/heads/main'
    || typeof workflowRef !== 'string'
    || !workflowRef.endsWith('/.github/workflows/publish-android-rc11.yml@refs/heads/main')
    || manifest.workflow_ref !== workflowRef
    || manifest.workflow_sha !== workflowSha
    || manifest.application_id !== RC11_BASELINE.applicationId
    || Number(manifest.version_code) !== RC11_BASELINE.versionCode
    || manifest.version_name !== RC11_BASELINE.versionName
    || String(manifest.size) !== String(RC11_BASELINE.size)) {
    throw new Error('RC11_INGRESS_PROVENANCE_INVALID')
  }
  assertSha(manifest.source_sha256, RC11_BASELINE.sha256, 'RC11_INGRESS_SOURCE_SHA256_MISMATCH')
  assertSha(manifest.sha256, RC11_BASELINE.sha256, 'RC11_INGRESS_SHA256_MISMATCH')
  assertSha(manifest.signer_sha256, RC11_BASELINE.signerSha256, 'RC11_INGRESS_SIGNER_MISMATCH')
  return manifest
}

export function createVersionedObjectKey(kind, { date = new Date(), runId, runAttempt } = {}) {
  if (!['code30-backup', 'rc11'].includes(kind)) throw new Error('COS_OBJECT_KIND_INVALID')
  if (!/^\d+$/.test(String(runId ?? '')) || !/^[1-9]\d*$/.test(String(runAttempt ?? ''))) {
    throw new Error('GITHUB_RUN_ID_INVALID')
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('OBJECT_TIMESTAMP_INVALID')
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, '')
  const filename = kind === 'code30-backup'
    ? `ECFC-1.0.0-beta.21-code30-backup-${timestamp}-run${runId}-attempt${runAttempt}.apk`
    : `ECFC-1.0.0-beta.21-release-beta21-rc11-${timestamp}-run${runId}-attempt${runAttempt}.apk`
  return `android/releases/${filename}`
}

export function validateVersionedObjectKey(key, kind, { runId, runAttempt } = {}) {
  if (typeof key !== 'string' || !key.startsWith('android/releases/')) throw new Error('COS_OBJECT_KEY_INVALID')
  const pattern = kind === 'code30-backup'
    ? /^android\/releases\/ECFC-1\.0\.0-beta\.21-code30-backup-\d{8}-\d{6}-run\d+-attempt\d+\.apk$/
    : /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc11-\d{8}-\d{6}-run\d+-attempt\d+\.apk$/
  if (!pattern.test(key)) throw new Error('COS_OBJECT_KEY_INVALID')
  if (runId !== undefined && !key.includes(`-run${runId}-attempt${runAttempt}.apk`)) {
    throw new Error('COS_OBJECT_KEY_RUN_MISMATCH')
  }
  return key
}

export function validateCosConfig(env = process.env) {
  for (const name of requiredConfig) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`COS_OIDC_CONFIG_MISSING:${name}`)
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(env.TENCENT_CAM_PROVIDER_ID)) throw new Error('COS_OIDC_PROVIDER_ID_INVALID')
  if (!/^qcs::cam::uin\/\d+:roleName\/[A-Za-z0-9+=,.@_-]+$/.test(env.TENCENT_CAM_ROLE_ARN)) {
    throw new Error('COS_OIDC_ROLE_ARN_INVALID')
  }
  if (!/^[A-Za-z0-9._:/-]{1,256}$/.test(env.TENCENT_CAM_OIDC_AUDIENCE)) throw new Error('COS_OIDC_AUDIENCE_INVALID')
  if (env.TENCENT_EXPECTED_OIDC_SUBJECT !== EXPECTED_OIDC_SUBJECT) throw new Error('COS_OIDC_SUBJECT_NOT_WORKFLOW_PINNED')
  if (!/^[A-Za-z0-9-]{2,40}$/.test(env.TENCENT_STS_REGION)
    || !/^[A-Za-z0-9-]{2,40}$/.test(env.TENCENT_COS_REGION)
    || !/^[a-z0-9-]{1,63}-\d{5,}$/.test(env.TENCENT_COS_BUCKET)) {
    throw new Error('COS_REGION_OR_BUCKET_INVALID')
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

async function downloadToFile(url, filePath, { fetchImpl = fetch, expectedSize, expectedSha256 } = {}) {
  let response
  try {
    response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(2_400_000) })
  } catch {
    throw new Error('APK_DOWNLOAD_FAILED')
  }
  if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error('APK_DOWNLOAD_FAILED')

  await mkdir(path.dirname(filePath), { recursive: true })
  const hash = createHash('sha256')
  let size = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      hash.update(chunk)
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
  if (url.protocol !== 'https:' || url.hostname !== 'pipelines.actions.githubusercontent.com') {
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
        DurationSeconds: 1800,
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
  if (stsError || !credentials?.TmpSecretId || !credentials?.TmpSecretKey || !credentials?.Token) {
    throw new Error('TENCENT_STS_CREDENTIALS_UNAVAILABLE')
  }
  return {
    SecretId: credentials.TmpSecretId,
    SecretKey: credentials.TmpSecretKey,
    SecurityToken: credentials.Token,
    ExpiredTime: Number(payload.Response.ExpiredTime),
  }
}

function createCosClient(credentials) {
  const COS = require('cos-nodejs-sdk-v5')
  return new COS({
    SecretId: credentials.SecretId,
    SecretKey: credentials.SecretKey,
    SecurityToken: credentials.SecurityToken,
    Protocol: 'https:',
    UseAccelerate: false,
    FileParallelLimit: 1,
    ChunkParallelLimit: 1,
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

async function uploadImmutableObject({ cos, env, key, filePath, expected }) {
  await assertObjectAbsent(cos, env.TENCENT_COS_BUCKET, env.TENCENT_COS_REGION, key)
  try {
    await cos.putObject({
      Bucket: env.TENCENT_COS_BUCKET,
      Region: env.TENCENT_COS_REGION,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: expected.size,
      ContentType: APK_CONTENT_TYPE,
      CacheControl: APK_CACHE_CONTROL,
      'x-cos-meta-sha256': expected.sha256,
      Headers: { 'x-cos-forbid-overwrite': 'true' },
    })
  } catch {
    throw new Error('COS_UPLOAD_FAILED')
  }

  let metadata
  try {
    metadata = await cos.headObject({ Bucket: env.TENCENT_COS_BUCKET, Region: env.TENCENT_COS_REGION, Key: key })
  } catch {
    throw new Error('COS_OBJECT_METADATA_UNAVAILABLE')
  }
  validateObjectMetadata(metadata, expected)

  const cdnUrl = new URL(key, CDN_BASE_URL).toString()
  const readbackPath = path.join(os.tmpdir(), `ecfc-${expected.sha256}.apk`)
  await downloadToFile(cdnUrl, readbackPath, {
    expectedSize: expected.size,
    expectedSha256: expected.sha256,
  })
  return { key, cdnUrl, metadata }
}

function writeOutput(name, value, env = process.env) {
  if (!/^[A-Z0-9_]+$/.test(name) || /[\r\n]/.test(String(value))) throw new Error('GITHUB_OUTPUT_INVALID')
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT_UNAVAILABLE')
  return writeFile(env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' })
}

async function fetchVersionApi(fetchImpl = fetch) {
  let response
  try {
    response = await fetchImpl(API_VERSION_URL, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new Error('PRODUCTION_VERSION_API_UNAVAILABLE')
  }
  if (!response.ok) throw new Error('PRODUCTION_VERSION_API_UNAVAILABLE')
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error('PRODUCTION_VERSION_API_INVALID')
  }
  return validateCode30VersionApi(body)
}

async function readIngressArtifact(env) {
  const ingressDir = env.RC11_INGRESS_DIRECTORY
  if (!ingressDir) throw new Error('RC11_INGRESS_DIRECTORY_MISSING')
  const apkPath = path.join(ingressDir, INGRESS_FILENAME)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(ingressDir, 'manifest.json'), 'utf8'))
  } catch {
    throw new Error('RC11_INGRESS_MANIFEST_INVALID')
  }
  validateIngressManifest(manifest)
  const actual = await hashFile(apkPath)
  assertSize(actual.size, RC11_BASELINE.size, 'RC11_APK_SIZE_MISMATCH')
  assertSha(actual.sha256, RC11_BASELINE.sha256, 'RC11_APK_SHA256_MISMATCH')
  return { apkPath, manifest }
}

async function getCos(env, fetchImpl = fetch) {
  validateCosConfig(env)
  const credentials = await exchangeForSts(env, fetchImpl)
  if (credentials.ExpiredTime && credentials.ExpiredTime * 1000 <= Date.now() + 60_000) {
    throw new Error('TENCENT_STS_CREDENTIALS_NEAR_EXPIRY')
  }
  return createCosClient(credentials)
}

function runIdentifiers(env) {
  if (!/^\d+$/.test(String(env.GITHUB_RUN_ID ?? '')) || !/^[1-9]\d*$/.test(String(env.GITHUB_RUN_ATTEMPT ?? ''))
    || env.GITHUB_REF !== 'refs/heads/main'
    || !String(env.GITHUB_WORKFLOW_REF ?? '').endsWith('/.github/workflows/publish-android-rc11.yml@refs/heads/main')) {
    throw new Error('GITHUB_RELEASE_CONTEXT_INVALID')
  }
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }
}

export async function publishCode30Backup({ env = process.env, fetchImpl = fetch, date = new Date() } = {}) {
  runIdentifiers(env)
  const apiBody = await fetchVersionApi(fetchImpl)
  const baselinePath = path.join(env.RUNNER_TEMP || os.tmpdir(), 'android-version-api-code30-baseline.json')
  await writeFile(baselinePath, `${JSON.stringify(apiBody, null, 2)}\n`, { flag: 'wx' })
  const sourcePath = path.join(env.RUNNER_TEMP || os.tmpdir(), 'ecfc-beta21-code30-source.apk')
  await downloadToFile(apiBody.downloadUrl, sourcePath, {
    fetchImpl,
    expectedSize: CODE30_BASELINE.size,
    expectedSha256: CODE30_BASELINE.sha256,
  })
  const cos = await getCos(env, fetchImpl)
  const key = createVersionedObjectKey('code30-backup', { ...runIdentifiers(env), date })
  await uploadImmutableObject({ cos, env, key, filePath: sourcePath, expected: CODE30_BASELINE })
  await writeOutput('CODE30_BACKUP_OBJECT_KEY', key, env)
  await writeOutput('CODE30_BACKUP_CDN_URL', new URL(key, CDN_BASE_URL).toString(), env)
  return { key, baselinePath }
}

export async function publishRc11Artifact({ env = process.env, fetchImpl = fetch, date = new Date() } = {}) {
  const ids = runIdentifiers(env)
  const backupKey = validateVersionedObjectKey(env.CODE30_BACKUP_OBJECT_KEY, 'code30-backup', ids)
  await downloadToFile(new URL(backupKey, CDN_BASE_URL).toString(), path.join(env.RUNNER_TEMP || os.tmpdir(), 'ecfc-beta21-code30-backup-readback.apk'), {
    fetchImpl,
    expectedSize: CODE30_BASELINE.size,
    expectedSha256: CODE30_BASELINE.sha256,
  })
  const { apkPath } = await readIngressArtifact(env)
  const cos = await getCos(env, fetchImpl)
  const key = createVersionedObjectKey('rc11', { ...ids, date })
  await uploadImmutableObject({ cos, env, key, filePath: apkPath, expected: RC11_BASELINE })
  await writeOutput('RC11_OBJECT_KEY', key, env)
  await writeOutput('RC11_CDN_URL', new URL(key, CDN_BASE_URL).toString(), env)
  await writeOutput('RC11_SHA256', RC11_BASELINE.sha256, env)
  await writeOutput('RC11_SIZE', RC11_BASELINE.size, env)
  return { key, cdnUrl: new URL(key, CDN_BASE_URL).toString(), backupKey }
}

async function main() {
  const command = process.argv[2]
  if (command === 'backup-code30') {
    const result = await publishCode30Backup()
    console.log(`CODE30_BACKUP_VERIFIED=YES\nCODE30_BACKUP_OBJECT_KEY=${result.key}`)
    return
  }
  if (command === 'publish-rc11') {
    const result = await publishRc11Artifact()
    console.log(`RC11_CDN_VERIFIED=YES\nRC11_OBJECT_KEY=${result.key}`)
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
