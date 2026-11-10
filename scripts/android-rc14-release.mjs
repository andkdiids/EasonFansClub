import { readFileSync } from 'node:fs'
import { resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RC13_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app',
  versionName: '1.0.0-beta.21',
  versionCode: 33,
  sha256: '5D39F4CD071D2D4B78EA82DFEFEE7D2069A8E9D6425D223D0D3F11A1F50F7BF7',
  size: 183811739,
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
  objectKey: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc13-20261104-203019-run41906858324-attempt1.apk',
})

/** A proposed release remains unavailable until a verified artifact is pinned. */
const RC14_SOURCE_DIRECTORY = String.raw`E:\Eason\build-cache\ECFC-Release-Artifacts\Beta21-RC14`

export function validateRc14Pin(pin) {
  if (!pin || pin.applicationId !== RC13_BASELINE.applicationId
    || pin.versionName !== '1.0.0-beta.21' || pin.versionCode !== 34
    || pin.signerSha256 !== RC13_BASELINE.signerSha256
    || typeof pin.sha256 !== 'string' || !/^[A-F0-9]{64}$/.test(pin.sha256)
    || !Number.isSafeInteger(pin.size) || pin.size < 10000000 || pin.size > 500000000
    || typeof pin.sourceFile !== 'string'
    || !/^ECFC-1\.0\.0-beta\.21-release-RC14-code34(?:-[A-Za-z0-9-]+)?\.apk$/.test(pin.sourceFile)
    || typeof pin.sourcePath !== 'string'
    || !win32.isAbsolute(pin.sourcePath)
    || pin.sourcePath !== win32.join(RC14_SOURCE_DIRECTORY, pin.sourceFile)
    || win32.basename(pin.sourcePath) !== pin.sourceFile
    || !Array.isArray(pin.releaseNotes) || !pin.releaseNotes.length
    || pin.releaseNotes.some(note => typeof note !== 'string' || !note.trim() || note.length > 500)) {
    throw new Error('RC14_ARTIFACT_PIN_NOT_READY')
  }
  return pin
}

export function validateCode33VersionApi(body) {
  if (!body || body.platform !== 'android' || body.versionName !== RC13_BASELINE.versionName
    || body.versionCode !== RC13_BASELINE.versionCode || body.minimumVersionCode !== 19
    || body.forceUpdate !== false || String(body.apkSha256).toUpperCase() !== RC13_BASELINE.sha256
    || body.size !== RC13_BASELINE.size
    || body.downloadUrl !== 'https://ecfc.fans/api/app/download/android'
    || !Array.isArray(body.releaseNotes) || body.releaseNotes.at(-1) !== 'Beta.21 RC13 内测版本'
    || typeof body.publishedAt !== 'string' || !Number.isFinite(Date.parse(body.publishedAt))) {
    throw new Error('PRODUCTION_VERSION_API_NOT_EXPECTED_CODE33')
  }
  return body
}

/** Load the reviewed pin; an absent or incomplete pin is never publishable. */
export function loadRc14Pin() {
  let pin
  try { pin = JSON.parse(readFileSync(new URL('./android-rc14-release.json', import.meta.url), 'utf8')) }
  catch { throw new Error('RC14_ARTIFACT_PIN_NOT_READY') }
  return validateRc14Pin(pin)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv[2] !== 'validate') throw new Error('RC14_PIN_COMMAND_INVALID')
    const pin = loadRc14Pin()
    if (process.argv[3] && process.argv[3] !== pin.sha256) throw new Error('RC14_PIN_SHA_MISMATCH')
    if (process.argv[4] && process.argv[4] !== String(pin.size)) throw new Error('RC14_PIN_SIZE_MISMATCH')
    console.log('RC14_ARTIFACT_PIN=VERIFIED')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'RC14_ARTIFACT_PIN_NOT_READY')
    process.exitCode = 1
  }
}
