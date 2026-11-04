import { readFileSync } from 'node:fs'
import { resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CODE32_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-185753-run41698377689-attempt1.apk'
export const CODE32_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app', versionCode: 32, versionName: '1.0.0-beta.21',
  sha256: '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271', size: 180263015,
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
})

// The reviewed pin intentionally starts incomplete. An RC13 build must be
// verified and its exact path, digest, size and approved notes committed before
// either staging or a production metadata change can run.
export function validateRc13Pin(pin) {
  if (!pin || pin.applicationId !== 'fans.ecfc.app' || pin.versionCode !== 33
    || pin.versionName !== '1.0.0-beta.21' || pin.signerSha256 !== CODE32_BASELINE.signerSha256
    || typeof pin.sha256 !== 'string' || !/^[A-F0-9]{64}$/.test(pin.sha256)
    || !Number.isSafeInteger(pin.size) || pin.size < 10000000 || pin.size > 500000000
    || typeof pin.sourceFile !== 'string'
    || !/^ECFC-1\.0\.0-beta\.21-release-RC13-code33(?:-[A-Za-z0-9-]+)?\.apk$/.test(pin.sourceFile)
    || typeof pin.sourcePath !== 'string'
    || !/^E:\\Eason\\build-cache\\ECFC-Release-Artifacts\\Beta21-RC13\\[^\\/]+\.apk$/.test(pin.sourcePath)
    || win32.basename(pin.sourcePath) !== pin.sourceFile
    || !Array.isArray(pin.releaseNotes) || pin.releaseNotes.length !== 6
    || pin.releaseNotes.some((note) => typeof note !== 'string' || !note.trim() || note.length > 500)
    || pin.releaseNotes[5] !== 'Beta.21 RC13 内测版本') {
    throw new Error('RC13_ARTIFACT_PIN_NOT_READY')
  }
  return pin
}

export function loadRc13Pin() {
  let pin
  try { pin = JSON.parse(readFileSync(new URL('./android-rc13-release.json', import.meta.url), 'utf8')) }
  catch { throw new Error('RC13_ARTIFACT_PIN_NOT_READY') }
  return validateRc13Pin(pin)
}

export function validateCode32VersionApi(body) {
  if (!body || body.platform !== 'android' || body.versionName !== CODE32_BASELINE.versionName
    || body.versionCode !== 32 || body.minimumVersionCode !== 19 || body.forceUpdate !== false
    || String(body.apkSha256).toUpperCase() !== CODE32_BASELINE.sha256 || body.size !== CODE32_BASELINE.size
    || body.downloadUrl !== 'https://ecfc.fans/api/app/download/android'
    || !Array.isArray(body.releaseNotes) || body.releaseNotes.length !== 6
    || body.releaseNotes[5] !== 'Beta.21 RC12 内测版本'
    || typeof body.publishedAt !== 'string' || !Number.isFinite(Date.parse(body.publishedAt))) {
    throw new Error('PRODUCTION_VERSION_API_NOT_EXPECTED_CODE32')
  }
  return body
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const pin = loadRc13Pin()
    if (process.argv[2] === 'validate') {
      if (process.argv[3] && process.argv[3] !== pin.sha256) throw new Error('RC13_PIN_SHA_MISMATCH')
      if (process.argv[4] && process.argv[4] !== String(pin.size)) throw new Error('RC13_PIN_SIZE_MISMATCH')
      console.log('RC13_ARTIFACT_PIN=VERIFIED')
    } else throw new Error('RC13_PIN_COMMAND_INVALID')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'RC13_ARTIFACT_PIN_NOT_READY')
    process.exitCode = 1
  }
}
