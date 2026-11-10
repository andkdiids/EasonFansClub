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
