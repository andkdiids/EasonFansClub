import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CODE32_BASELINE, validateCode32VersionApi, validateRc13Pin } from '../scripts/android-rc13-release.mjs'

const pin = {
  applicationId: 'fans.ecfc.app', versionCode: 33, versionName: '1.0.0-beta.21',
  signerSha256: CODE32_BASELINE.signerSha256, sha256: 'A'.repeat(64), size: 180000000,
  sourceFile: 'ECFC-1.0.0-beta.21-release-RC13-code33-test.apk',
  sourcePath: 'E:\\Eason\\build-cache\\ECFC-Release-Artifacts\\Beta21-RC13\\ECFC-1.0.0-beta.21-release-RC13-code33-test.apk',
  releaseNotes: ['a', 'b', 'c', 'd', 'e', 'Beta.21 RC13 内测版本'],
}

test('unfilled RC13 pin fails closed; a complete fixture is accepted', () => {
  const unfilled = { ...pin, sha256: null, size: null, sourceFile: null, sourcePath: null, releaseNotes: null }
  assert.throws(() => validateRc13Pin(unfilled), /RC13_ARTIFACT_PIN_NOT_READY/)
  assert.equal(validateRc13Pin(pin), pin)
  for (const changes of [
    { sha256: null }, { sha256: 'A'.repeat(63) }, { size: 0 }, { versionCode: 32 },
    { applicationId: 'other.app' }, { signerSha256: 'B'.repeat(64) },
    { sourcePath: 'C:\\temp\\candidate.apk' }, { releaseNotes: [] },
  ]) assert.throws(() => validateRc13Pin({ ...pin, ...changes }), /RC13_ARTIFACT_PIN_NOT_READY/)
})

test('RC13 CAS accepts only the expected code32 public baseline', () => {
  const baseline = { platform: 'android', versionName: CODE32_BASELINE.versionName, versionCode: 32,
    minimumVersionCode: 19, forceUpdate: false, apkSha256: CODE32_BASELINE.sha256,
    size: CODE32_BASELINE.size, downloadUrl: 'https://ecfc.fans/api/app/download/android',
    releaseNotes: ['a', 'b', 'c', 'd', 'e', 'Beta.21 RC12 内测版本'], publishedAt: '2026-11-03T19:04:22Z' }
  assert.equal(validateCode32VersionApi(baseline), baseline)
  for (const changes of [{ versionCode: 31 }, { apkSha256: 'B'.repeat(64) }, { forceUpdate: true },
    { minimumVersionCode: 20 }, { size: 1 }, { downloadUrl: 'https://example.com/other.apk' }]) {
    assert.throws(() => validateCode32VersionApi({ ...baseline, ...changes }), /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE32/)
  }
})

test('RC13 release-control changes do not trigger the default production deployment', () => {
  const deploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const ignored = deploy.match(/paths-ignore:\s*([\s\S]*?)\n\s+workflow_dispatch:/)?.[1]
  assert.ok(ignored)
  for (const file of ['scripts/android-rc13-release.mjs', 'scripts/android-rc13-release.json', 'tests/android-rc13-release.test.mjs']) {
    assert.ok(ignored.includes(`'${file}'`), `missing deployment exclusion: ${file}`)
  }
})

test('code32 rollback requires protected main, exact code33 CAS, verified source and health', () => {
  const text = readFileSync(new URL('../.github/workflows/rollback-android-version-to-code32.yml', import.meta.url), 'utf8')
  for (const required of [/workflow_dispatch:/, /group:\s*production-deploy/, /cancel-in-progress:\s*false/,
    /environment:\s*Production/, /assert-release-main\.mjs/, /node scripts\/android-rc13-release\.mjs validate/,
    /\.versionCode == 33/, /VERSION_API_CHANGED_BEFORE_ROLLBACK/, /expectedCurrentMetadata:/,
    /ANDROID_RELEASE_OPERATION=rollback-code32/, /verify-android-apk-signature\.mjs/,
    /CODE32_ROLLBACK_SOURCE_SHA256_MISMATCH/, /PRODUCTION_HEALTH_MISMATCH/,
    /PUBLIC_CODE32_APK_SHA256_MISMATCH/, /actions\/upload-artifact@/]) assert.match(text, required)
  assert.doesNotMatch(text, /prisma migrate|DATABASE_URL|cos:DeleteObject|continue-on-error:\s*true/i)
})
