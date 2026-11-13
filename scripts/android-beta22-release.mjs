import { readFileSync } from 'node:fs'
import { resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RC14_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app',
  versionName: '1.0.0-beta.21',
  versionCode: 34,
  sha256: '450AA28BD98D614C61B18A3BF981F36EEE4C168459EAEF74D1665A54221692AB',
  size: 183849255,
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
  objectKey: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc14-20261111-024245-run42947606564-attempt1.apk',
})

/** A proposed release remains unavailable until a verified artifact is pinned. */
const BETA22_SOURCE_DIRECTORY = String.raw`E:\Eason\build-cache\ECFC-Release-Artifacts\Beta22`

export function validateBeta22Pin(pin) {
  if (!pin || pin.applicationId !== RC14_BASELINE.applicationId
    || pin.versionName !== '1.0.0-beta.22' || pin.versionCode !== 35
    || pin.signerSha256 !== RC14_BASELINE.signerSha256
    || typeof pin.sha256 !== 'string' || !/^[A-F0-9]{64}$/.test(pin.sha256)
    || !Number.isSafeInteger(pin.size) || pin.size < 10000000 || pin.size > 500000000
    || typeof pin.sourceFile !== 'string'
    || !/^ECFC-1\.0\.0-beta\.22-release-code35\.apk$/.test(pin.sourceFile)
    || typeof pin.sourcePath !== 'string'
    || !win32.isAbsolute(pin.sourcePath)
    || pin.sourcePath !== win32.join(BETA22_SOURCE_DIRECTORY, pin.sourceFile)
    || win32.basename(pin.sourcePath) !== pin.sourceFile
    || !Array.isArray(pin.releaseNotes) || pin.releaseNotes.length !== 6 || pin.releaseNotes[5] !== 'Beta.22 正式版本'
    || pin.releaseNotes.some(note => typeof note !== 'string' || !note.trim() || note.length > 500)) {
    throw new Error('BETA22_ARTIFACT_PIN_NOT_READY')
  }
  return pin
}

export function validateCode34VersionApi(body) {
  if (!body || body.platform !== 'android' || body.versionName !== RC14_BASELINE.versionName
    || body.versionCode !== RC14_BASELINE.versionCode || body.minimumVersionCode !== 19
    || body.forceUpdate !== false || String(body.apkSha256).toUpperCase() !== RC14_BASELINE.sha256
    || body.size !== RC14_BASELINE.size
    || body.downloadUrl !== 'https://ecfc.fans/api/app/download/android'
    || !Array.isArray(body.releaseNotes) || body.releaseNotes.at(-1) !== 'Beta.21 RC14 内测版本'
    || typeof body.publishedAt !== 'string' || !Number.isFinite(Date.parse(body.publishedAt))) {
    throw new Error('PRODUCTION_VERSION_API_NOT_EXPECTED_CODE34')
  }
  return body
}

/** Load the reviewed pin; an absent or incomplete pin is never publishable. */
export function loadBeta22Pin() {
  let pin
  try { pin = JSON.parse(readFileSync(new URL('./android-beta22-release.json', import.meta.url), 'utf8')) }
  catch { throw new Error('BETA22_ARTIFACT_PIN_NOT_READY') }
  return validateBeta22Pin(pin)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv[2] !== 'validate') throw new Error('BETA22_PIN_COMMAND_INVALID')
    const pin = loadBeta22Pin()
    if (process.argv[3] && process.argv[3] !== pin.sha256) throw new Error('BETA22_PIN_SHA_MISMATCH')
    if (process.argv[4] && process.argv[4] !== String(pin.size)) throw new Error('BETA22_PIN_SIZE_MISMATCH')
    console.log('BETA22_ARTIFACT_PIN=VERIFIED')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'BETA22_ARTIFACT_PIN_NOT_READY')
    process.exitCode = 1
  }
}
