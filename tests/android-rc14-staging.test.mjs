import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createVersionedObjectKey, validateVersionedObjectKey, verifyRollbackSourceRange, publishRc14Artifact } from '../scripts/android-rc11-cos-publish.mjs'
import { RC13_BASELINE } from '../scripts/android-rc14-release.mjs'

test('RC14 staging object key is scoped to release and unique run', () => {
  const key = createVersionedObjectKey('rc14', { date: new Date('2026-11-10T12:34:56Z'), runId: '123', runAttempt: '2' })
  assert.equal(key, 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc14-20261110-123456-run123-attempt2.apk')
  assert.equal(validateVersionedObjectKey(key, 'rc14', { runId: '123', runAttempt: '2' }), key)
  assert.throws(() => validateVersionedObjectKey(key, 'rc14', { runId: '124', runAttempt: '2' }), /COS_OBJECT_KEY_RUN_MISMATCH/)
  assert.throws(() => validateVersionedObjectKey(key, 'rc13'), /COS_OBJECT_KEY_INVALID/)
})

test('RC14 checks the original RC13 rollback source and its precise size', async () => {
  const result = await verifyRollbackSourceRange('rc14', async (url, options) => {
    assert.ok(url.endsWith(RC13_BASELINE.objectKey))
    assert.equal(options.headers.Range, 'bytes=0-0')
    return { ok: true, status: 206, url, headers: new Headers({ 'content-range': `bytes 0-0/${RC13_BASELINE.size}` }), body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0])); controller.close() } }) }
  })
  assert.equal(result.code, 33)
  await assert.rejects(verifyRollbackSourceRange('rc14', async () => ({ ok: false, status: 403 })), /CODE33_ROLLBACK_SOURCE_UNAVAILABLE/)
})

test('RC14 missing reviewed artifact pin fails before any upload', async () => {
  await assert.rejects(publishRc14Artifact({ env: {} }), /RC14_ARTIFACT_PIN_NOT_READY/)
})

test('RC14 staging requires protected ingress, same-run pin, production and OIDC', () => {
  const workflow = readFileSync(new URL('../.github/workflows/publish-android-rc11.yml', import.meta.url), 'utf8')
  for (const expected of [/- rc14/, /android-rc14-release\.mjs.*validate/, /android-rc14-release\.json/,
    /assert-release-main\.mjs/, /publish-rc14/, /id-token:\s*write/, /name:\s*Production/,
    /verify-android-apk-signature\.mjs/, /EXPECTED_SHA256/, /EXPECTED_SIZE/]) assert.match(workflow, expected)
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/)
})

test('draft metadata verification retains immutable code33 and signed candidate gates', () => {
  const workflow = readFileSync(new URL('../.github/workflows/configure-android-version.yml', import.meta.url), 'utf8')
  const start = workflow.indexOf('      - name: Validate RC14 signer and the immutable code33 rollback source')
  const end = workflow.indexOf('      - name: Preserve RC13 release baseline snapshot', start)
  assert.ok(start >= 0 && end > start)
  const step = workflow.slice(start, end)
  for (const text of ['android-rc14-release.mjs', 'CODE33_ROLLBACK_OBJECT_KEY', 'verify-android-apk-signature.mjs', 'PRODUCTION_VERSION_API_NOT_EXPECTED_CODE33', 'CODE33_ROLLBACK_SOURCE_URL_MISMATCH', 'verify_apk "\${code33_source}" 33', 'verify_apk "\${rc14_apk}" 34']) assert.ok(step.includes(text), text)
  const options = workflow.slice(workflow.indexOf('release_candidate:'), workflow.indexOf('apk_object_key:'))
  assert.doesNotMatch(options, /- rc14/, 'RC14 must not be selectable before complete release and rollback gates are wired')
})

test('code33 rollback is protected, verifies the immutable APK and uses code34 CAS', () => {
  const workflow = readFileSync(new URL('../.github/workflows/rollback-android-version-to-code33.yml', import.meta.url), 'utf8')
  for (const text of ['workflow_dispatch:', 'production-deploy', 'cancel-in-progress: false', 'environment: Production',
    'assert-release-main.mjs', 'android-rc14-release.mjs validate', 'CODE33_ROLLBACK_SOURCE_SHA256_MISMATCH',
    'verify-android-apk-signature.mjs', 'RC14_LIVE_OBJECT_MISMATCH', 'expectedCurrentMetadata:',
    'ANDROID_RELEASE_OPERATION=rollback-code33', 'PRODUCTION_VERSION_API_CODE33_NOT_RESTORED',
    'PUBLIC_CODE33_APK_SHA256_MISMATCH', 'PRODUCTION_HEALTH_MISMATCH']) assert.ok(workflow.includes(text), text)
  assert.doesNotMatch(workflow, /prisma migrate|DATABASE_URL|cos:DeleteObject|continue-on-error:\s*true/i)
})
