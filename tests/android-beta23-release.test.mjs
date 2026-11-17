import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BETA22_BASELINE, loadBeta23Pin, validateBeta23Pin, validateCode35VersionApi } from '../scripts/android-beta23-release.mjs'
import { createVersionedObjectKey, validateVersionedObjectKey } from '../scripts/android-rc11-cos-publish.mjs'

const reviewed = JSON.parse(readFileSync(new URL('../scripts/android-beta23-release.json', import.meta.url), 'utf8'))
const candidate = {
  ...reviewed,
  sha256: 'A'.repeat(64),
  size: 180000000,
  mobileCommit: 'b'.repeat(40),
}

test('Beta23 remains unavailable until hash, size, mobile commit, source, signer, and notes are pinned', () => {
  const pinReady = typeof reviewed.sha256 === 'string'
    && /^[A-F0-9]{64}$/.test(reviewed.sha256)
    && Number.isSafeInteger(reviewed.size)
    && typeof reviewed.mobileCommit === 'string'
    && /^[0-9a-f]{40}$/.test(reviewed.mobileCommit)
  if (pinReady) assert.doesNotThrow(() => loadBeta23Pin())
  else assert.throws(() => loadBeta23Pin(), /BETA23_ARTIFACT_PIN_NOT_READY/)
  assert.equal(validateBeta23Pin(candidate), candidate)
  for (const changes of [
    { sha256: null },
    { size: null },
    { mobileCommit: null },
    { mobileCommit: 'not-a-commit' },
    { versionCode: 35 },
    { versionName: '1.0.0-beta.22' },
    { sourcePath: 'C:\\other.apk' },
    { signerSha256: 'B'.repeat(64) },
    { releaseNotes: reviewed.releaseNotes.slice(0, 4) },
    { releaseNotes: [...reviewed.releaseNotes.slice(0, 5), 'wrong label'] },
  ]) {
    assert.throws(() => validateBeta23Pin({ ...candidate, ...changes }), /BETA23_ARTIFACT_PIN_NOT_READY/)
  }
})

test('Beta23 requires the exact published code35 baseline and a unique immutable candidate key', () => {
  const baseline = {
    platform: 'android',
    versionName: BETA22_BASELINE.versionName,
    versionCode: 35,
    minimumVersionCode: 19,
    forceUpdate: false,
    apkSha256: BETA22_BASELINE.sha256,
    size: BETA22_BASELINE.size,
    downloadUrl: 'https://ecfc.fans/api/app/download/android',
    releaseNotes: [...BETA22_BASELINE.releaseNotes],
    publishedAt: BETA22_BASELINE.publishedAt,
  }
  assert.equal(validateCode35VersionApi(baseline), baseline)
  for (const changes of [{ versionCode: 34 }, { versionCode: 36 }, { forceUpdate: true }, { apkSha256: 'B'.repeat(64) }, { size: 1 }, { versionName: '1.0.0-beta.23' }, { publishedAt: '2026-11-14T00:00:00Z' }]) {
    assert.throws(() => validateCode35VersionApi({ ...baseline, ...changes }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE35/)
  }
  const key = createVersionedObjectKey('beta23', { date: new Date('2026-11-14T01:00:00Z'), runId: 123, runAttempt: 1 })
  assert.equal(key, 'android/releases/ECFC-1.0.0-beta.23-release-beta23-20261114-010000-run123-attempt1.apk')
  assert.equal(validateVersionedObjectKey(key, 'beta23', { runId: 123, runAttempt: 1 }), key)
  assert.throws(() => validateVersionedObjectKey(key, 'beta22'), /COS_OBJECT_KEY_INVALID/)
})
