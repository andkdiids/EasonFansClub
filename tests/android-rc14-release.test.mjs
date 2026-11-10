import assert from 'node:assert/strict'
import test from 'node:test'
import { RC13_BASELINE, validateRc14Pin, validateCode33VersionApi } from '../scripts/android-rc14-release.mjs'

const candidate = {
  applicationId: 'fans.ecfc.app', versionName: '1.0.0-beta.22', versionCode: 34,
  signerSha256: RC13_BASELINE.signerSha256, sha256: 'A'.repeat(64), size: 180000000,
  sourceFile: 'ECFC-1.0.0-beta.22-release-RC14-code34-test.apk',
  sourcePath: String.raw`E:\Eason\build-cache\ECFC-Release-Artifacts\Beta22-RC14\ECFC-1.0.0-beta.22-release-RC14-code34-test.apk`,
  releaseNotes: ['fixture'],
}

test('RC14 artifact pin fails closed on missing or mismatched evidence', () => {
  assert.equal(validateRc14Pin(candidate), candidate)
  for (const changes of [
    { sha256: null }, { size: null }, { signerSha256: 'B'.repeat(64) },
    { versionCode: 33 }, { versionName: '1.0.0-beta.21' }, { applicationId: 'other' },
    { sourcePath: String.raw`C:\candidate.apk` }, { releaseNotes: [] },
  ]) assert.throws(() => validateRc14Pin({ ...candidate, ...changes }), /RC14_ARTIFACT_PIN_NOT_READY/)
})

test('RC14 production baseline rejects unexpected code33 metadata', () => {
  const baseline = {
    platform: 'android', versionName: RC13_BASELINE.versionName, versionCode: 33,
    minimumVersionCode: 19, forceUpdate: false, apkSha256: RC13_BASELINE.sha256,
    size: RC13_BASELINE.size, downloadUrl: 'https://ecfc.fans/api/app/download/android',
    releaseNotes: ['Beta.21 RC13 内测版本'], publishedAt: '2026-11-04T20:42:23.000Z',
  }
  assert.equal(validateCode33VersionApi(baseline), baseline)
  for (const changes of [
    { versionCode: 34 }, { apkSha256: 'B'.repeat(64) }, { forceUpdate: true },
    { minimumVersionCode: 20 }, { size: 1 }, { downloadUrl: 'https://example.invalid/app.apk' },
  ]) assert.throws(() => validateCode33VersionApi({ ...baseline, ...changes }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE33/)
})
