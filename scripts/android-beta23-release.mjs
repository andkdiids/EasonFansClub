import { readFileSync } from 'node:fs'
import { resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BETA22_BASELINE = Object.freeze({
  applicationId: 'fans.ecfc.app',
  versionName: '1.0.0-beta.22',
  versionCode: 35,
  sha256: '86028B1E16F21C0B94F44B2AC20A9D8FBAD428B905113A3CBC3EB81971625133',
  size: 183859547,
  signerSha256: '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B',
  objectKey: 'android/releases/ECFC-1.0.0-beta.22-release-beta22-20261113-231557-run43525510050-attempt1.apk',
  releaseNotes: Object.freeze([
    '统一个人主页和活动中心扫码核销入口',
    '展示当前活动真实物料与领取状态',
    '展示全部中奖奖品及领取状态',
    '核销前使用应用内明细确认弹窗',
    '完善核销权限、幂等与并发保护',
    'Beta.22 正式版本',
  ]),
  publishedAt: '2026-11-13T23:18:16Z',
})

const BETA23_SOURCE_DIRECTORY = String.raw`E:\Eason\build-cache\ECFC-Release-Artifacts\Beta23`

function validBuildCommit(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
}

/** A proposed release remains unavailable until every build field is verified. */
export function validateBeta23Pin(pin) {
  if (!pin || pin.applicationId !== BETA22_BASELINE.applicationId
    || pin.versionName !== '1.0.0-beta.23' || pin.versionCode !== 36
    || pin.signerSha256 !== BETA22_BASELINE.signerSha256
    || typeof pin.sha256 !== 'string' || !/^[A-F0-9]{64}$/.test(pin.sha256)
    || !Number.isSafeInteger(pin.size) || pin.size < 10000000 || pin.size > 500000000
    || typeof pin.mobileCommit !== 'string' || !validBuildCommit(pin.mobileCommit)
    || typeof pin.sourceFile !== 'string'
    || !/^ECFC-1\.0\.0-beta\.23-release-code36\.apk$/.test(pin.sourceFile)
    || typeof pin.sourcePath !== 'string'
    || !win32.isAbsolute(pin.sourcePath)
    || pin.sourcePath !== win32.join(BETA23_SOURCE_DIRECTORY, pin.sourceFile)
    || win32.basename(pin.sourcePath) !== pin.sourceFile
    || !Array.isArray(pin.releaseNotes) || pin.releaseNotes.length !== 6 || pin.releaseNotes[5] !== 'Beta.23 正式版本'
    || pin.releaseNotes.some(note => typeof note !== 'string' || !note.trim() || note.length > 500)) {
    throw new Error('BETA23_ARTIFACT_PIN_NOT_READY')
  }
  if (pin.buildCompletedAt !== undefined && pin.buildCompletedAt !== null
    && (typeof pin.buildCompletedAt !== 'string' || !Number.isFinite(Date.parse(pin.buildCompletedAt)))) {
    throw new Error('BETA23_ARTIFACT_PIN_NOT_READY')
  }
  if (pin.provenance !== undefined && pin.provenance !== null
    && (typeof pin.provenance !== 'string' || !pin.provenance.trim())) {
    throw new Error('BETA23_ARTIFACT_PIN_NOT_READY')
  }
  return pin
}

export function validateCode35VersionApi(body) {
  if (!body || body.platform !== 'android' || body.versionName !== BETA22_BASELINE.versionName
    || Number(body.versionCode) !== BETA22_BASELINE.versionCode
    || Number(body.minimumVersionCode) !== 19 || body.forceUpdate !== false
    || String(body.apkSha256).toUpperCase() !== BETA22_BASELINE.sha256
    || Number(body.size) !== BETA22_BASELINE.size
    || body.downloadUrl !== 'https://ecfc.fans/api/app/download/android'
    || !Array.isArray(body.releaseNotes)
    || JSON.stringify(body.releaseNotes) !== JSON.stringify(BETA22_BASELINE.releaseNotes)
    || typeof body.publishedAt !== 'string'
    || Date.parse(body.publishedAt) !== Date.parse(BETA22_BASELINE.publishedAt)) {
    throw new Error('PRODUCTION_VERSION_API_NOT_EXPECTED_CODE35')
  }
  return body
}

/** Load the reviewed pin; an absent or incomplete pin is never publishable. */
export function loadBeta23Pin() {
  let pin
  try { pin = JSON.parse(readFileSync(new URL('./android-beta23-release.json', import.meta.url), 'utf8')) }
  catch { throw new Error('BETA23_ARTIFACT_PIN_NOT_READY') }
  return validateBeta23Pin(pin)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv[2] !== 'validate') throw new Error('BETA23_PIN_COMMAND_INVALID')
    const pin = loadBeta23Pin()
    if (process.argv[3] && process.argv[3] !== pin.sha256) throw new Error('BETA23_PIN_SHA_MISMATCH')
    if (process.argv[4] && process.argv[4] !== String(pin.size)) throw new Error('BETA23_PIN_SIZE_MISMATCH')
    console.log('BETA23_ARTIFACT_PIN=VERIFIED')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'BETA23_ARTIFACT_PIN_NOT_READY')
    process.exitCode = 1
  }
}
