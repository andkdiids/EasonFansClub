import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RC14_BASELINE, validateBeta22Pin, validateCode34VersionApi } from '../scripts/android-beta22-release.mjs'
import { createVersionedObjectKey, validateVersionedObjectKey } from '../scripts/android-rc11-cos-publish.mjs'
const reviewed = JSON.parse(readFileSync(new URL('../scripts/android-beta22-release.json', import.meta.url), 'utf8'))
const candidate = { ...reviewed, sha256: 'A'.repeat(64), size: 180000000 }
test('Beta22 uses the reviewed six-note metadata contract and rejects incomplete artifact evidence', () => {
  assert.equal(validateBeta22Pin(candidate), candidate)
  for (const changes of [{ sha256: null }, { size: null }, { versionCode: 34 }, { versionName: '1.0.0-beta.21' }, { sourcePath: 'C:\\other.apk' }, { signerSha256: 'B'.repeat(64) }, { releaseNotes: reviewed.releaseNotes.slice(0, 4) }, { releaseNotes: [...reviewed.releaseNotes.slice(0, 5), 'wrong label'] }]) {
    assert.throws(() => validateBeta22Pin({ ...candidate, ...changes }), /BETA22_ARTIFACT_PIN_NOT_READY/)
  }
})
test('Beta22 requires the actual published code34 baseline and immutable candidate object key', () => {
  const baseline = { platform: 'android', versionName: RC14_BASELINE.versionName, versionCode: 34, minimumVersionCode: 19, forceUpdate: false, apkSha256: RC14_BASELINE.sha256, size: RC14_BASELINE.size, downloadUrl: 'https://ecfc.fans/api/app/download/android', releaseNotes: ['Beta.21 RC14 内测版本'], publishedAt: '2026-11-13T13:18:23Z' }
  assert.equal(validateCode34VersionApi(baseline), baseline)
  for (const changes of [{ versionCode: 33 }, { versionCode: 35 }, { forceUpdate: true }, { apkSha256: 'B'.repeat(64) }, { size: 1 }, { versionName: '1.0.0-beta.22' }]) assert.throws(() => validateCode34VersionApi({ ...baseline, ...changes }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE34/)
  const key = createVersionedObjectKey('beta22', { date: new Date('2026-11-14T01:00:00Z'), runId: 123, runAttempt: 1 })
  assert.equal(key, 'android/releases/ECFC-1.0.0-beta.22-release-beta22-20261114-010000-run123-attempt1.apk')
  assert.equal(validateVersionedObjectKey(key, 'beta22', { runId: 123, runAttempt: 1 }), key)
  assert.throws(() => validateVersionedObjectKey(key, 'rc14'), /COS_OBJECT_KEY_INVALID/)
})
