import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import {
  CODE30_BASELINE,
  RC11_BASELINE,
  EXPECTED_OIDC_SUBJECT,
  assertObjectAbsent,
  createVersionedObjectKey,
  validateCode30VersionApi,
  validateCosConfig,
  validateIngressManifest,
  validateObjectMetadata,
  validateOidcClaims,
  validateVersionedObjectKey,
  verifyOidcSts,
} from '../scripts/android-rc11-cos-publish.mjs'
import { assertReleaseMainBranch } from '../scripts/assert-release-main.mjs'
import { assertNativeBearerRollbackResult } from '../scripts/assert-native-bearer-rollback-result.mjs'

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

test('versioned COS keys are unique per workflow attempt and keep code30 apart from RC11', () => {
  const date = new Date('2026-11-02T15:21:36.000Z')
  const backup = createVersionedObjectKey('code30-backup', { ...testRun, date })
  const release = createVersionedObjectKey('rc11', { ...testRun, date })
  assert.match(backup, /code30-backup-20261102-152136-run123456789-attempt2\.apk$/)
  assert.match(release, /release-beta21-rc11-20261102-152136-run123456789-attempt2\.apk$/)
  assert.notEqual(backup, release)
  assert.notEqual(release, createVersionedObjectKey('rc11', { runId: '123456789', runAttempt: '3', date }))
  assert.equal(validateVersionedObjectKey(backup, 'code30-backup', testRun), backup)
  assert.equal(validateVersionedObjectKey(release, 'rc11', testRun), release)
  assert.throws(() => validateVersionedObjectKey(release, 'rc11', { runId: '123456789', runAttempt: '1' }), /COS_OBJECT_KEY_RUN_MISMATCH/)
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
  assert.match(EXPECTED_OIDC_SUBJECT, /workflow_ref:andkdiids\/EasonFansClub\/\.github\/workflows\/publish-android-rc11\.yml@refs\/heads\/main$/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_CAM_OIDC_AUDIENCE: '' }), /COS_OIDC_CONFIG_MISSING/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_CAM_ROLE_ARN: 'not-an-arn' }), /COS_OIDC_ROLE_ARN_INVALID/)
  assert.throws(() => validateCosConfig({ ...env, TENCENT_EXPECTED_OIDC_SUBJECT: 'repo:andkdiids/EasonFansClub:environment:Production' }), /COS_OIDC_SUBJECT_NOT_WORKFLOW_PINNED/)
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

test('workflow simulation binds ingress, backup-before-RC11 upload, Production, OIDC least privilege, and concurrency', () => {
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
  const backupIndex = stepNames.findIndex((name) => name.includes('independent code30 backup'))
  const rc11Index = stepNames.findIndex((name) => name.includes('Upload RC11 only after'))
  assert.ok(backupIndex >= 0 && rc11Index > backupIndex)
  assert.match(String(cos.steps[rc11Index].run), /publish-rc11/)
  assert.match(workflowText, /CODE30_BACKUP_OBJECT_KEY: \$\{\{ steps\.backup\.outputs\.CODE30_BACKUP_OBJECT_KEY \}\}/)
  assert.match(workflowText, /actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(workflowText, /actions\/download-artifact@[0-9a-f]{40}/)
  assert.doesNotMatch(workflowText, /continue-on-error:\s*true|cos:DeleteObject|TENCENT_COS_SECRET_(?:ID|KEY)/)
  assert.match(workflowText, /RC11-20261102-152136\.apk/)
  assert.match(workflowText, /apksigner verify --print-certs/)
  assert.match(workflowText, /aapt dump badging/)
})

test('COS publish simulation verifies absence, uploads code30 first, reads metadata, then checks complete CDN bytes', () => {
  const publisher = read('scripts/android-rc11-cos-publish.mjs')
  const backupStart = publisher.indexOf('export async function publishCode30Backup')
  const releaseStart = publisher.indexOf('export async function publishRc11Artifact')
  const uploadStart = publisher.indexOf('async function uploadImmutableObject')
  const backupSection = publisher.slice(backupStart, releaseStart)
  const releaseSection = publisher.slice(releaseStart, publisher.indexOf('async function main'))
  const uploadSection = publisher.slice(uploadStart, publisher.indexOf('function writeOutput'))
  assert.ok(backupSection.indexOf('await downloadToFile(apiBody.downloadUrl') < backupSection.indexOf('await uploadImmutableObject'))
  assert.ok(releaseSection.indexOf('await downloadToFile(new URL(backupKey') < releaseSection.indexOf('await uploadImmutableObject'))
  assert.ok(uploadSection.indexOf('await assertObjectAbsent') < uploadSection.indexOf('await cos.putObject'))
  assert.ok(uploadSection.indexOf('await cos.putObject') < uploadSection.indexOf('await cos.headObject'))
  assert.ok(uploadSection.indexOf('await cos.headObject') < uploadSection.indexOf('await downloadToFile(cdnUrl'))
  assert.match(uploadSection, /Headers: \{ 'x-cos-forbid-overwrite': 'true' \}/)
  assert.doesNotMatch(publisher, /TENCENT_COS_SECRET_(?:ID|KEY)|DeleteObject|putBucketPolicy|deleteObject/)
})

test('RC3 through RC10 retain their timestamp key format while RC11 requires run-scoped keys', () => {
  const configure = read('.github/workflows/configure-android-version.yml')
  assert.match(configure, /release-beta21-\$\{RELEASE_CANDIDATE\}-\[0-9\]\{8\}-\[0-9\]\{6\}/)
  assert.match(configure, /release-beta21-rc11-\[0-9\]\{8\}-\[0-9\]\{6\}-run\[0-9\]\+/)
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
    jobs: Record<string, { if?: string; needs?: string | string[]; environment?: { name?: string } | string; permissions?: Record<string, string>; steps: Array<Record<string, unknown>> }>
  }
  const input = workflow.on.workflow_dispatch.inputs.verify_oidc_only
  assert.equal(input.type, 'boolean')
  assert.equal(input.required, true)
  assert.equal(input.default, true)

  const verify = workflow.jobs.verify_oidc
  const ingress = workflow.jobs.ingress
  const cos = workflow.jobs.cos
  assert.match(verify.if ?? '', /inputs\.verify_oidc_only == true/)
  assert.match(ingress.if ?? '', /inputs\.verify_oidc_only == false/)
  assert.match(cos.if ?? '', /inputs\.verify_oidc_only == false/)
  assert.equal(verify.needs, undefined)
  assert.equal(typeof verify.environment === 'object' ? verify.environment?.name : verify.environment, 'Production')
  assert.equal(verify.permissions?.['id-token'], 'write')
  assert.equal(verify.permissions?.contents, 'read')
  const verifySteps = JSON.stringify(verify.steps)
  assert.match(verifySteps, /scripts\/android-rc11-cos-publish\.mjs verify-oidc/)
  assert.doesNotMatch(verifySteps, /TENCENT_COS_(?:BUCKET|REGION)|putObject|publish-rc11|backup-code30|upload-artifact|rollback|version-api/i)
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
  assert.ok(steps.indexOf(diagnostic) < steps.findIndex((step) => (step.run ?? '').includes('verify-oidc')))
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
    assert.equal(body.WebIdentityToken, jwt)
    assert.equal(body.RoleSessionName, 'gha-123456789-2')
    assert.equal(body.RoleArn, env.TENCENT_CAM_ROLE_ARN)
    assert.equal(body.ProviderId, env.TENCENT_CAM_PROVIDER_ID)
    return new Response(JSON.stringify({ Response: { Credentials: {
      TmpSecretId: 'test-temporary-id', TmpSecretKey: 'test-temporary-key', Token: 'test-session-token', ExpiredTime: 1_900_000_000,
    } } }), { status: 200 })
  }

  assert.equal(await verifyOidcSts({ env, fetchImpl }), true)
  assert.equal(requests.length, 2)
  assert.ok(requests[0].url.startsWith('https://pipelines.actions.githubusercontent.com/'))
  assert.equal(requests[1].url, 'https://sts.tencentcloudapi.com')
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
  const jwt = \`e30.\${Buffer.from(JSON.stringify(claims)).toString('base64url')}.\test-signature\`
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
      return new Response(JSON.stringify({ Response: { Credentials: {
        TmpSecretId: 'test-temporary-id',
        TmpSecretKey: 'test-temporary-key',
        Token: 'test-session-token',
        ExpiredTime: 1_900_000_000,
      } } }), { status: 200 })
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
