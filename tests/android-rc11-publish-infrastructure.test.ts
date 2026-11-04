import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import os from 'node:os'

// Wrangler is already a pinned dev dependency and directly carries this YAML parser.
// Resolve it from Wrangler so infra-only test changes do not touch app manifests or trigger deploy.
const wranglerRequire = createRequire(createRequire(import.meta.url).resolve('wrangler'))
const { parse } = wranglerRequire('yaml') as { parse: (source: string) => unknown }
import {
  CODE30_BASELINE,
  CODE30_ROLLBACK_OBJECT_KEY,
  CODE31_BASELINE,
  CODE31_ROLLBACK_OBJECT_KEY,
  RC11_BASELINE,
  RC12_BASELINE,
  APK_DOWNLOAD_TIMEOUT_MS,
  COS_REQUEST_TIMEOUT_MS,
  COS_STS_DURATION_SECONDS,
  COS_STS_MINIMUM_UPLOAD_REMAINING_SECONDS,
  EXPECTED_COS_BUCKET,
  EXPECTED_COS_REGION,
  assertStsCredentialLifetime,
  EXPECTED_OIDC_SUBJECT,
  captureVersionApiBaseline,
  assertObjectAbsent,
  createCosClient,
  createVersionedObjectKey,
  downloadToFile,
  validateCode30VersionApi,
  validateCode31VersionApi,
  validateCosConfig,
  validateIngressManifest,
  validateObjectMetadata,
  validateOidcClaims,
  validateVersionedObjectKey,
  getStsExpiryInfo,
  verifyCosReadOnlyAccess,
  verifyOidcSts,
} from '../scripts/android-rc11-cos-publish.mjs'
import { assertReleaseMainBranch } from '../scripts/assert-release-main.mjs'
import { CODE32_ROLLBACK_OBJECT_KEY } from '../scripts/android-rc13-release.mjs'
import { assertNativeBearerRollbackResult } from '../scripts/assert-native-bearer-rollback-result.mjs'
import { assertApksignerOutputMatches, parseApksignerOutput } from '../scripts/verify-android-apk-signature.mjs'

const repoRoot = process.cwd()
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8')
const testWorkflowRef = 'andkdiids/EasonFansClub/.github/workflows/publish-android-rc11.yml@refs/heads/main'
const testRun = { runId: '123456789', runAttempt: '2' }
const testWorkflowSha = 'a'.repeat(40)

test('RC11 and code30 SHA, size, package, version, and signing baselines are fixed', () => {
  assert.deepEqual(RC11_BASELINE, {
    applicationId: 'fans.ecfc.app',
    versionCode: 31,
    versionName: '1.0.0-beta.21',
    size: 183802143,
    sha256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
  })
  assert.deepEqual(CODE30_BASELINE, {
    applicationId: 'fans.ecfc.app',
    versionCode: 30,
    versionName: '1.0.0-beta.21',
    size: 184246197,
    sha256: 'D2CA0817E23431EFAB87E992BA544C4B213981E3E8651D67AF49324B440FC967',
    signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
  })
})



test('RC12 baseline is code32 with the same package and signing certificate', () => {
  assert.deepEqual(RC12_BASELINE, {
    applicationId: 'fans.ecfc.app',
    versionCode: 32,
    versionName: '1.0.0-beta.21',
    size: 180263015,
    sha256: '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271',
    signerSha256: RC11_BASELINE.signerSha256,
  })
  assert.equal(CODE31_BASELINE.sha256, RC11_BASELINE.sha256)
  assert.equal(CODE31_BASELINE.size, RC11_BASELINE.size)
  assert.equal(CODE31_BASELINE.versionCode, 31)
})

test('the code31 Version API baseline matches the current RC11 release', () => {
  const baseline = {
    platform: 'android',
    versionName: CODE31_BASELINE.versionName,
    versionCode: CODE31_BASELINE.versionCode,
    size: CODE31_BASELINE.size,
    apkSha256: CODE31_BASELINE.sha256.toLowerCase(),
    minimumVersionCode: 19,
    forceUpdate: false,
    downloadUrl: 'https://ecfc.fans/api/app/download/android',
    releaseNotes: ['a', 'b', 'c', 'd', 'e', 'f'],
    publishedAt: '2026-11-03T00:00:00Z',
  }
  assert.equal(validateCode31VersionApi(baseline), baseline)
  assert.throws(() => validateCode31VersionApi({ ...baseline, versionCode: 30 }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE31/)
})

test('staging captures the expected current Version API baseline read-only before the new upload', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ecfc-version-baseline-test-'))
  t.after(async () => rm(tempDir, { recursive: true, force: true }))
  const baseline = {
    platform: 'android',
    versionName: CODE31_BASELINE.versionName,
    versionCode: CODE31_BASELINE.versionCode,
    size: CODE31_BASELINE.size,
    apkSha256: CODE31_BASELINE.sha256.toLowerCase(),
    minimumVersionCode: 19,
    forceUpdate: false,
    downloadUrl: 'https://ecfc.fans/api/app/download/android',
    releaseNotes: ['a', 'b', 'c', 'd', 'e', 'f'],
    publishedAt: '2026-11-03T00:00:00Z',
  }
  let requestUrl = ''
  let rangeRequestUrl = ''
  const result = await captureVersionApiBaseline({
    candidate: 'rc12',
    env: { RUNNER_TEMP: tempDir },
    fetchImpl: async (input, init) => {
      const url = String(input)
      if (url === 'https://ecfc.fans/api/app/version?platform=android') {
        requestUrl = url
        assert.equal(init?.redirect, 'error')
        return new Response(JSON.stringify(baseline), { status: 200 })
      }
      rangeRequestUrl = url
      assert.equal((init?.headers as Record<string, string>)?.Range, 'bytes=0-0')
      const response = new Response(new Uint8Array([1]), {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${CODE31_BASELINE.size}` },
      })
      Object.defineProperty(response, 'url', { value: url })
      return response
    },
  })
  assert.equal(requestUrl, 'https://ecfc.fans/api/app/version?platform=android')
  assert.equal(rangeRequestUrl, `https://media.ecfc.fans/media/${CODE31_ROLLBACK_OBJECT_KEY}`)
  assert.deepEqual(result.body, baseline)
  assert.equal(result.rollbackSource.key, CODE31_ROLLBACK_OBJECT_KEY)
  assert.equal(JSON.parse(await readFile(result.baselinePath, 'utf8')).versionCode, 31)
  await assert.rejects(() => captureVersionApiBaseline({
    candidate: 'rc12',
    env: { RUNNER_TEMP: tempDir },
    fetchImpl: async () => new Response(JSON.stringify({ ...baseline, versionCode: 30 }), { status: 200 }),
  }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE31/)
  await assert.rejects(() => captureVersionApiBaseline({
    candidate: 'rc12',
    env: { RUNNER_TEMP: tempDir },
    fetchImpl: async (input) => String(input).includes('/api/app/version?')
      ? new Response(JSON.stringify(baseline), { status: 200 })
      : new Response(null, { status: 404 }),
  }), /CODE31_ROLLBACK_SOURCE_UNAVAILABLE/)
})

test('RC12 ingress manifest and unique COS objects bind code32 to this main workflow run', () => {
  const manifest = {
    release_candidate: 'rc12',
    source_file: 'ECFC-1.0.0-beta.21-release-RC12-code32.apk',
    source_sha256: RC12_BASELINE.sha256,
    sha256: RC12_BASELINE.sha256,
    size: RC12_BASELINE.size,
    application_id: RC12_BASELINE.applicationId,
    version_code: RC12_BASELINE.versionCode,
    version_name: RC12_BASELINE.versionName,
    signer_sha256: RC12_BASELINE.signerSha256,
    run_id: testRun.runId,
    run_attempt: testRun.runAttempt,
    ref: 'refs/heads/main',
    workflow_ref: testWorkflowRef,
    workflow_sha: testWorkflowSha,
  }
  const context = { ...testRun, ref: 'refs/heads/main', workflowRef: testWorkflowRef, workflowSha: testWorkflowSha }
  assert.equal(validateIngressManifest(manifest, { ...context, candidate: 'rc12' }), manifest)
  assert.throws(() => validateIngressManifest({ ...manifest, release_candidate: 'rc11' }, { ...context, candidate: 'rc12' }), /RC12_INGRESS_PROVENANCE_INVALID/)
  const release = createVersionedObjectKey('rc12', { ...testRun, date: new Date('2026-11-03T12:00:00Z') })
  assert.match(release, /release-beta21-rc12-20261103-120000-run123456789-attempt2\.apk$/)
  assert.equal(validateVersionedObjectKey(release, 'rc12', testRun), release)
  assert.equal(CODE31_ROLLBACK_OBJECT_KEY, 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk')
  assert.throws(() => createVersionedObjectKey('code31-backup' as 'rc11', testRun), /COS_OBJECT_KIND_INVALID/)
})

test('RC11 signer verifier-only changes do not trigger the default production deployment', () => {
  const deployWorkflowText = read('.github/workflows/deploy.yml')
  const pushTrigger = deployWorkflowText.match(/on:\s*\n\s*push:\s*\n([\s\S]*?)\n\s*workflow_dispatch:/)?.[1]
  assert.ok(pushTrigger)
  assert.match(pushTrigger, /paths-ignore:/)
  assert.match(pushTrigger, /'scripts\/verify-android-apk-signature\.mjs'/)
  assert.match(pushTrigger, /'scripts\/verify-android-apk-signature\.d\.mts'/)
})

const expectedSignerSha256 = '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B'

function apksignerOutput({ signerCount = 1, fingerprints = [expectedSignerSha256] }: { signerCount?: number; fingerprints?: string[] } = {}) {
  return [
    'Verifies',
    'Verified using v2 scheme (APK Signature Scheme v2): true',
    `Number of signers: ${signerCount}`,
    ...fingerprints.map((fingerprint, index) => `Signer #${index + 1} certificate SHA-256 digest: ${fingerprint}`),
  ].join('\n')
}

test('apksigner parser accepts standard compact and colon-separated SHA-256 output', () => {
  assert.deepEqual(parseApksignerOutput(apksignerOutput()), { signerCount: 1, sha256: expectedSignerSha256 })
  const colonSeparated = expectedSignerSha256.match(/.{2}/g)!.join(':').toLowerCase()
  assert.equal(parseApksignerOutput(apksignerOutput({ fingerprints: [colonSeparated] })).sha256, expectedSignerSha256)
})

test('apksigner parser tolerates CRLF and surrounding whitespace without weakening digest validation', () => {
  const output = apksignerOutput({ fingerprints: [`  ${expectedSignerSha256.match(/.{2}/g)!.join(':')}  `] })
    .replace(/\n/g, '\r\n')
  assert.equal(assertApksignerOutputMatches(output, expectedSignerSha256).sha256, expectedSignerSha256)
  assert.throws(() => parseApksignerOutput(apksignerOutput({ fingerprints: ['not-a-fingerprint'] })), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(apksignerOutput({ fingerprints: [expectedSignerSha256.slice(1)] })), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(apksignerOutput({ fingerprints: [`${expectedSignerSha256}A`] })), /SIGNER_PARSE_FAILED/)
})

test('apksigner parser distinguishes missing output, multiple signers, and a valid different signer', () => {
  assert.throws(() => parseApksignerOutput(''), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput('Number of signers: 1'), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(apksignerOutput({ signerCount: 2, fingerprints: [expectedSignerSha256, 'A'.repeat(64)] })), /SIGNER_COUNT_INVALID/)
  assert.throws(() => assertApksignerOutputMatches(apksignerOutput({ fingerprints: ['A'.repeat(64)] }), expectedSignerSha256), /SIGNER_MISMATCH/)
})

test('the code30 API baseline must match the known public rollback release', () => {
  const baseline = {
    platform: 'android',
    versionName: CODE30_BASELINE.versionName,
    versionCode: CODE30_BASELINE.versionCode,
    size: CODE30_BASELINE.size,
    apkSha256: CODE30_BASELINE.sha256.toLowerCase(),
    minimumVersionCode: 19,
    forceUpdate: false,
    downloadUrl: 'https://ecfc.fans/api/app/download/android',
    releaseNotes: ['a', 'b', 'c', 'd', 'e', 'f'],
    publishedAt: '2026-11-01T00:00:00Z',
  }
  assert.equal(validateCode30VersionApi(baseline), baseline)
  assert.throws(() => validateCode30VersionApi({ ...baseline, versionCode: 31 }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE30/)
  assert.throws(() => validateCode30VersionApi({ ...baseline, downloadUrl: 'https://attacker.invalid/apk' }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE30/)
})

test('ingress artifact provenance binds exact bytes to this main-branch workflow run', () => {
  const manifest = {
    release_candidate: 'rc11',
    source_file: 'ECFC-1.0.0-beta.21-release-RC11-20261102-152136.apk',
    source_sha256: RC11_BASELINE.sha256,
    sha256: RC11_BASELINE.sha256,
    size: RC11_BASELINE.size,
    application_id: RC11_BASELINE.applicationId,
    version_code: RC11_BASELINE.versionCode,
    version_name: RC11_BASELINE.versionName,
    signer_sha256: RC11_BASELINE.signerSha256,
    run_id: testRun.runId,
    run_attempt: testRun.runAttempt,
    ref: 'refs/heads/main',
    workflow_ref: testWorkflowRef,
    workflow_sha: testWorkflowSha,
  }
  const context = { ...testRun, ref: 'refs/heads/main', workflowRef: testWorkflowRef, workflowSha: testWorkflowSha }
  assert.equal(validateIngressManifest(manifest, context), manifest)
  assert.throws(() => validateIngressManifest({ ...manifest, sha256: 'B'.repeat(64) }, context), /RC11_INGRESS_SHA256_MISMATCH/)
  assert.throws(() => validateIngressManifest({ ...manifest, source_sha256: 'B'.repeat(64) }, context), /RC11_INGRESS_SOURCE_SHA256_MISMATCH/)
  assert.throws(() => validateIngressManifest(manifest, { ...context, runId: 'other-run' }), /RC11_INGRESS_PROVENANCE_INVALID/)
  assert.throws(() => validateIngressManifest(manifest, { ...context, ref: 'refs/heads/feature' }), /RC11_INGRESS_PROVENANCE_INVALID/)
})

test('new release object keys are unique; existing code30 and code31 rollback sources are fixed and immutable', () => {
  const date = new Date('2026-11-02T15:21:36.000Z')
  const release = createVersionedObjectKey('rc11', { ...testRun, date })
  assert.match(release, /release-beta21-rc11-20261102-152136-run123456789-attempt2\.apk$/)
  assert.notEqual(release, createVersionedObjectKey('rc11', { runId: '123456789', runAttempt: '3', date }))
  assert.equal(validateVersionedObjectKey(release, 'rc11', testRun), release)
  assert.equal(CODE30_ROLLBACK_OBJECT_KEY, 'android/releases/ECFC-1.0.0-beta.21-code30-backup-20261102-205634-run41523510243-attempt1.apk')
  assert.equal(CODE31_ROLLBACK_OBJECT_KEY, 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk')
  assert.throws(() => createVersionedObjectKey('code30-backup' as 'rc11', { ...testRun, date }), /COS_OBJECT_KIND_INVALID/)
  assert.throws(() => validateVersionedObjectKey(release, 'rc11', { runId: '123456789', runAttempt: '1' }), /COS_OBJECT_KEY_RUN_MISMATCH/)
})

test('RC12 publication pins code32 and reuses the original immutable code31 rollback source', () => {
  const stageText = read('.github/workflows/publish-android-rc11.yml')
  const stage = parse(stageText) as {
    concurrency: { group: string; 'cancel-in-progress': boolean }
    on: { workflow_dispatch: { inputs: Record<string, { default?: string; options?: string[] }> } }
    jobs: Record<string, { environment?: { name?: string } | string; steps: Array<{ name?: string; if?: string; run?: string; env?: Record<string, string> }> }>
  }
  assert.deepEqual(stage.on.workflow_dispatch.inputs.release_candidate.options, ['rc11', 'rc12', 'rc13'])
  assert.equal(stage.on.workflow_dispatch.inputs.release_candidate.default, 'rc11')
  assert.equal(stage.concurrency.group, 'production-deploy')
  assert.equal(stage.concurrency['cancel-in-progress'], false)
  const cos = stage.jobs.cos
  assert.equal(typeof cos.environment === 'object' ? cos.environment?.name : cos.environment, 'Production')
  const backupStep = cos.steps.find((step) => step.name?.toLowerCase().includes('backup'))
  assert.equal(backupStep, undefined)
  const baselineIndex = cos.steps.findIndex((step) => step.name?.includes('Capture the current Android Version API baseline'))
  const uploadIndex = cos.steps.findIndex((step) => step.name?.includes('Upload the immutable RC12 candidate'))
  assert.ok(baselineIndex >= 0 && uploadIndex > baselineIndex)
  assert.match(cos.steps[uploadIndex].if ?? '', /release_candidate == 'rc12'/)
  assert.match(cos.steps[uploadIndex].run ?? '', /publish-rc12/)
  for (const [key, variable] of [
    ['TENCENT_CAM_OIDC_AUDIENCE', 'TENCENT_CAM_OIDC_AUDIENCE'],
    ['TENCENT_EXPECTED_OIDC_SUBJECT', 'TENCENT_EXPECTED_OIDC_SUBJECT'],
    ['TENCENT_CAM_PROVIDER_ID', 'TENCENT_CAM_PROVIDER_ID'],
    ['TENCENT_CAM_ROLE_ARN', 'TENCENT_CAM_ROLE_ARN'],
    ['TENCENT_STS_REGION', 'TENCENT_STS_REGION'],
    ['TENCENT_COS_BUCKET', 'TENCENT_COS_BUCKET'],
    ['TENCENT_COS_REGION', 'TENCENT_COS_REGION'],
  ]) assert.match(cos.steps[uploadIndex].env?.[key] ?? '', new RegExp(`vars\\.${variable}`))
  assert.match(stageText, /50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271/)
  assert.match(stageText, /180263015/)
  assert.doesNotMatch(stageText, /backup-code30|backup-code31|CODE30_BACKUP_OBJECT_KEY|CODE31_BACKUP_OBJECT_KEY/)
  assert.doesNotMatch(stageText, /PLACEHOLDER|__[A-Z0-9_]+__/)

  const configureText = read('.github/workflows/configure-android-version.yml')
  assert.match(configureText, /RELEASE_CANDIDATE.*rc12/)
  assert.match(configureText, /CODE31_ROLLBACK_OBJECT_KEY/)
  assert.doesNotMatch(configureText, /code(?:30|31)_backup_object_key|CODE(?:30|31)_BACKUP_OBJECT_KEY|CODE31_BACKUP_REQUIRED/)
  assert.match(configureText, /RC12_RELEASE_BASELINE_MISMATCH/)
  assert.match(configureText, /PRODUCTION_VERSION_API_CODE32=VERIFIED/)
  assert.match(configureText, /LIVE_DOWNLOAD_SIGNATURE_MATCH_CODE32=YES/)
  assert.match(configureText, /VERSION_API_BASELINE_CHANGED/)
  assert.doesNotMatch(configureText, /DATABASE_URL|prisma migrate|migration deploy/i)

  const rollbackText = read('.github/workflows/rollback-android-version-to-code31.yml')
  const rollback = parse(rollbackText) as {
    concurrency: { group: string; 'cancel-in-progress': boolean }
    jobs: Record<string, { environment?: { name?: string } | string }>
  }
  assert.equal(rollback.concurrency.group, 'production-deploy')
  assert.equal(rollback.concurrency['cancel-in-progress'], false)
  assert.equal(typeof rollback.jobs.rollback.environment === 'object' ? rollback.jobs.rollback.environment?.name : rollback.jobs.rollback.environment, 'Production')
  assert.match(rollbackText, /ANDROID_RELEASE_OPERATION=rollback-code31/)
  assert.match(rollbackText, /CODE31_ROLLBACK_OBJECT_KEY/)
  assert.doesNotMatch(rollbackText, /code31_backup_object_key|CODE31_BACKUP_OBJECT_KEY/)
  assert.match(rollbackText, /50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271/)
  assert.match(rollbackText, /9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C/)
  assert.match(rollbackText, /VERSION_API_CODE31_RESTORED=VERIFIED/)
  assert.doesNotMatch(rollbackText, /DATABASE_URL|prisma migrate|migration deploy/i)
})
test('COS trust settings require explicit configured identifiers and never use a static key', () => {
  const env = {
    TENCENT_CAM_OIDC_AUDIENCE: 'configured-test-audience',
    TENCENT_EXPECTED_OIDC_SUBJECT: EXPECTED_OIDC_SUBJECT,
    TENCENT_CAM_PROVIDER_ID: 'configured-test-provider',
    TENCENT_CAM_ROLE_ARN: 'qcs::cam::uin/123456789:roleName/test-role',
    TENCENT_STS_REGION: 'ap-guangzhou',
    TENCENT_COS_BUCKET: 'ecfc-1306412725',
    TENCENT_COS_REGION: 'ap-guangzhou',
  }
  assert.equal(validateCosConfig(env), env)
  assert.equal(EXPECTED_COS_BUCKET, 'ecfc-1306412725')
  assert.equal(EXPECTED_COS_REGION, 'ap-guangzhou')
  assert.match(EXPECTED_OIDC_SUBJECT, /workflow_ref:andkdiids\/EasonFansClub\/\.github\/workflows\/publish-android-rc11\.yml@refs\/heads\/main$/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_CAM_OIDC_AUDIENCE: '' }), /COS_OIDC_CONFIG_MISSING/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_CAM_ROLE_ARN: 'not-an-arn' }), /COS_OIDC_ROLE_ARN_INVALID/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_EXPECTED_OIDC_SUBJECT: 'repo:andkdiids/EasonFansClub:environment:Production' }), /COS_OIDC_SUBJECT_NOT_WORKFLOW_PINNED/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_COS_BUCKET: 'other-1306412725' }), /COS_RELEASE_TARGET_MISMATCH/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_COS_REGION: 'ap-shanghai' }), /COS_RELEASE_TARGET_MISMATCH/)
})

test('OIDC claim simulation accepts only the exact issuer, audience, subject, Production environment, main run, and workflow', () => {
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: ['configured-test-audience'],
    sub: EXPECTED_OIDC_SUBJECT,
    environment: 'Production',
    repository: 'andkdiids/EasonFansClub',
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    workflow_ref: testWorkflowRef,
  }
  const trusted = {
    audience: 'configured-test-audience',
    expectedSubject: claims.sub,
    workflowRef: testWorkflowRef,
  }
  assert.equal(validateOidcClaims(claims, trusted), true)
  for (const [key, value] of [
    ['iss', 'https://untrusted.invalid'],
    ['aud', ['other-audience']],
    ['sub', 'repo:andkdiids/EasonFansClub:ref:refs/heads/main'],
    ['environment', 'Development'],
    ['repository', 'untrusted/repository'],
    ['ref', 'refs/heads/feature'],
    ['event_name', 'pull_request'],
    ['workflow_ref', 'andkdiids/EasonFansClub/.github/workflows/other.yml@refs/heads/main'],
  ] as const) {
    assert.throws(() => validateOidcClaims({ ...claims, [key]: value }, trusted), /GITHUB_OIDC_TRUST_BOUNDARY_MISMATCH/)
  }
})

test('COS metadata readback requires exact size, MIME type, immutable cache policy, and SHA metadata', () => {
  const result = {
    statusCode: 200,
    headers: {
      'Content-Length': String(RC11_BASELINE.size),
      'Content-Type': 'application/vnd.android.package-archive',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-cos-meta-sha256': RC11_BASELINE.sha256.toLowerCase(),
    },
  }
  assert.equal(validateObjectMetadata(result, RC11_BASELINE), true)
  assert.throws(() => validateObjectMetadata({ ...result, headers: { ...result.headers, 'content-length': '1' } }, RC11_BASELINE), /COS_OBJECT_METADATA_MISMATCH/)
  assert.throws(() => validateObjectMetadata({ ...result, headers: { ...result.headers, 'cache-control': 'no-cache' } }, RC11_BASELINE), /COS_OBJECT_METADATA_MISMATCH/)
})

test('COS object preflight permits only a verified 404 and rejects existing or unknown state', async () => {
  await assertObjectAbsent({ headObject: async () => ({ statusCode: 404 }) }, 'bucket', 'region', 'key')
  await assert.rejects(() => assertObjectAbsent({ headObject: async () => ({ statusCode: 200 }) }, 'bucket', 'region', 'key'), /COS_OBJECT_KEY_ALREADY_EXISTS/)
  await assert.rejects(() => assertObjectAbsent({ headObject: async () => ({ statusCode: 403 }) }, 'bucket', 'region', 'key'), /COS_OBJECT_EXISTENCE_UNVERIFIED/)
  await assert.rejects(() => assertObjectAbsent({ headObject: async () => { throw new Error('network') } }, 'bucket', 'region', 'key'), /COS_OBJECT_EXISTENCE_UNVERIFIED/)
})

test('COS requests and APK downloads have bounded timeouts that fit inside the staging job', () => {
  assert.equal(APK_DOWNLOAD_TIMEOUT_MS, 20 * 60 * 1000)
  assert.equal(COS_REQUEST_TIMEOUT_MS, 10 * 60 * 1000)
  assert.ok(2 * APK_DOWNLOAD_TIMEOUT_MS + 3 * COS_REQUEST_TIMEOUT_MS + 120_000 < 90 * 60 * 1000)

  let clientOptions: Record<string, unknown> | undefined
  class FakeCos {
    constructor(options: Record<string, unknown>) {
      clientOptions = options
    }
  }
  createCosClient({ SecretId: 'test-id', SecretKey: 'test-key', SecurityToken: 'test-session' }, FakeCos)
  assert.equal(clientOptions?.Timeout, COS_REQUEST_TIMEOUT_MS)
  assert.equal(clientOptions?.Protocol, 'https:')
})

test('APK downloader records safe stage progress and verifies bytes', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ecfc-download-stage-test-'))
  const apkPath = path.join(temporaryDirectory, 'fixture.apk')
  const bytes = new TextEncoder().encode('small signed apk fixture')
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase()
  const logLines: string[] = []
  let requestSignal: AbortSignal | null | undefined
  const response = {
    ok: true,
    status: 200,
    url: 'https://cdn.example.test/apk',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  } as Response

  try {
    const downloaded = await downloadToFile('https://cdn.example.test/apk?token=must-not-appear-in-logs', apkPath, {
      fetchImpl: async (_input, init) => {
        requestSignal = init?.signal
        return response
      },
      expectedSize: bytes.length,
      expectedSha256,
      stage: 'TEST_APK_DOWNLOAD',
      logImpl: (line) => logLines.push(line),
    })

    assert.equal(requestSignal instanceof AbortSignal, true)
    assert.equal(requestSignal?.aborted, false)
    assert.equal(downloaded.size, bytes.length)
    assert.equal(downloaded.sha256, expectedSha256)
    assert.deepEqual(await readFile(apkPath), Buffer.from(bytes))
    assert.ok(logLines.some((line) => line.startsWith('RELEASE_PROGRESS=TEST_APK_DOWNLOAD_START')))
    assert.ok(logLines.some((line) => line.startsWith('RELEASE_PROGRESS=TEST_APK_DOWNLOAD_RESPONSE status=200')))
    assert.ok(logLines.some((line) => line.startsWith('RELEASE_PROGRESS=TEST_APK_DOWNLOAD_COMPLETE')))
    assert.doesNotMatch(logLines.join('\n'), /cdn\.example|token=|must-not-appear/)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('production branch checks fail closed for unprotected, moved, or non-main revisions', () => {
  const branch = { name: 'main', protected: true, commit: { sha: testWorkflowSha } }
  assert.deepEqual(assertReleaseMainBranch({ branch, expectedSha: testWorkflowSha, ref: 'refs/heads/main' }), {
    protected: true,
    sha: testWorkflowSha,
  })
  assert.throws(() => assertReleaseMainBranch({ branch: { ...branch, protected: false }, expectedSha: testWorkflowSha, ref: 'refs/heads/main' }), /MAIN_BRANCH_PROTECTION_REQUIRED/)
  assert.throws(() => assertReleaseMainBranch({ branch, expectedSha: 'b'.repeat(40), ref: 'refs/heads/main' }), /MAIN_BRANCH_MOVED_OR_SHA_INVALID/)
  assert.throws(() => assertReleaseMainBranch({ branch, expectedSha: testWorkflowSha, ref: 'refs/heads/feature' }), /RELEASE_WORKFLOW_REQUIRES_MAIN/)
})

test('workflow simulation binds ingress, no-old-APK-upload, Production, OIDC least privilege, and concurrency', () => {
  const workflowText = read('.github/workflows/publish-android-rc11.yml')
  const workflow = parse(workflowText) as {
    concurrency: { group: string; 'cancel-in-progress': boolean }
    jobs: Record<string, { needs?: string | string[]; environment?: { name?: string } | string; permissions?: Record<string, string>; steps: Array<Record<string, unknown>> }>
  }
  const ingress = workflow.jobs.ingress
  const cos = workflow.jobs.cos
  assert.equal(workflow.concurrency.group, 'production-deploy')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(typeof ingress.environment === 'object' ? ingress.environment.name : ingress.environment, 'Production')
  assert.equal(cos.environment && typeof cos.environment === 'object' ? cos.environment.name : cos.environment, 'Production')
  assert.deepEqual(cos.needs, 'ingress')
  assert.equal(cos.permissions?.['id-token'], 'write')
  assert.equal(cos.permissions?.deployments, undefined)
  assert.equal(ingress.permissions?.['id-token'], undefined)
  const stepNames = cos.steps.map((step) => String(step.name))
  assert.equal(stepNames.some((name) => name.toLowerCase().includes('backup')), false)
  const baselineIndex = stepNames.findIndex((name) => name.includes('Capture the current Android Version API baseline'))
  const rc11Index = stepNames.findIndex((name) => name.includes('Upload the immutable RC11 candidate'))
  assert.ok(baselineIndex >= 0 && rc11Index > baselineIndex)
  assert.match(String(cos.steps[rc11Index].run), /publish-rc11/)
  assert.doesNotMatch(workflowText, /backup-code30|backup-code31|CODE30_BACKUP_OBJECT_KEY|CODE31_BACKUP_OBJECT_KEY/)
  assert.match(workflowText, /actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(workflowText, /actions\/download-artifact@[0-9a-f]{40}/)
  assert.doesNotMatch(workflowText, /continue-on-error:\s*true|cos:DeleteObject|TENCENT_COS_SECRET_(?:ID|KEY)/)
  assert.match(workflowText, /RC11-20261102-152136\.apk/)
  assert.match(workflowText, /verify --print-certs/)
  const configureWorkflowText = read('.github/workflows/configure-android-version.yml')
  assert.equal((configureWorkflowText.match(/verify-android-apk-signature\.mjs/g) || []).length, 5)
  assert.doesNotMatch(configureWorkflowText, /certificate SHA-256 digest.*awk/)
  assert.match(workflowText, /aapt dump badging/)
})

test('Android release infrastructure CI is pull-request-only and does not access production', () => {
  const workflowText = read('.github/workflows/android-release-infra-ci.yml')
  const workflow = parse(workflowText) as {
    on: { pull_request: { branches: string[]; paths: string[] } }
    permissions: Record<string, string>
    jobs: Record<string, { environment?: unknown; permissions?: Record<string, string>; steps: Array<Record<string, unknown>> }>
  }
  assert.deepEqual(Object.keys(workflow.on), ['pull_request'])
  assert.deepEqual(workflow.on.pull_request.branches, ['main'])
  assert.ok(workflow.on.pull_request.paths.includes('.github/workflows/android-release-infra-ci.yml'))
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  const job = workflow.jobs['release-infrastructure']
  assert.equal(job.environment, undefined)
  assert.equal(job.permissions, undefined)
  const commands = job.steps.map((step) => String(step.run || '')).join('\n')
  assert.match(commands, /tsx --test tests\/android-rc11-publish-infrastructure\.test\.ts/)
  assert.match(commands, /tsc --noEmit/)
  assert.match(commands, /eslint scripts\/android-rc11-cos-publish\.mjs/)
  assert.match(commands, /git diff --check/)
  assert.doesNotMatch(workflowText, /workflow_dispatch:|id-token:\s*write|environment:\s*Production|TENCENT_|SERVER_SSH_KEY/)
  assert.match(workflowText, /run: node -e "console\\.log\\(require\\.resolve\\('cos-nodejs-sdk-v5'\\)\\)"/)
  assert.equal((workflowText.match(/cos-nodejs-sdk-v5/g) ?? []).length, 1)
})
test('COS publish simulation uploads only the new immutable candidate and verifies its complete CDN bytes', () => {
  const publisher = read('scripts/android-rc11-cos-publish.mjs')
  const releaseStart = publisher.indexOf('export async function publishRc11Artifact')
  const uploadStart = publisher.indexOf('async function uploadImmutableObject')
  const releaseSection = publisher.slice(releaseStart, publisher.indexOf('async function main'))
  const uploadSection = publisher.slice(uploadStart, publisher.indexOf('function writeOutput'))
  assert.doesNotMatch(publisher, /publishCode30Backup|publishCode31Backup|backup-code30|backup-code31|CODE30_BACKUP_OBJECT_KEY|CODE31_BACKUP_OBJECT_KEY/)
  assert.doesNotMatch(releaseSection, /BACKUP|ROLLBACK/)
  assert.match(releaseSection, /await readIngressArtifact/)
  assert.match(releaseSection, /await uploadImmutableObject/)
  assert.ok(uploadSection.indexOf('await assertObjectAbsent') < uploadSection.indexOf('await multipartUpload'))
  assert.match(publisher, /Timeout: COS_REQUEST_TIMEOUT_MS/)
  assert.match(publisher, /AbortSignal\.timeout\(APK_DOWNLOAD_TIMEOUT_MS\)/)
  assert.ok(uploadSection.indexOf('await multipartUpload') < uploadSection.indexOf('await cos.headObject'))
  assert.ok(uploadSection.indexOf('await cos.headObject') < uploadSection.indexOf('await downloadFile(cdnUrl'))
  assert.match(read('scripts/android-rc13-multipart.mjs'), /'x-cos-forbid-overwrite': 'true'/)
  assert.doesNotMatch(publisher, /TENCENT_COS_SECRET_(?:ID|KEY)|DeleteObject|putBucketPolicy|deleteObject/)
})

test('RC3 through RC10 retain timestamp keys while RC11 and RC12 require run-scoped keys', () => {
  const configure = read('.github/workflows/configure-android-version.yml')
  assert.match(configure, /release-beta21-\$\{RELEASE_CANDIDATE\}-\[0-9\]\{8\}-\[0-9\]\{6\}/)
  assert.match(configure, /release-beta21-\$\{RELEASE_CANDIDATE\}-\[0-9\]\{8\}-\[0-9\]\{6\}-run\[0-9\]\+-attempt/)
  assert.match(configure, /expected_current_b64=''[\r\n]+[ \t]*if \[\[/)
  const legacy = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc10-20261030-211051.apk'
  assert.match(legacy, /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc10-\d{8}-\d{6}\.apk$/)
  assert.doesNotMatch(legacy, /-run\d+-attempt\d+\.apk$/)
})

test('manual server rollback requires Production, the shared lock, the recorded old SHA, and post-switch health', () => {
  const workflowText = read('.github/workflows/rollback-native-bearer-server.yml')
  const workflow = parse(workflowText) as { concurrency: { group: string; 'cancel-in-progress': boolean }; jobs: Record<string, { environment?: { name?: string }; steps: Array<Record<string, unknown>> }> }
  assert.equal(workflow.concurrency.group, 'production-deploy')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs.rollback.environment?.name, 'Production')
  assert.match(workflowText, /assert-release-main\.mjs/)
  assert.match(workflowText, /EXPECTED_ROLLBACK_SHA/)
  assert.match(workflowText, /scripts\/rollback-production-git\.sh/)
  assert.match(workflowText, /api\/health\/live/)
  assert.match(workflowText, /\[\[ "\$result" == RESTORED/)
  const rollback = read('scripts/rollback-production-git.sh')
  const oldShaCheck = rollback.indexOf('Recorded rollback target does not match the requested rollback SHA')
  const switchCall = rollback.indexOf('deploy_atomic_switch "$rollback_target"')
  assert.ok(oldShaCheck > 0 && switchCall > oldShaCheck)
  assert.match(rollback, /flock -w 360 9/)
  assert.match(rollback, /verify_local_health \|\| die/)
})

test('manual rollback execution simulation rejects stale current, wrong recorded old SHA, and failed health', () => {
  const current = 'c'.repeat(40)
  const old = 'b'.repeat(40)
  const success = {
    expectedProductionSha: current,
    expectedRollbackSha: old,
    rollbackResult: 'RESTORED',
    verifiedRollbackSha: old,
    publicHealthSha: old,
  }
  assert.deepEqual(assertNativeBearerRollbackResult(success), { status: 'VERIFIED', sha: old })
  assert.throws(() => assertNativeBearerRollbackResult({ ...success, expectedProductionSha: old }), /ROLLBACK_EXPECTED_SHA_INVALID/)
  assert.throws(() => assertNativeBearerRollbackResult({ ...success, rollbackResult: 'SKIPPED_CURRENT_SHA_CHANGED' }), /ROLLBACK_SERVER_SHA_NOT_VERIFIED/)
  assert.throws(() => assertNativeBearerRollbackResult({ ...success, verifiedRollbackSha: 'a'.repeat(40) }), /ROLLBACK_SERVER_SHA_NOT_VERIFIED/)
  assert.throws(() => assertNativeBearerRollbackResult({ ...success, publicHealthSha: 'a'.repeat(40) }), /ROLLBACK_PUBLIC_HEALTH_SHA_NOT_VERIFIED/)
})


test('OIDC-only dispatch defaults to verification and is mutually exclusive with release staging', () => {
  const workflowText = read('.github/workflows/publish-android-rc11.yml')
  const workflow = parse(workflowText) as {
    on: { workflow_dispatch: { inputs: Record<string, { default?: boolean; required?: boolean; type?: string }> } }
    jobs: Record<string, { if?: string; needs?: string | string[]; environment?: { name?: string } | string; 'timeout-minutes'?: number; permissions?: Record<string, string>; steps: Array<Record<string, unknown>> }>
  }
  const input = workflow.on.workflow_dispatch.inputs.verify_oidc_only
  assert.equal(input.type, 'boolean')
  assert.equal(input.required, true)
  assert.equal(input.default, true)

  const verify = workflow.jobs.verify_oidc
  const ingress = workflow.jobs.ingress
  const cos = workflow.jobs.cos
  const verifyNodeSetupIndex = verify.steps.findIndex((step) => String(step.uses ?? '').startsWith('actions/setup-node@'))
  const verifyPnpmSetupIndex = verify.steps.findIndex((step) => String(step.uses ?? '').startsWith('pnpm/action-setup@'))
  const cosPnpmSetup = cos.steps.find((step) => String(step.uses ?? '').startsWith('pnpm/action-setup@'))
  const verifyPnpmSetup = verify.steps[verifyPnpmSetupIndex]
  const verifyProductionInstallIndex = verify.steps.findIndex((step) => String(step.run ?? '').trim() === 'pnpm install --prod --frozen-lockfile --ignore-scripts')
  const verifyResolveIndex = verify.steps.findIndex((step) => String(step.run ?? '').includes("require.resolve('cos-nodejs-sdk-v5')"))
  assert.ok(verifyNodeSetupIndex >= 0)
  assert.ok(verifyPnpmSetupIndex > verifyNodeSetupIndex)
  assert.ok(cosPnpmSetup)
  assert.deepEqual(verifyPnpmSetup, cosPnpmSetup)
  assert.ok(verifyProductionInstallIndex > verifyPnpmSetupIndex)
  assert.ok(verifyResolveIndex > verifyProductionInstallIndex)
  assert.match(read('.github/workflows/android-release-infra-ci.yml'), /require\.resolve\('cos-nodejs-sdk-v5'\)/)
  assert.equal(verify['timeout-minutes'], 10)
  assert.equal(ingress['timeout-minutes'], 20)
  assert.equal(cos['timeout-minutes'], 60)
  assert.match(verify.if ?? '', /inputs\.verify_oidc_only == true/)
  assert.match(ingress.if ?? '', /inputs\.verify_oidc_only == false/)
  assert.match(cos.if ?? '', /inputs\.verify_oidc_only == false/)
  assert.equal(verify.needs, undefined)
  assert.equal(typeof verify.environment === 'object' ? verify.environment?.name : verify.environment, 'Production')
  assert.equal(verify.permissions?.['id-token'], 'write')
  assert.equal(verify.permissions?.contents, 'read')
  const verifySteps = JSON.stringify(verify.steps)
  assert.match(verifySteps, /scripts\/android-rc11-cos-publish\.mjs verify-cos-readonly/)
  assert.match(verifySteps, /TENCENT_COS_BUCKET/)
  assert.match(verifySteps, /TENCENT_COS_REGION/)
  assert.doesNotMatch(verifySteps, /putObject|multipartUpload|multipartAbort|uploadFile|publish-rc13|backup-code30|upload-artifact|rollback|version-api/i)
  const verifyStep = verify.steps.find((step) => String(step.run ?? '').includes('verify-cos-readonly')) as { env: Record<string, string> }
  const rc13PublishStep = cos.steps.find((step) => String(step.run ?? '').includes('publish-rc13')) as { env: Record<string, string> }
  assert.ok(verifyStep)
  assert.ok(rc13PublishStep)
  for (const name of [
    'TENCENT_CAM_OIDC_AUDIENCE',
    'TENCENT_EXPECTED_OIDC_SUBJECT',
    'TENCENT_CAM_PROVIDER_ID',
    'TENCENT_CAM_ROLE_ARN',
    'TENCENT_STS_REGION',
    'TENCENT_COS_BUCKET',
    'TENCENT_COS_REGION',
  ]) assert.equal(verifyStep.env[name], rc13PublishStep.env[name], `verify/staging env mismatch: ${name}`)
})

test('STS lease requests two hours and logs expiry without credential values', () => {
  assert.equal(COS_STS_DURATION_SECONDS, 7200)
  assert.equal(COS_STS_MINIMUM_UPLOAD_REMAINING_SECONDS, 900)
  const info = getStsExpiryInfo({ ExpiredTime: 1_900_000_000 }, 1_800_000_000_000)
  assert.equal(info.expiredAt, '2030-03-17T17:46:40.000Z')
  assert.equal(info.remainingSeconds, 100_000_000)
  assert.throws(
    () => assertStsCredentialLifetime({ ExpiredTime: Math.floor((1_800_000_000_000 + 899_000) / 1000) }, 900, 1_800_000_000_000),
    /TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME/,
  )
  assert.equal(assertStsCredentialLifetime({ ExpiredTime: Math.floor((1_800_000_000_000 + 900_000) / 1000) }, 900, 1_800_000_000_000).remainingSeconds, 900)
})

test('read-only COS gate checks unversioned bucket, code32 HEAD, and a one-byte authenticated GET', async () => {
  const calls: Array<{ method: string; options: Record<string, unknown> }> = []
  const logs: string[] = []
  const cos = {
    getBucketVersioning: async (options: Record<string, unknown>) => {
      calls.push({ method: 'GetBucketVersioning', options })
      return { VersioningConfiguration: {} }
    },
    headObject: async (options: Record<string, unknown>) => {
      calls.push({ method: 'HeadObject', options })
      return { statusCode: 200, headers: { 'content-length': String(RC12_BASELINE.size) } }
    },
    getObject: async (options: Record<string, unknown>) => {
      calls.push({ method: 'GetObject', options })
      return { statusCode: 206, Body: Buffer.from([0]) }
    },
  }
  const result = await verifyCosReadOnlyAccess({ cos, bucket: 'ecfc-1306412725', region: 'ap-guangzhou', log: (line) => logs.push(line) })
  assert.deepEqual(calls.map((call) => call.method), ['GetBucketVersioning', 'HeadObject', 'GetObject'])
  assert.equal(calls[0].options.Bucket, 'ecfc-1306412725')
  assert.equal(calls[0].options.Region, 'ap-guangzhou')
  assert.equal(calls[1].options.Key, CODE32_ROLLBACK_OBJECT_KEY)
  assert.equal((calls[2].options as { Range?: string }).Range, 'bytes=0-0')
  assert.equal(result.versioning, 'DISABLED')
  assert.match(logs.join('\n'), /COS_BUCKET_VERSIONING_RESPONSE=\{"VersioningConfiguration":\{\}\}/)
  assert.match(logs.join('\n'), /GetBucketVersioning=PASS HeadObject=PASS GetObject=PASS/)
})

test('read-only COS gate fails closed for enabled, suspended, and unknown versioning states', async () => {
  for (const [configuration, error] of [
    [{ Status: 'Enabled' }, /COS_BUCKET_VERSIONING_ENABLED/],
    [{ Status: 'Suspended' }, /COS_BUCKET_VERSIONING_SUSPENDED/],
    [{ Unexpected: 'value' }, /COS_BUCKET_VERSIONING_UNKNOWN/],
  ] as const) {
    let objectReads = 0
    await assert.rejects(verifyCosReadOnlyAccess({
      cos: {
        getBucketVersioning: async () => ({ VersioningConfiguration: configuration }),
        headObject: async () => { objectReads++; return { statusCode: 200, headers: { 'content-length': String(RC12_BASELINE.size) } } },
        getObject: async () => { objectReads++; return { statusCode: 206, Body: Buffer.from([0]) } },
      },
      bucket: 'ecfc-1306412725',
      region: 'ap-guangzhou',
      log: () => {},
    }), error)
    assert.equal(objectReads, 0)
  }
})

test('OIDC endpoint diagnostic parses credentials and emits only the seven allowed fields', () => {
  const workflow = parse(read('.github/workflows/publish-android-rc11.yml')) as {
    jobs: Record<string, { steps: Array<{ id?: string; run?: string; env?: unknown }> }>
  }
  const steps = workflow.jobs.verify_oidc.steps
  const diagnostic = steps.find((step) => step.id === 'diagnose_oidc_endpoint')
  assert.ok(diagnostic)
  const run = diagnostic.run ?? ''
  assert.match(run, /process\.env\.ACTIONS_ID_TOKEN_REQUEST_URL/)
  assert.match(run, /process\.env\.ACTIONS_ID_TOKEN_REQUEST_TOKEN/)
  assert.doesNotMatch(
    run,
    /\bfetch\s*\(|\bcurl\b|https?\.request|core\.getIDToken|AssumeRoleWithWebIdentity|\bSTS\b|\bCOS\b|TENCENT_COS_|putObject|publish-rc11|backup-code30|upload-artifact|rollback|version-api|configure-android-version|\/api\/app\/version|verify-oidc/i
  )
  assert.equal(diagnostic.env, undefined)
  assert.ok(steps.indexOf(diagnostic) < steps.findIndex((step) => (step.run ?? '').includes('verify-cos-readonly')))
  const js = run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)?.[1]
  assert.ok(js)
  const expectedFields = [
    'OIDC_URL_PRESENT',
    'OIDC_TOKEN_PRESENT',
    'OIDC_URL_LENGTH',
    'OIDC_PROTOCOL',
    'OIDC_HOSTNAME',
    'OIDC_PORT',
    'OIDC_CREDENTIALS',
  ]
  const runDiagnostic = (endpoint: string, token: string) => {
    const result = spawnSync(process.execPath, ['-e', js], {
      encoding: 'utf8',
      env: { ...process.env, ACTIONS_ID_TOKEN_REQUEST_URL: endpoint, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const lines = result.stdout.trimEnd().split(/\r?\n/)
    assert.deepEqual(lines.map((line) => line.slice(0, line.indexOf('='))), expectedFields)
    const output = Object.fromEntries(lines.map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    })) as Record<string, string>
    return { lines, output }
  }

  const hidden = ['diagnostic-user', 'diagnostic-password', 'query-secret', 'dummy-request-token']
  const credentialUrl = 'https://diagnostic-user:diagnostic-password@oidc.example.test:8443/request?key=query-secret'
  const credentialResult = runDiagnostic(credentialUrl, 'dummy-request-token')
  assert.equal(credentialResult.output.OIDC_CREDENTIALS, 'YES')
  assert.equal(credentialResult.output.OIDC_HOSTNAME, 'oidc.example.test')
  assert.equal(credentialResult.output.OIDC_PORT, '8443')
  assert.ok(hidden.every((value) => !credentialResult.lines.join('\n').includes(value)))

  const usernameOnlyUrl = 'https://diagnostic-user@oidc.example.test:8443/request?key=query-secret'
  const usernameOnlyResult = runDiagnostic(usernameOnlyUrl, 'dummy-request-token')
  assert.equal(usernameOnlyResult.output.OIDC_CREDENTIALS, 'YES')
  assert.ok(hidden.every((value) => !usernameOnlyResult.lines.join('\n').includes(value)))
  const passwordOnlyUrl = 'https://:diagnostic-password@oidc.example.test:8443/request?key=query-secret'
  const passwordOnlyResult = runDiagnostic(passwordOnlyUrl, 'dummy-request-token')
  assert.equal(passwordOnlyResult.output.OIDC_CREDENTIALS, 'YES')
  assert.ok(hidden.every((value) => !passwordOnlyResult.lines.join('\n').includes(value)))

  const publicUrl = 'https://oidc.example.test:443/request?key=query-secret'
  const publicResult = runDiagnostic(publicUrl, 'dummy-request-token')
  assert.equal(publicResult.output.OIDC_CREDENTIALS, 'NO')
  assert.equal(publicResult.output.OIDC_PORT, '443')
  assert.ok(hidden.every((value) => !publicResult.lines.join('\n').includes(value)))

  const invalidResult = runDiagnostic('https://[invalid', 'dummy-request-token')
  assert.equal(invalidResult.output.OIDC_CREDENTIALS, 'INVALID')
  assert.equal(invalidResult.output.OIDC_PROTOCOL, 'INVALID')
  assert.equal(invalidResult.output.OIDC_HOSTNAME, 'INVALID')
  assert.equal(invalidResult.output.OIDC_PORT, 'INVALID')
  assert.ok(hidden.every((value) => !invalidResult.lines.join('\n').includes(value)))

  const missingResult = runDiagnostic('', '')
  assert.equal(missingResult.output.OIDC_URL_PRESENT, 'NO')
  assert.equal(missingResult.output.OIDC_TOKEN_PRESENT, 'NO')
  assert.equal(missingResult.output.OIDC_URL_LENGTH, '0')
  assert.equal(missingResult.output.OIDC_PROTOCOL, 'NONE')
  assert.equal(missingResult.output.OIDC_HOSTNAME, 'NONE')
  assert.equal(missingResult.output.OIDC_PORT, 'NONE')
  assert.equal(missingResult.output.OIDC_CREDENTIALS, 'INVALID')
})

test('OIDC-only verifier reuses the STS exchange, validates trust, and never returns credentials', async () => {
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: ['configured-test-audience'],
    sub: EXPECTED_OIDC_SUBJECT,
    environment: 'Production',
    repository: 'andkdiids/EasonFansClub',
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    workflow_ref: testWorkflowRef,
  }
  const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`
  const env = {
    TENCENT_CAM_OIDC_AUDIENCE: 'configured-test-audience',
    TENCENT_EXPECTED_OIDC_SUBJECT: EXPECTED_OIDC_SUBJECT,
    TENCENT_CAM_PROVIDER_ID: 'configured-test-provider',
    TENCENT_CAM_ROLE_ARN: 'qcs::cam::uin/123456789:roleName/test-role',
    TENCENT_STS_REGION: 'ap-guangzhou',
    GITHUB_WORKFLOW_REF: testWorkflowRef,
    GITHUB_RUN_ID: testRun.runId,
    GITHUB_RUN_ATTEMPT: testRun.runAttempt,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/request',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-request-credential',
  }
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.startsWith('https://pipelines.actions.githubusercontent.com/')) {
      assert.equal(new URL(url).searchParams.get('audience'), env.TENCENT_CAM_OIDC_AUDIENCE)
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-request-credential')
      return new Response(JSON.stringify({ value: jwt }), { status: 200 })
    }
    assert.equal(url, 'https://sts.tencentcloudapi.com')
    assert.equal(init?.method, 'POST')
    assert.equal(new Headers(init?.headers).get('x-tc-action'), 'AssumeRoleWithWebIdentity')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.DurationSeconds, 7200)
    assert.equal(body.WebIdentityToken, jwt)
    assert.equal(body.RoleSessionName, 'gha-123456789-2')
    assert.equal(body.RoleArn, env.TENCENT_CAM_ROLE_ARN)
    assert.equal(body.ProviderId, env.TENCENT_CAM_PROVIDER_ID)
    return new Response(JSON.stringify({ Response: {
      Credentials: { TmpSecretId: 'test-temporary-id', TmpSecretKey: 'test-temporary-key', Token: 'test-session-token' },
      ExpiredTime: 1_900_000_000,
    } }), { status: 200 })
  }

  const stsLogs: string[] = []
  assert.equal(await verifyOidcSts({ env, fetchImpl, now: () => 1_800_000_000_000, log: (line) => stsLogs.push(line) }), true)
  assert.equal(requests.length, 2)
  assert.ok(requests[0].url.startsWith('https://pipelines.actions.githubusercontent.com/'))
  assert.equal(requests[1].url, 'https://sts.tencentcloudapi.com')
  assert.match(stsLogs.join('\n'), /TENCENT_STS_EXPIRED_TIME=2030-03-17T17:46:40\.000Z TENCENT_STS_REMAINING_SECONDS=100000000/)
  assert.doesNotMatch(stsLogs.join('\n'), /test-temporary-id|test-temporary-key|test-session-token|test-request-credential/)
})

test('OIDC endpoint validation accepts official endpoints and rejects unsafe URL variants before any request', async () => {
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: ['configured-test-audience'],
    sub: EXPECTED_OIDC_SUBJECT,
    environment: 'Production',
    repository: 'andkdiids/EasonFansClub',
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    workflow_ref: testWorkflowRef,
  }
  const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`
  const baseEnv = {
    TENCENT_CAM_OIDC_AUDIENCE: 'configured-test-audience',
    TENCENT_EXPECTED_OIDC_SUBJECT: EXPECTED_OIDC_SUBJECT,
    TENCENT_CAM_PROVIDER_ID: 'configured-test-provider',
    TENCENT_CAM_ROLE_ARN: 'qcs::cam::uin/123456789:roleName/test-role',
    TENCENT_STS_REGION: 'ap-guangzhou',
    GITHUB_WORKFLOW_REF: testWorkflowRef,
    GITHUB_RUN_ID: testRun.runId,
    GITHUB_RUN_ATTEMPT: testRun.runAttempt,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-request-credential',
  }
  const fetchFor = (expectedOidcHostname: string, requests: string[]) => async (input: RequestInfo | URL) => {
    const requestUrl = String(input)
    requests.push(requestUrl.startsWith('https://sts.tencentcloudapi.com') ? 'sts' : 'github-oidc')
    if (requestUrl.startsWith('https://sts.tencentcloudapi.com')) {
      return new Response(JSON.stringify({ Response: {
        Credentials: {
          TmpSecretId: 'test-temporary-id',
          TmpSecretKey: 'test-temporary-key',
          Token: 'test-session-token',
        },
        ExpiredTime: 1_900_000_000,
      } }), { status: 200 })
    }
    assert.equal(new URL(requestUrl).hostname, expectedOidcHostname)
    return new Response(JSON.stringify({ value: jwt }), { status: 200 })
  }

  const allowedEndpoints = [
    ['https://pipelines.actions.githubusercontent.com/request', 'pipelines.actions.githubusercontent.com'],
    ['https://run-actions-2-azure-eastus.actions.githubusercontent.com/request', 'run-actions-2-azure-eastus.actions.githubusercontent.com'],
  ] as const
  for (const [endpoint, hostname] of allowedEndpoints) {
    const requests: string[] = []
    assert.equal(await verifyOidcSts({
      env: { ...baseEnv, ACTIONS_ID_TOKEN_REQUEST_URL: endpoint },
      fetchImpl: fetchFor(hostname, requests),
    }), true)
    assert.deepEqual(requests, ['github-oidc', 'sts'])
  }

  const rejectedEndpoints = [
    'https://evilactions.githubusercontent.com/request',
    'https://actions.githubusercontent.com.example.com/request',
    'http://run-actions-2-azure-eastus.actions.githubusercontent.com/request',
    'https://run-actions-2-azure-eastus.actions.githubusercontent.com:8443/request',
    'https://diagnostic-user:diagnostic-password@run-actions-2-azure-eastus.actions.githubusercontent.com/request',
  ]
  for (const endpoint of rejectedEndpoints) {
    const requests: string[] = []
    await assert.rejects(
      verifyOidcSts({
        env: { ...baseEnv, ACTIONS_ID_TOKEN_REQUEST_URL: endpoint },
        fetchImpl: fetchFor('unused.example.invalid', requests),
      }),
      (error: Error) => error.message === 'GITHUB_OIDC_ENDPOINT_INVALID',
    )
    assert.deepEqual(requests, [])
  }

  const requests: string[] = []
  const missingUrlEnv = { ...baseEnv, ACTIONS_ID_TOKEN_REQUEST_URL: undefined }
  await assert.rejects(
    verifyOidcSts({
      env: missingUrlEnv,
      fetchImpl: fetchFor('unused.example.invalid', requests),
    }),
    (error: Error) => error.message === 'GITHUB_OIDC_ENDPOINT_UNAVAILABLE',
  )
  assert.deepEqual(requests, [])
})
test('OIDC-only STS errors are explicit and omit untrusted response details', async () => {
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: ['configured-test-audience'],
    sub: EXPECTED_OIDC_SUBJECT,
    environment: 'Production',
    repository: 'andkdiids/EasonFansClub',
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    workflow_ref: testWorkflowRef,
  }
  const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`
  const env = {
    TENCENT_CAM_OIDC_AUDIENCE: 'configured-test-audience',
    TENCENT_EXPECTED_OIDC_SUBJECT: EXPECTED_OIDC_SUBJECT,
    TENCENT_CAM_PROVIDER_ID: 'configured-test-provider',
    TENCENT_CAM_ROLE_ARN: 'qcs::cam::uin/123456789:roleName/test-role',
    TENCENT_STS_REGION: 'ap-guangzhou',
    GITHUB_WORKFLOW_REF: testWorkflowRef,
    GITHUB_RUN_ID: testRun.runId,
    GITHUB_RUN_ATTEMPT: testRun.runAttempt,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/request',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-request-credential',
  }
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).startsWith('https://pipelines.actions.githubusercontent.com/')) {
      return new Response(JSON.stringify({ value: jwt }), { status: 200 })
    }
    return new Response(JSON.stringify({ Response: { Error: { Code: 'InvalidIdentityToken', Message: 'sensitive-provider-detail' } } }), { status: 200 })
  }
  await assert.rejects(verifyOidcSts({ env, fetchImpl }), (error: Error) => {
    assert.equal(error.message, 'TENCENT_STS_REJECTED_WEB_IDENTITY')
    assert.doesNotMatch(error.message, /test-request-credential|sensitive-provider-detail/)
    return true
  })
})
