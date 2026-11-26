import { randomUUID, createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, chownSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'

const PRODUCTION_APP_DIR = '/home/apps/easonfansclub'
const moduleRequire = process.argv[1] === '-' && process.env.APP_DIR === PRODUCTION_APP_DIR
  ? createRequire(path.join(PRODUCTION_APP_DIR, 'current', 'package.json'))
  : createRequire(import.meta.url)
const dotenv = moduleRequire('dotenv')
const METADATA_KEYS = Object.freeze([
  'ANDROID_VERSION_NAME',
  'ANDROID_VERSION_CODE',
  'ANDROID_MINIMUM_VERSION_CODE',
  'ANDROID_FORCE_UPDATE',
  'ANDROID_APK_COS_KEY',
  'ANDROID_APK_SHA256',
  'ANDROID_APK_SIZE',
  'ANDROID_RELEASE_NOTES',
  'ANDROID_PUBLISHED_AT',
])
const RC11_APK_SHA256 = '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C'
const RC11_APK_SIZE = 183802143
const CODE30_APK_SHA256 = 'D2CA0817E23431EFAB87E992BA544C4B213981E3E8651D67AF49324B440FC967'
const CODE30_APK_SIZE = 184246197
const RC12_APK_SHA256 = '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271'
const RC12_APK_SIZE = 180263015
const RC13_APK_SHA256 = '5D39F4CD071D2D4B78EA82DFEFEE7D2069A8E9D6425D223D0D3F11A1F50F7BF7'
const RC13_APK_SIZE = 183811739
const RC14_APK_SHA256 = '450AA28BD98D614C61B18A3BF981F36EEE4C168459EAEF74D1665A54221692AB'
const RC14_APK_SIZE = 183849255
const CODE34_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc14-20261111-024245-run42947606564-attempt1.apk'
const BETA22_APK_SHA256 = '86028B1E16F21C0B94F44B2AC20A9D8FBAD428B905113A3CBC3EB81971625133'
const BETA22_APK_SIZE = 183859547
const CODE35_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.22-release-beta22-20261113-231557-run43525510050-attempt1.apk'
const BETA23_APK_SHA256 = '5FDFF851DD3A0A5C79E70EF02BF18928F59E486765175C5C7039995216260900'
const BETA23_APK_SIZE = 183952296
const CODE36_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.23-release-beta23-20261117-165256-run44129016214-attempt1.apk'
const CODE33_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc13-20261104-203019-run41906858324-attempt1.apk'
const CODE31_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk'
const CODE32_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-185753-run41698377689-attempt1.apk'

function requireThat(condition, code) {
  if (!condition) throw new Error(code)
}

function validateMetadata(metadata, rc13Pin, rc14Pin, beta22Pin, beta23Pin, beta24Pin, beta26Pin, beta27Pin, beta28Pin, beta29Pin) {
  requireThat(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'INVALID_METADATA')
  const actualKeys = Object.keys(metadata).sort()
  requireThat(JSON.stringify(actualKeys) === JSON.stringify([...METADATA_KEYS].sort()), 'INVALID_METADATA_KEYS')
  requireThat(metadata.ANDROID_VERSION_NAME === (metadata.ANDROID_VERSION_CODE === 42 ? '1.0.0-beta.29' : metadata.ANDROID_VERSION_CODE === 41 ? '1.0.0-beta.28' : metadata.ANDROID_VERSION_CODE === 40 ? '1.0.0-beta.27' : metadata.ANDROID_VERSION_CODE === 39 ? '1.0.0-beta.26' : metadata.ANDROID_VERSION_CODE === 37 ? '1.0.0-beta.24' : metadata.ANDROID_VERSION_CODE === 36 ? '1.0.0-beta.23' : metadata.ANDROID_VERSION_CODE === 35 ? '1.0.0-beta.22' : '1.0.0-beta.21'), 'INVALID_VERSION_NAME')
  const releaseCandidate = metadata.ANDROID_VERSION_CODE === 23 ? 'rc3'
    : metadata.ANDROID_VERSION_CODE === 24 ? 'rc4'
      : metadata.ANDROID_VERSION_CODE === 25 ? 'rc5'
      : metadata.ANDROID_VERSION_CODE === 26 ? 'rc6'
        : metadata.ANDROID_VERSION_CODE === 27 ? 'rc7'
          : metadata.ANDROID_VERSION_CODE === 28 ? 'rc8'
            : metadata.ANDROID_VERSION_CODE === 29 ? 'rc9'
              : metadata.ANDROID_VERSION_CODE === 30 ? 'rc10'
                : metadata.ANDROID_VERSION_CODE === 31 ? 'rc11'
                  : metadata.ANDROID_VERSION_CODE === 32 ? 'rc12'
                    : metadata.ANDROID_VERSION_CODE === 33 ? 'rc13'
                    : metadata.ANDROID_VERSION_CODE === 34 ? 'rc14' : metadata.ANDROID_VERSION_CODE === 35 ? 'beta22' : metadata.ANDROID_VERSION_CODE === 36 ? 'beta23' : metadata.ANDROID_VERSION_CODE === 37 ? 'beta24' : metadata.ANDROID_VERSION_CODE === 39 ? 'beta26' : metadata.ANDROID_VERSION_CODE === 40 ? 'beta27' : metadata.ANDROID_VERSION_CODE === 41 ? 'beta28' : metadata.ANDROID_VERSION_CODE === 42 ? 'beta29' : null
  requireThat(releaseCandidate !== null, 'INVALID_VERSION_CODE')
  if (releaseCandidate === 'beta24') requireThat(beta24Pin && typeof beta24Pin === 'object' && !Array.isArray(beta24Pin), 'BETA24_ARTIFACT_PIN_NOT_READY')
  if (releaseCandidate === 'beta26') requireThat(beta26Pin && typeof beta26Pin === 'object' && !Array.isArray(beta26Pin), 'BETA26_ARTIFACT_PIN_NOT_READY')
  if (releaseCandidate === 'beta27') requireThat(beta27Pin && typeof beta27Pin === 'object' && !Array.isArray(beta27Pin), 'BETA27_ARTIFACT_PIN_NOT_READY')
  if (releaseCandidate === 'beta28') requireThat(beta28Pin && typeof beta28Pin === 'object' && !Array.isArray(beta28Pin), 'BETA28_ARTIFACT_PIN_NOT_READY')
  if (releaseCandidate === 'beta29') requireThat(beta29Pin && typeof beta29Pin === 'object' && !Array.isArray(beta29Pin), 'BETA29_ARTIFACT_PIN_NOT_READY')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === 19, 'INVALID_MINIMUM_VERSION_CODE')
  requireThat(metadata.ANDROID_FORCE_UPDATE === false, 'INVALID_FORCE_UPDATE')
  const objectKeyPattern = releaseCandidate === 'beta29'
    ? new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.29-internal-code42-${beta29Pin.mobileCommit}-run\\d+-attempt[1-9]\\d*\\.apk$`)
    : releaseCandidate === 'beta28'
    ? new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.28-internal-code41-${beta28Pin.mobileCommit}-run\\d+-attempt[1-9]\\d*\\.apk$`)
    : releaseCandidate === 'beta27'
    ? new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.27-internal-code40-${beta27Pin.mobileCommit}-run\\d+-attempt[1-9]\\d*\\.apk$`)
    : releaseCandidate === 'beta26'
    ? new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.26-internal-code39-${beta26Pin.mobileCommit}-run\\d+-attempt[1-9]\\d*\\.apk$`)
    : releaseCandidate === 'beta24'
    ? new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.24-internal-code37-${beta24Pin.mobileCommit}-run\\d+-attempt[1-9]\\d*\\.apk$`)
    : releaseCandidate === 'beta23'
    ? /^android\/releases\/ECFC-1\.0\.0-beta\.23-release-beta23-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/
    : releaseCandidate === 'beta22'
    ? /^android\/releases\/ECFC-1\.0\.0-beta\.22-release-beta22-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/
    : releaseCandidate === 'rc14'
    ? /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc14-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/
    : releaseCandidate === 'rc11' || releaseCandidate === 'rc12' || releaseCandidate === 'rc13'
    ? new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.21-release-beta21-${releaseCandidate}-\\d{8}-\\d{6}-run\\d+-attempt[1-9]\\d*\\.apk$`)
    : new RegExp(`^android/releases/ECFC-1\\.0\\.0-beta\\.21-release-beta21-${releaseCandidate}-\\d{8}-\\d{6}\\.apk$`)

  requireThat(typeof metadata.ANDROID_APK_COS_KEY === 'string'
    && objectKeyPattern.test(metadata.ANDROID_APK_COS_KEY), 'INVALID_APK_OBJECT_KEY')
  requireThat(typeof metadata.ANDROID_APK_SHA256 === 'string'
    && /^[A-F0-9]{64}$/.test(metadata.ANDROID_APK_SHA256), 'INVALID_APK_SHA256')
  requireThat(Number.isSafeInteger(metadata.ANDROID_APK_SIZE)
    && metadata.ANDROID_APK_SIZE >= 10_000_000
    && metadata.ANDROID_APK_SIZE <= 500_000_000, 'INVALID_APK_SIZE')
  requireThat(typeof metadata.ANDROID_RELEASE_NOTES === 'string', 'INVALID_RELEASE_NOTES')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('INVALID_RELEASE_NOTES') }
  requireThat(Array.isArray(notes) && notes.length === 6
    && notes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500), 'INVALID_RELEASE_NOTES')
  requireThat(notes[5] === (releaseCandidate === 'beta29' ? 'Beta.29 内测版本' : releaseCandidate === 'beta28' ? 'Beta.28 内测版本' : releaseCandidate === 'beta27' ? 'Beta.27 内测版本' : releaseCandidate === 'beta26' ? 'Beta.26 内测版本' : releaseCandidate === 'beta24' ? 'Beta.24 内测版本' : releaseCandidate === 'beta23' ? 'Beta.23 正式版本' : releaseCandidate === 'beta22' ? 'Beta.22 正式版本' : `Beta.21 ${releaseCandidate.toUpperCase()} 内测版本`), 'INVALID_RELEASE_NOTES')
  requireThat(typeof metadata.ANDROID_PUBLISHED_AT === 'string'
    && Number.isFinite(Date.parse(metadata.ANDROID_PUBLISHED_AT)), 'INVALID_PUBLISHED_AT')
  if (releaseCandidate === 'rc11') {
    requireThat(metadata.ANDROID_APK_SHA256 === RC11_APK_SHA256, 'INVALID_RC11_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === RC11_APK_SIZE, 'INVALID_RC11_APK_SIZE')
  }
  if (releaseCandidate === 'rc12') {
    requireThat(metadata.ANDROID_APK_SHA256 === RC12_APK_SHA256, 'INVALID_RC12_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === RC12_APK_SIZE, 'INVALID_RC12_APK_SIZE')
  }
  if (releaseCandidate === 'rc13') {
    requireThat(rc13Pin && typeof rc13Pin === 'object' && !Array.isArray(rc13Pin)
      && JSON.stringify(Object.keys(rc13Pin).sort()) === JSON.stringify(['sha256', 'size']), 'RC13_ARTIFACT_PIN_NOT_READY')
    requireThat(typeof rc13Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(rc13Pin.sha256)
      && Number.isSafeInteger(rc13Pin.size) && rc13Pin.size >= 10000000 && rc13Pin.size <= 500000000,
    'RC13_ARTIFACT_PIN_NOT_READY')
    requireThat(metadata.ANDROID_APK_SHA256 === rc13Pin.sha256, 'INVALID_RC13_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === rc13Pin.size, 'INVALID_RC13_APK_SIZE')
  }
  if (releaseCandidate === 'rc14') {
    requireThat(rc14Pin && typeof rc14Pin === 'object' && !Array.isArray(rc14Pin)
      && JSON.stringify(Object.keys(rc14Pin).sort()) === JSON.stringify(['sha256', 'size']), 'RC14_ARTIFACT_PIN_NOT_READY')
    requireThat(typeof rc14Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(rc14Pin.sha256)
      && Number.isSafeInteger(rc14Pin.size) && rc14Pin.size >= 10000000 && rc14Pin.size <= 500000000,
    'RC14_ARTIFACT_PIN_NOT_READY')
    requireThat(metadata.ANDROID_APK_SHA256 === rc14Pin.sha256, 'INVALID_RC14_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === rc14Pin.size, 'INVALID_RC14_APK_SIZE')
  }
  if (releaseCandidate === 'beta22') {
    requireThat(beta22Pin && typeof beta22Pin === 'object' && !Array.isArray(beta22Pin)
      && JSON.stringify(Object.keys(beta22Pin).sort()) === JSON.stringify(['sha256', 'size']), 'BETA22_ARTIFACT_PIN_NOT_READY')
    requireThat(typeof beta22Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta22Pin.sha256)
      && Number.isSafeInteger(beta22Pin.size) && beta22Pin.size >= 10000000 && beta22Pin.size <= 500000000,
    'BETA22_ARTIFACT_PIN_NOT_READY')
    requireThat(metadata.ANDROID_APK_SHA256 === beta22Pin.sha256, 'INVALID_BETA22_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta22Pin.size, 'INVALID_BETA22_APK_SIZE')
  }
  if (releaseCandidate === 'beta23') {
    requireThat(beta23Pin && typeof beta23Pin === 'object' && !Array.isArray(beta23Pin)
      && JSON.stringify(Object.keys(beta23Pin).sort()) === JSON.stringify(['sha256', 'size']), 'BETA23_ARTIFACT_PIN_NOT_READY')
    requireThat(typeof beta23Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta23Pin.sha256)
      && Number.isSafeInteger(beta23Pin.size) && beta23Pin.size >= 10000000 && beta23Pin.size <= 500000000,
    'BETA23_ARTIFACT_PIN_NOT_READY')
    requireThat(metadata.ANDROID_APK_SHA256 === beta23Pin.sha256, 'INVALID_BETA23_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta23Pin.size, 'INVALID_BETA23_APK_SIZE')
  }
  if (releaseCandidate === 'beta24') {
    requireThat(JSON.stringify(Object.keys(beta24Pin).sort()) === JSON.stringify([
      'mobileCommit', 'releaseNotes', 'sha256', 'size', 'sourceFile', 'versionCode', 'versionName',
    ]), 'BETA24_ARTIFACT_PIN_NOT_READY')
    requireThat(beta24Pin.versionName === '1.0.0-beta.24' && beta24Pin.versionCode === 37
      && typeof beta24Pin.mobileCommit === 'string' && /^[a-f0-9]{40}$/i.test(beta24Pin.mobileCommit)
      && typeof beta24Pin.sourceFile === 'string' && /^ECFC-[A-Za-z0-9.-]+\.apk$/.test(beta24Pin.sourceFile)
      && typeof beta24Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta24Pin.sha256)
      && Number.isSafeInteger(beta24Pin.size) && beta24Pin.size >= 10000000 && beta24Pin.size <= 500000000
      && Array.isArray(beta24Pin.releaseNotes) && beta24Pin.releaseNotes.length === 6
      && beta24Pin.releaseNotes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500),
    'BETA24_ARTIFACT_PIN_NOT_READY')
    requireThat(metadata.ANDROID_APK_SHA256 === beta24Pin.sha256, 'INVALID_BETA24_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta24Pin.size, 'INVALID_BETA24_APK_SIZE')
    requireThat(JSON.stringify(notes) === JSON.stringify(beta24Pin.releaseNotes), 'INVALID_BETA24_RELEASE_NOTES')
  }
  if (releaseCandidate === 'beta26') {
    requireThat(JSON.stringify(Object.keys(beta26Pin).sort()) === JSON.stringify([
      'mobileCommit', 'releaseNotes', 'rollback', 'sha256', 'size', 'sourceFile', 'versionCode', 'versionName',
    ]), 'BETA26_ARTIFACT_PIN_NOT_READY')
    requireThat(beta26Pin.versionName === '1.0.0-beta.26' && beta26Pin.versionCode === 39
      && typeof beta26Pin.mobileCommit === 'string' && /^[a-f0-9]{40}$/i.test(beta26Pin.mobileCommit)
      && typeof beta26Pin.sourceFile === 'string' && /^ECFC-[A-Za-z0-9.-]+\.apk$/.test(beta26Pin.sourceFile)
      && typeof beta26Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta26Pin.sha256)
      && Number.isSafeInteger(beta26Pin.size) && beta26Pin.size >= 10000000 && beta26Pin.size <= 500000000
      && Array.isArray(beta26Pin.releaseNotes) && beta26Pin.releaseNotes.length === 6
      && beta26Pin.releaseNotes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500),
    'BETA26_ARTIFACT_PIN_NOT_READY')
    // The rollback target is the release that is live right now (code 37),
    // recorded immutably so a later rollback never has to guess the object key.
    const rollback = beta26Pin.rollback
    requireThat(rollback && typeof rollback === 'object' && !Array.isArray(rollback)
      && JSON.stringify(Object.keys(rollback).sort()) === JSON.stringify(['objectKey', 'sha256', 'size', 'versionCode'])
      && rollback.versionCode === 37
      && typeof rollback.objectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.24-internal-code37-[a-f0-9]{40}-run\d+-attempt[1-9]\d*\.apk$/.test(rollback.objectKey)
      && typeof rollback.sha256 === 'string' && /^[A-F0-9]{64}$/.test(rollback.sha256)
      && Number.isSafeInteger(rollback.size) && rollback.size >= 10000000 && rollback.size <= 500000000,
    'BETA26_ROLLBACK_PIN_INVALID')
    requireThat(metadata.ANDROID_APK_SHA256 === beta26Pin.sha256, 'INVALID_BETA26_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta26Pin.size, 'INVALID_BETA26_APK_SIZE')
    requireThat(JSON.stringify(notes) === JSON.stringify(beta26Pin.releaseNotes), 'INVALID_BETA26_RELEASE_NOTES')
  }
  if (releaseCandidate === 'beta27') {
    requireThat(JSON.stringify(Object.keys(beta27Pin).sort()) === JSON.stringify([
      'mobileCommit', 'releaseNotes', 'rollback', 'sha256', 'size', 'sourceFile', 'versionCode', 'versionName',
    ]), 'BETA27_ARTIFACT_PIN_NOT_READY')
    requireThat(beta27Pin.versionName === '1.0.0-beta.27' && beta27Pin.versionCode === 40
      && typeof beta27Pin.mobileCommit === 'string' && /^[a-f0-9]{40}$/i.test(beta27Pin.mobileCommit)
      && typeof beta27Pin.sourceFile === 'string' && /^ECFC-[A-Za-z0-9.-]+\.apk$/.test(beta27Pin.sourceFile)
      && typeof beta27Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta27Pin.sha256)
      && Number.isSafeInteger(beta27Pin.size) && beta27Pin.size >= 10000000 && beta27Pin.size <= 500000000
      && Array.isArray(beta27Pin.releaseNotes) && beta27Pin.releaseNotes.length === 6
      && beta27Pin.releaseNotes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500),
    'BETA27_ARTIFACT_PIN_NOT_READY')
    const rollback = beta27Pin.rollback
    requireThat(rollback && typeof rollback === 'object' && !Array.isArray(rollback)
      && JSON.stringify(Object.keys(rollback).sort()) === JSON.stringify(['objectKey', 'sha256', 'size', 'versionCode'])
      && rollback.versionCode === 39
      && typeof rollback.objectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.26-internal-code39-[a-f0-9]{40}-run\d+-attempt[1-9]\d*\.apk$/.test(rollback.objectKey)
      && typeof rollback.sha256 === 'string' && /^[A-F0-9]{64}$/.test(rollback.sha256)
      && Number.isSafeInteger(rollback.size) && rollback.size >= 10000000 && rollback.size <= 500000000,
    'BETA27_ROLLBACK_PIN_INVALID')
    requireThat(metadata.ANDROID_APK_SHA256 === beta27Pin.sha256, 'INVALID_BETA27_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta27Pin.size, 'INVALID_BETA27_APK_SIZE')
    requireThat(JSON.stringify(notes) === JSON.stringify(beta27Pin.releaseNotes), 'INVALID_BETA27_RELEASE_NOTES')
  }
  if (releaseCandidate === 'beta28') {
    requireThat(JSON.stringify(Object.keys(beta28Pin).sort()) === JSON.stringify([
      'mobileCommit', 'releaseNotes', 'rollback', 'sha256', 'size', 'sourceFile', 'versionCode', 'versionName',
    ]), 'BETA28_ARTIFACT_PIN_NOT_READY')
    requireThat(beta28Pin.versionName === '1.0.0-beta.28' && beta28Pin.versionCode === 41
      && typeof beta28Pin.mobileCommit === 'string' && /^[a-f0-9]{40}$/i.test(beta28Pin.mobileCommit)
      && typeof beta28Pin.sourceFile === 'string' && /^ECFC-[A-Za-z0-9.-]+\.apk$/.test(beta28Pin.sourceFile)
      && typeof beta28Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta28Pin.sha256)
      && Number.isSafeInteger(beta28Pin.size) && beta28Pin.size >= 10000000 && beta28Pin.size <= 500000000
      && Array.isArray(beta28Pin.releaseNotes) && beta28Pin.releaseNotes.length === 6
      && beta28Pin.releaseNotes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500),
    'BETA28_ARTIFACT_PIN_NOT_READY')
    const rollback = beta28Pin.rollback
    requireThat(rollback && typeof rollback === 'object' && !Array.isArray(rollback)
      && JSON.stringify(Object.keys(rollback).sort()) === JSON.stringify(['objectKey', 'sha256', 'size', 'versionCode'])
      && rollback.versionCode === 40
      && typeof rollback.objectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.27-internal-code40-[a-f0-9]{40}-run\d+-attempt[1-9]\d*\.apk$/.test(rollback.objectKey)
      && typeof rollback.sha256 === 'string' && /^[A-F0-9]{64}$/.test(rollback.sha256)
      && Number.isSafeInteger(rollback.size) && rollback.size >= 10000000 && rollback.size <= 500000000,
    'BETA28_ROLLBACK_PIN_INVALID')
    requireThat(metadata.ANDROID_APK_SHA256 === beta28Pin.sha256, 'INVALID_BETA28_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta28Pin.size, 'INVALID_BETA28_APK_SIZE')
    requireThat(JSON.stringify(notes) === JSON.stringify(beta28Pin.releaseNotes), 'INVALID_BETA28_RELEASE_NOTES')
  }
  if (releaseCandidate === 'beta29') {
    requireThat(JSON.stringify(Object.keys(beta29Pin).sort()) === JSON.stringify([
      'mobileCommit', 'releaseNotes', 'rollback', 'sha256', 'size', 'sourceFile', 'versionCode', 'versionName',
    ]), 'BETA29_ARTIFACT_PIN_NOT_READY')
    requireThat(beta29Pin.versionName === '1.0.0-beta.29' && beta29Pin.versionCode === 42
      && typeof beta29Pin.mobileCommit === 'string' && /^[a-f0-9]{40}$/i.test(beta29Pin.mobileCommit)
      && typeof beta29Pin.sourceFile === 'string' && /^ECFC-[A-Za-z0-9.-]+\.apk$/.test(beta29Pin.sourceFile)
      && typeof beta29Pin.sha256 === 'string' && /^[A-F0-9]{64}$/.test(beta29Pin.sha256)
      && Number.isSafeInteger(beta29Pin.size) && beta29Pin.size >= 10000000 && beta29Pin.size <= 500000000
      && Array.isArray(beta29Pin.releaseNotes) && beta29Pin.releaseNotes.length === 6
      && beta29Pin.releaseNotes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500),
    'BETA29_ARTIFACT_PIN_NOT_READY')
    const rollback = beta29Pin.rollback
    requireThat(rollback && typeof rollback === 'object' && !Array.isArray(rollback)
      && JSON.stringify(Object.keys(rollback).sort()) === JSON.stringify(['objectKey', 'sha256', 'size', 'versionCode'])
      && rollback.versionCode === 41
      && typeof rollback.objectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.28-internal-code41-[a-f0-9]{40}-run\d+-attempt[1-9]\d*\.apk$/.test(rollback.objectKey)
      && typeof rollback.sha256 === 'string' && /^[A-F0-9]{64}$/.test(rollback.sha256)
      && Number.isSafeInteger(rollback.size) && rollback.size >= 10000000 && rollback.size <= 500000000,
    'BETA29_ROLLBACK_PIN_INVALID')
    requireThat(metadata.ANDROID_APK_SHA256 === beta29Pin.sha256, 'INVALID_BETA29_APK_SHA256')
    requireThat(metadata.ANDROID_APK_SIZE === beta29Pin.size, 'INVALID_BETA29_APK_SIZE')
    requireThat(JSON.stringify(notes) === JSON.stringify(beta29Pin.releaseNotes), 'INVALID_BETA29_RELEASE_NOTES')
  }
}

function validateExpectedCurrentMetadata(source, expectedCurrentMetadata) {
  if (expectedCurrentMetadata === undefined || expectedCurrentMetadata === null) return
  requireThat(expectedCurrentMetadata && typeof expectedCurrentMetadata === 'object' && !Array.isArray(expectedCurrentMetadata), 'INVALID_EXPECTED_ANDROID_METADATA')
  const expectedKeys = Object.keys(expectedCurrentMetadata).sort()
  const publicMetadataKeys = [
    'ANDROID_VERSION_NAME',
    'ANDROID_VERSION_CODE',
    'ANDROID_MINIMUM_VERSION_CODE',
    'ANDROID_FORCE_UPDATE',
    'ANDROID_APK_SHA256',
    'ANDROID_APK_SIZE',
    'ANDROID_RELEASE_NOTES',
    'ANDROID_PUBLISHED_AT',
  ].sort()
  requireThat(JSON.stringify(expectedKeys) === JSON.stringify(publicMetadataKeys), 'INVALID_EXPECTED_ANDROID_METADATA_KEYS')
  const current = dotenv.parse(source)
  for (const key of METADATA_KEYS) {
    if (!(key in expectedCurrentMetadata)) continue
    const expected = expectedCurrentMetadata[key]
    requireThat(typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean' || (key === 'ANDROID_RELEASE_NOTES' && Array.isArray(expected)), 'INVALID_EXPECTED_ANDROID_METADATA_VALUE')
    if (key === 'ANDROID_RELEASE_NOTES') {
      let actualNotes
      let expectedNotes
      try {
        actualNotes = JSON.parse(current[key] || '')
        expectedNotes = Array.isArray(expected) ? expected : JSON.parse(String(expected))
      } catch { throw new Error('ANDROID_BASELINE_MISMATCH:ANDROID_RELEASE_NOTES') }
      if (Array.isArray(actualNotes)) actualNotes = actualNotes.map((note) => typeof note === 'string' ? note.trim() : note)
      if (Array.isArray(expectedNotes)) expectedNotes = expectedNotes.map((note) => typeof note === 'string' ? note.trim() : note)
      requireThat(JSON.stringify(actualNotes) === JSON.stringify(expectedNotes), 'ANDROID_BASELINE_MISMATCH:ANDROID_RELEASE_NOTES')
      continue
    }
    if (key === 'ANDROID_PUBLISHED_AT') {
      const actualTimestamp = Date.parse(current[key] || '')
      const expectedTimestamp = Date.parse(String(expected))
      requireThat(Number.isFinite(actualTimestamp) && actualTimestamp === expectedTimestamp, `ANDROID_BASELINE_MISMATCH:${key}`)
      continue
    }
    requireThat(current[key] === String(expected), `ANDROID_BASELINE_MISMATCH:${key}`)
  }
  if (String(expectedCurrentMetadata.ANDROID_VERSION_CODE) === '30') {
    requireThat(/^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc10-\d{8}-\d{6}\.apk$/.test(current.ANDROID_APK_COS_KEY || ''), 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
  }
  if (String(expectedCurrentMetadata.ANDROID_VERSION_CODE) === '31') {
    requireThat(/^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc11-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(current.ANDROID_APK_COS_KEY || ''), 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
  }
  if (String(expectedCurrentMetadata.ANDROID_VERSION_CODE) === '32') {
    requireThat(current.ANDROID_APK_COS_KEY === CODE32_ROLLBACK_OBJECT_KEY, 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
  }
}

function validateProductionRelease(appDir, expectedProductionSha) {
  requireThat(/^[0-9a-f]{40}$/.test(expectedProductionSha), 'INVALID_EXPECTED_PRODUCTION_SHA')
  const root = path.resolve(appDir)
  const currentLink = path.join(root, 'current')
  const releasesDir = path.join(root, 'releases')
  const currentStat = lstatSync(currentLink)
  requireThat(currentStat.isSymbolicLink(), 'PRODUCTION_CURRENT_NOT_SYMLINK')
  const currentRealPath = realpathSync(currentLink)
  const releasesRealPath = realpathSync(releasesDir)
  requireThat(currentRealPath.startsWith(`${releasesRealPath}${path.sep}`), 'PRODUCTION_CURRENT_OUTSIDE_RELEASES')
  const deployedSha = readFileSync(path.join(currentRealPath, '.deployed-sha'), 'utf8').trim()
  requireThat(/^[0-9a-f]{40}$/.test(deployedSha) && deployedSha === expectedProductionSha, 'PRODUCTION_SHA_MISMATCH')
}

function replaceMetadataLines(source, metadata) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = source.endsWith('\n') || source.endsWith('\r')
  const lines = source.split(/\r?\n/)
  if (hadTrailingNewline) lines.pop()
  const positions = new Map(METADATA_KEYS.map((key) => [key, []]))
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*(?:export\s+)?)(ANDROID_[A-Z0-9_]+)\s*=/)
    if (!match || !positions.has(match[2])) continue
    positions.get(match[2]).push(index)
  }
  for (const [key, found] of positions) requireThat(found.length <= 1, `DUPLICATE_ENV_KEY:${key}`)
  for (const key of METADATA_KEYS) {
    // dotenv treats JSON.stringify's outer double quotes as an env quoting
    // layer, leaving the JSON's escaped quotes behind after parsing. Store
    // values in single quotes and encode apostrophes as JSON unicode escapes;
    // this preserves the exact JSON value while keeping # and quotes safe.
    const encodedValue = `'${String(metadata[key]).replaceAll("'", '\\u0027')}'`
    const found = positions.get(key)
    if (found.length === 1) {
      const index = found[0]
      const prefix = lines[index].match(/^(\s*(?:export\s+)?)/)[1]
      lines[index] = `${prefix}${key}=${encodedValue}`
    } else {
      lines.push(`${key}=${encodedValue}`)
    }
  }
  return `${lines.join(newline)}${hadTrailingNewline ? newline : ''}`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function writeAtomically(targetPath, contents, originalStat) {
  const tempPath = `${targetPath}.android-release-${process.pid}-${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(tempPath, 'wx', originalStat.mode & 0o777)
    writeFileSync(fd, contents, 'utf8')
    fsyncSync(fd)
    if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
      requireThat(originalStat.uid === process.getuid(), 'ENV_FILE_OWNER_MISMATCH')
      chownSync(tempPath, originalStat.uid, originalStat.gid)
    }
    chmodSync(tempPath, originalStat.mode & 0o777)
    closeSync(fd)
    fd = undefined
    renameSync(tempPath, targetPath)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(tempPath) } catch {}
    throw error
  }
}

function createProtectedBackup(sharedDir, envPath, originalStat, originalContents, timestamp) {
  const backupDir = path.join(sharedDir, '.env-backups')
  if (!existsSync(backupDir)) mkdirSync(backupDir, { mode: 0o700 })
  const backupStat = lstatSync(backupDir)
  requireThat(backupStat.isDirectory() && !backupStat.isSymbolicLink(), 'UNSAFE_BACKUP_DIRECTORY')
  chmodSync(backupDir, 0o700)
  if (process.platform !== 'win32') requireThat((lstatSync(backupDir).mode & 0o077) === 0, 'UNPROTECTED_BACKUP_DIRECTORY')

  const stamp = timestamp.toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `android-release-${stamp}-${randomUUID()}.env`)
  copyFileSync(envPath, backupPath, 1)
  chmodSync(backupPath, 0o600)
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    requireThat(originalStat.uid === process.getuid(), 'ENV_FILE_OWNER_MISMATCH')
    chownSync(backupPath, originalStat.uid, originalStat.gid)
  }
  const copied = readFileSync(backupPath)
  requireThat(sha256(copied) === sha256(originalContents), 'BACKUP_VERIFICATION_FAILED')
  return backupPath
}

export function configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata, expectedCurrentMetadata, rc13Pin, rc14Pin, beta22Pin, beta23Pin, beta24Pin, beta26Pin, beta27Pin, beta28Pin, beta29Pin, now = new Date() }) {
  validateMetadata(metadata, rc13Pin, rc14Pin, beta22Pin, beta23Pin, beta24Pin, beta26Pin, beta27Pin, beta28Pin, beta29Pin)
  if (metadata.ANDROID_VERSION_CODE === 33) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 32
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === RC12_APK_SHA256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === RC12_APK_SIZE, 'RC13_CODE32_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 34) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 33
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === RC13_APK_SHA256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === RC13_APK_SIZE, 'RC14_CODE33_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 35) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 34
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.21'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === RC14_APK_SHA256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === RC14_APK_SIZE, 'BETA22_CODE34_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 36) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 35
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.22'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === BETA22_APK_SHA256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === BETA22_APK_SIZE, 'BETA23_CODE35_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 37) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 36
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.23'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === BETA23_APK_SHA256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === BETA23_APK_SIZE, 'BETA24_CODE36_CAS_BASELINE_REQUIRED')
  }
  // Beta.25 was built but never published, so code 38 was skipped: the live
  // baseline for code 39 is still code 37, recorded in the pin's rollback block.
  if (metadata.ANDROID_VERSION_CODE === 39) {
    requireThat(beta26Pin && expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 37
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.24'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === beta26Pin.rollback.sha256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === beta26Pin.rollback.size, 'BETA26_CODE37_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 40) {
    requireThat(beta27Pin && expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 39
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.26'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === beta27Pin.rollback.sha256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === beta27Pin.rollback.size, 'BETA27_CODE39_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 41) {
    requireThat(beta28Pin && expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 40
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.27'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === beta28Pin.rollback.sha256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === beta28Pin.rollback.size, 'BETA28_CODE40_CAS_BASELINE_REQUIRED')
  }
  if (metadata.ANDROID_VERSION_CODE === 42) {
    requireThat(beta29Pin && expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 41
      && expectedCurrentMetadata.ANDROID_VERSION_NAME === '1.0.0-beta.28'
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === beta29Pin.rollback.sha256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === beta29Pin.rollback.size, 'BETA29_CODE41_CAS_BASELINE_REQUIRED')
  }
  validateProductionRelease(appDir, expectedProductionSha)
  const root = path.resolve(appDir)
  const sharedDir = path.join(root, 'shared')
  const sharedStat = lstatSync(sharedDir)
  requireThat(sharedStat.isDirectory() && !sharedStat.isSymbolicLink(), 'UNSAFE_SHARED_DIRECTORY')
  const envPath = path.join(sharedDir, '.env')
  const envStat = lstatSync(envPath)
  requireThat(envStat.isFile() && !envStat.isSymbolicLink() && envStat.size > 0, 'UNSAFE_ENV_FILE')
  const original = readFileSync(envPath)
  if (metadata.ANDROID_VERSION_CODE === 34) {
    requireThat(dotenv.parse(original).ANDROID_APK_COS_KEY === CODE33_ROLLBACK_OBJECT_KEY, 'RC14_CODE33_ROLLBACK_SOURCE_MISMATCH')
  }
  if (metadata.ANDROID_VERSION_CODE === 35) requireThat(dotenv.parse(original).ANDROID_APK_COS_KEY === CODE34_ROLLBACK_OBJECT_KEY, 'BETA22_CODE34_ROLLBACK_SOURCE_MISMATCH')
  if (metadata.ANDROID_VERSION_CODE === 36) requireThat(dotenv.parse(original).ANDROID_APK_COS_KEY === CODE35_ROLLBACK_OBJECT_KEY, 'BETA23_CODE35_ROLLBACK_SOURCE_MISMATCH')
  if (metadata.ANDROID_VERSION_CODE === 37) requireThat(dotenv.parse(original).ANDROID_APK_COS_KEY === CODE36_ROLLBACK_OBJECT_KEY, 'BETA24_CODE36_ROLLBACK_SOURCE_MISMATCH')
  validateExpectedCurrentMetadata(original.toString('utf8'), expectedCurrentMetadata)
  const updated = replaceMetadataLines(original.toString('utf8'), metadata)
  const backupPath = createProtectedBackup(sharedDir, envPath, envStat, original, now)
  writeAtomically(envPath, updated, envStat)
  const written = readFileSync(envPath, 'utf8')
  requireThat(written === updated, 'ENV_UPDATE_VERIFICATION_FAILED')
  return { backupPath, changedKeys: [...METADATA_KEYS], envSha256: sha256(written) }
}

function parseEnvMetadata(source, code) {
  const parsed = dotenv.parse(source)
  const result = Object.fromEntries(METADATA_KEYS.map((key) => [key, parsed[key]]))
  requireThat(METADATA_KEYS.every((key) => typeof result[key] === 'string'), code)
  return result
}

function validateRollbackBaseline(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.21', 'ROLLBACK_SOURCE_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '30', 'ROLLBACK_SOURCE_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_SOURCE_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_SOURCE_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === CODE30_APK_SHA256, 'ROLLBACK_SOURCE_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(CODE30_APK_SIZE), 'ROLLBACK_SOURCE_APK_SIZE_MISMATCH')
  requireThat(/^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc10-\d{8}-\d{6}\.apk$/.test(metadata.ANDROID_APK_COS_KEY || ''), 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_SOURCE_RELEASE_NOTES_INVALID') }
  requireThat(Array.isArray(notes) && notes.length === 6 && notes[5] === 'Beta.21 RC10 内测版本', 'ROLLBACK_SOURCE_RELEASE_NOTES_INVALID')
  requireThat(Number.isFinite(Date.parse(metadata.ANDROID_PUBLISHED_AT || '')), 'ROLLBACK_SOURCE_PUBLISHED_AT_INVALID')
}

function validateCurrentRc11(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.21', 'ROLLBACK_CURRENT_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '31', 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_CURRENT_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_CURRENT_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === RC11_APK_SHA256, 'ROLLBACK_CURRENT_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(RC11_APK_SIZE), 'ROLLBACK_CURRENT_APK_SIZE_MISMATCH')
  requireThat(/^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc11-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(metadata.ANDROID_APK_COS_KEY || ''), 'ROLLBACK_CURRENT_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_CURRENT_RELEASE_NOTES_INVALID') }
  requireThat(Array.isArray(notes) && notes.length === 6 && notes[5] === 'Beta.21 RC11 内测版本', 'ROLLBACK_CURRENT_RELEASE_NOTES_INVALID')
  requireThat(Number.isFinite(Date.parse(metadata.ANDROID_PUBLISHED_AT || '')), 'ROLLBACK_CURRENT_PUBLISHED_AT_INVALID')
}

function validateCode31RollbackBaseline(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.21', 'ROLLBACK_SOURCE_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '31', 'ROLLBACK_SOURCE_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_SOURCE_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_SOURCE_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === RC11_APK_SHA256, 'ROLLBACK_SOURCE_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(RC11_APK_SIZE), 'ROLLBACK_SOURCE_APK_SIZE_MISMATCH')
  requireThat(metadata.ANDROID_APK_COS_KEY === CODE31_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_SOURCE_RELEASE_NOTES_INVALID') }
  requireThat(Array.isArray(notes) && notes.length === 6 && notes[5] === 'Beta.21 RC11 内测版本', 'ROLLBACK_SOURCE_RELEASE_NOTES_INVALID')
  requireThat(Number.isFinite(Date.parse(metadata.ANDROID_PUBLISHED_AT || '')), 'ROLLBACK_SOURCE_PUBLISHED_AT_INVALID')
}

function validateCurrentRc12(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.21', 'ROLLBACK_CURRENT_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '32', 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_CURRENT_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_CURRENT_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === RC12_APK_SHA256, 'ROLLBACK_CURRENT_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(RC12_APK_SIZE), 'ROLLBACK_CURRENT_APK_SIZE_MISMATCH')
  requireThat(/^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc12-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(metadata.ANDROID_APK_COS_KEY || ''), 'ROLLBACK_CURRENT_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_CURRENT_RELEASE_NOTES_INVALID') }
  requireThat(Array.isArray(notes) && notes.length === 6 && notes[5] === 'Beta.21 RC12 内测版本', 'ROLLBACK_CURRENT_RELEASE_NOTES_INVALID')
  requireThat(Number.isFinite(Date.parse(metadata.ANDROID_PUBLISHED_AT || '')), 'ROLLBACK_CURRENT_PUBLISHED_AT_INVALID')
}

function validateCode33RollbackBaseline(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.21', 'ROLLBACK_SOURCE_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '33', 'ROLLBACK_SOURCE_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_SOURCE_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_SOURCE_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === RC13_APK_SHA256, 'ROLLBACK_SOURCE_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(RC13_APK_SIZE), 'ROLLBACK_SOURCE_APK_SIZE_MISMATCH')
  requireThat(metadata.ANDROID_APK_COS_KEY === CODE33_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_SOURCE_RELEASE_NOTES_INVALID') }
  const expectedNotes = [
    '基于 RC11 候选源码恢复 Beta21 原有移动端功能',
    '恢复广场、好友动态、活动及处方相关入口与交互',
    '恢复 EasMUSIC、「还有什么可以送给你」及勋章展览馆体验',
    '改进被访问用户主页背景显示与勋章展览馆交互',
    '保留 Native Bearer、多账号隔离及反馈上传认证修复',
    'Beta.21 RC13 内测版本',
  ]
  requireThat(JSON.stringify(notes) === JSON.stringify(expectedNotes), 'ROLLBACK_SOURCE_RELEASE_NOTES_INVALID')
  requireThat(Date.parse(metadata.ANDROID_PUBLISHED_AT || '') === Date.parse('2026-11-04T20:42:23.000Z'), 'ROLLBACK_SOURCE_PUBLISHED_AT_INVALID')
}

function validateCode34RollbackBaseline(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.21', 'ROLLBACK_SOURCE_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '34', 'ROLLBACK_SOURCE_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_SOURCE_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_SOURCE_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === RC14_APK_SHA256, 'ROLLBACK_SOURCE_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(RC14_APK_SIZE), 'ROLLBACK_SOURCE_APK_SIZE_MISMATCH')
  requireThat(metadata.ANDROID_APK_COS_KEY === CODE34_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_SOURCE_RELEASE_NOTES_INVALID') }
  const expectedNotes = ["支持查看与取消本人定时发布的帖子","完善活动中心报名体验","完善话题参与和开奖结果体验","改进通知跳转和列表刷新","改进多账号状态处理","Beta.21 RC14 内测版本"]
  requireThat(JSON.stringify(notes) === JSON.stringify(expectedNotes), 'ROLLBACK_SOURCE_RELEASE_NOTES_INVALID')
  requireThat(Date.parse(metadata.ANDROID_PUBLISHED_AT || '') === Date.parse('2026-11-13T13:18:23.000Z'), 'ROLLBACK_SOURCE_PUBLISHED_AT_INVALID')
}

function validateCode35RollbackBaseline(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.22', 'ROLLBACK_SOURCE_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '35', 'ROLLBACK_SOURCE_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_SOURCE_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_SOURCE_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === BETA22_APK_SHA256, 'ROLLBACK_SOURCE_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(BETA22_APK_SIZE), 'ROLLBACK_SOURCE_APK_SIZE_MISMATCH')
  requireThat(metadata.ANDROID_APK_COS_KEY === CODE35_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_SOURCE_RELEASE_NOTES_INVALID') }
  const expectedNotes = [
    '统一个人主页和活动中心扫码核销入口',
    '展示当前活动真实物料与领取状态',
    '展示全部中奖奖品及领取状态',
    '核销前使用应用内明细确认弹窗',
    '完善核销权限、幂等与并发保护',
    'Beta.22 正式版本',
  ]
  requireThat(JSON.stringify(notes) === JSON.stringify(expectedNotes), 'ROLLBACK_SOURCE_RELEASE_NOTES_INVALID')
  requireThat(Date.parse(metadata.ANDROID_PUBLISHED_AT || '') === Date.parse('2026-11-13T23:18:16.000Z'), 'ROLLBACK_SOURCE_PUBLISHED_AT_INVALID')
}

function validateCode36RollbackBaseline(metadata) {
  requireThat(metadata.ANDROID_VERSION_NAME === '1.0.0-beta.23', 'ROLLBACK_SOURCE_VERSION_NAME_MISMATCH')
  requireThat(metadata.ANDROID_VERSION_CODE === '36', 'ROLLBACK_SOURCE_VERSION_CODE_MISMATCH')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === '19', 'ROLLBACK_SOURCE_MINIMUM_VERSION_MISMATCH')
  requireThat(metadata.ANDROID_FORCE_UPDATE === 'false', 'ROLLBACK_SOURCE_FORCE_UPDATE_MISMATCH')
  requireThat(metadata.ANDROID_APK_SHA256?.toUpperCase() === BETA23_APK_SHA256, 'ROLLBACK_SOURCE_APK_SHA256_MISMATCH')
  requireThat(metadata.ANDROID_APK_SIZE === String(BETA23_APK_SIZE), 'ROLLBACK_SOURCE_APK_SIZE_MISMATCH')
  requireThat(metadata.ANDROID_APK_COS_KEY === CODE36_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('ROLLBACK_SOURCE_RELEASE_NOTES_INVALID') }
  const expectedNotes = [
    '支持 EasMUSIC 在线修复播放问题',
    '支持 EasMUSIC 本地导入音乐',
    '完善后台播放与锁屏通知',
    '划掉应用后停止播放',
    '补充隐私时长统计',
    'Beta.23 正式版本',
  ]
  requireThat(JSON.stringify(notes) === JSON.stringify(expectedNotes), 'ROLLBACK_SOURCE_RELEASE_NOTES_INVALID')
  requireThat(Date.parse(metadata.ANDROID_PUBLISHED_AT || '') === Date.parse('2026-11-17T17:30:43.000Z'), 'ROLLBACK_SOURCE_PUBLISHED_AT_INVALID')
}

export function restoreAndroidVersionEnv({ appDir, expectedProductionSha, backupName, targetVersionCode, code30BackupObjectKey, expectedCurrentMetadata, expectedCurrentObjectKey, rc13Pin, rc14Pin, beta22Pin, beta23Pin, beta24Pin, now = new Date() }) {
  const rollbackVersionCode = targetVersionCode
  requireThat(rollbackVersionCode === 30 || rollbackVersionCode === 31 || rollbackVersionCode === 32 || rollbackVersionCode === 33 || rollbackVersionCode === 34 || rollbackVersionCode === 35 || rollbackVersionCode === 36, 'INVALID_ROLLBACK_TARGET')
  requireThat(rollbackVersionCode === 30
    ? typeof code30BackupObjectKey === 'string'
    : !code30BackupObjectKey, 'INVALID_ROLLBACK_TARGET')
  validateProductionRelease(appDir, expectedProductionSha)
  requireThat(typeof backupName === 'string'
    && /^android-release-[A-Za-z0-9T.-]+-[0-9a-f-]{36}\.env$/.test(backupName)
    && path.basename(backupName) === backupName, 'INVALID_ROLLBACK_BACKUP_NAME')
  if (rollbackVersionCode === 30) {
    requireThat(typeof code30BackupObjectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.21-code30-backup-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(code30BackupObjectKey), 'INVALID_CODE30_BACKUP_OBJECT_KEY')
  } else {
    requireThat(!code30BackupObjectKey, 'INVALID_CODE30_OBJECT_FOR_CODE31_ROLLBACK')
  }

  const root = path.resolve(appDir)
  const sharedDir = path.join(root, 'shared')
  const sharedStat = lstatSync(sharedDir)
  requireThat(sharedStat.isDirectory() && !sharedStat.isSymbolicLink(), 'UNSAFE_SHARED_DIRECTORY')
  const envPath = path.join(sharedDir, '.env')
  const envStat = lstatSync(envPath)
  requireThat(envStat.isFile() && !envStat.isSymbolicLink() && envStat.size > 0, 'UNSAFE_ENV_FILE')
  const currentContents = readFileSync(envPath)
  const currentMetadata = parseEnvMetadata(currentContents.toString('utf8'), 'ROLLBACK_CURRENT_METADATA_MISSING')
  if (rollbackVersionCode === 36) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 37, 'BETA24_ROLLBACK_CAS_BASELINE_REQUIRED')
    requireThat(typeof expectedCurrentObjectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.24-internal-code37-[0-9a-f]{40}-run\d+-attempt[1-9]\d*\.apk$/.test(expectedCurrentObjectKey), 'BETA24_ROLLBACK_OBJECT_KEY_INVALID')
    validateExpectedCurrentMetadata(currentContents.toString('utf8'), expectedCurrentMetadata)
    requireThat(currentMetadata.ANDROID_APK_COS_KEY === expectedCurrentObjectKey, 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
    const candidate = {
      ...currentMetadata,
      ANDROID_VERSION_CODE: Number(currentMetadata.ANDROID_VERSION_CODE),
      ANDROID_MINIMUM_VERSION_CODE: Number(currentMetadata.ANDROID_MINIMUM_VERSION_CODE),
      ANDROID_FORCE_UPDATE: currentMetadata.ANDROID_FORCE_UPDATE === 'true' ? true : currentMetadata.ANDROID_FORCE_UPDATE === 'false' ? false : null,
      ANDROID_APK_SIZE: Number(currentMetadata.ANDROID_APK_SIZE),
    }
    validateMetadata(candidate, undefined, undefined, undefined, undefined, beta24Pin)
    requireThat(candidate.ANDROID_VERSION_CODE === 37, 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')

  } else if (rollbackVersionCode === 35) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 36, 'BETA23_ROLLBACK_CAS_BASELINE_REQUIRED')
    requireThat(typeof expectedCurrentObjectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.23-release-beta23-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(expectedCurrentObjectKey), 'BETA23_ROLLBACK_OBJECT_KEY_INVALID')
    validateExpectedCurrentMetadata(currentContents.toString('utf8'), expectedCurrentMetadata)
    requireThat(currentMetadata.ANDROID_APK_COS_KEY === expectedCurrentObjectKey, 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
    const candidate = {
      ...currentMetadata,
      ANDROID_VERSION_CODE: Number(currentMetadata.ANDROID_VERSION_CODE),
      ANDROID_MINIMUM_VERSION_CODE: Number(currentMetadata.ANDROID_MINIMUM_VERSION_CODE),
      ANDROID_FORCE_UPDATE: currentMetadata.ANDROID_FORCE_UPDATE === 'true' ? true : currentMetadata.ANDROID_FORCE_UPDATE === 'false' ? false : null,
      ANDROID_APK_SIZE: Number(currentMetadata.ANDROID_APK_SIZE),
    }
    validateMetadata(candidate, undefined, undefined, undefined, beta23Pin)
    requireThat(candidate.ANDROID_VERSION_CODE === 36, 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')

  } else if (rollbackVersionCode === 34) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 35, 'BETA22_ROLLBACK_CAS_BASELINE_REQUIRED')
    requireThat(typeof expectedCurrentObjectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.22-release-beta22-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(expectedCurrentObjectKey), 'BETA22_ROLLBACK_OBJECT_KEY_INVALID')
    validateExpectedCurrentMetadata(currentContents.toString('utf8'), expectedCurrentMetadata)
    requireThat(currentMetadata.ANDROID_APK_COS_KEY === expectedCurrentObjectKey, 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
    const candidate = {
      ...currentMetadata,
      ANDROID_VERSION_CODE: Number(currentMetadata.ANDROID_VERSION_CODE),
      ANDROID_MINIMUM_VERSION_CODE: Number(currentMetadata.ANDROID_MINIMUM_VERSION_CODE),
      ANDROID_FORCE_UPDATE: currentMetadata.ANDROID_FORCE_UPDATE === 'true' ? true : currentMetadata.ANDROID_FORCE_UPDATE === 'false' ? false : null,
      ANDROID_APK_SIZE: Number(currentMetadata.ANDROID_APK_SIZE),
    }
    validateMetadata(candidate, undefined, undefined, beta22Pin)
    requireThat(candidate.ANDROID_VERSION_CODE === 35, 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')

  } else if (rollbackVersionCode === 33) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 34, 'RC14_ROLLBACK_CAS_BASELINE_REQUIRED')
    requireThat(typeof expectedCurrentObjectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc14-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(expectedCurrentObjectKey), 'RC14_ROLLBACK_OBJECT_KEY_INVALID')
    validateExpectedCurrentMetadata(currentContents.toString('utf8'), expectedCurrentMetadata)
    requireThat(currentMetadata.ANDROID_APK_COS_KEY === expectedCurrentObjectKey, 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
    const candidate = {
      ...currentMetadata,
      ANDROID_VERSION_CODE: Number(currentMetadata.ANDROID_VERSION_CODE),
      ANDROID_MINIMUM_VERSION_CODE: Number(currentMetadata.ANDROID_MINIMUM_VERSION_CODE),
      ANDROID_FORCE_UPDATE: currentMetadata.ANDROID_FORCE_UPDATE === 'true' ? true : currentMetadata.ANDROID_FORCE_UPDATE === 'false' ? false : null,
      ANDROID_APK_SIZE: Number(currentMetadata.ANDROID_APK_SIZE),
    }
    validateMetadata(candidate, undefined, rc14Pin)
    requireThat(candidate.ANDROID_VERSION_CODE === 34, 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')
  } else if (rollbackVersionCode === 32) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 33, 'RC13_ROLLBACK_CAS_BASELINE_REQUIRED')
    requireThat(typeof expectedCurrentObjectKey === 'string'
      && /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc13-\d{8}-\d{6}-run\d+-attempt[1-9]\d*\.apk$/.test(expectedCurrentObjectKey), 'RC13_ROLLBACK_OBJECT_KEY_INVALID')
    validateExpectedCurrentMetadata(currentContents.toString('utf8'), expectedCurrentMetadata)
    requireThat(currentMetadata.ANDROID_APK_COS_KEY === expectedCurrentObjectKey, 'ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY')
    const candidate = {
      ...currentMetadata,
      ANDROID_VERSION_CODE: Number(currentMetadata.ANDROID_VERSION_CODE),
      ANDROID_MINIMUM_VERSION_CODE: Number(currentMetadata.ANDROID_MINIMUM_VERSION_CODE),
      ANDROID_FORCE_UPDATE: currentMetadata.ANDROID_FORCE_UPDATE === 'true' ? true : currentMetadata.ANDROID_FORCE_UPDATE === 'false' ? false : null,
      ANDROID_APK_SIZE: Number(currentMetadata.ANDROID_APK_SIZE),
    }
    validateMetadata(candidate, rc13Pin)
    requireThat(candidate.ANDROID_VERSION_CODE === 33, 'ROLLBACK_CURRENT_VERSION_CODE_MISMATCH')
  } else if (rollbackVersionCode === 31) validateCurrentRc12(currentMetadata)
  else validateCurrentRc11(currentMetadata)

  const backupDir = path.join(sharedDir, '.env-backups')
  const backupDirStat = lstatSync(backupDir)
  requireThat(backupDirStat.isDirectory() && !backupDirStat.isSymbolicLink(), 'UNSAFE_BACKUP_DIRECTORY')
  const backupPath = path.join(backupDir, backupName)
  const backupStat = lstatSync(backupPath)
  requireThat(backupStat.isFile() && !backupStat.isSymbolicLink(), 'UNSAFE_ROLLBACK_BACKUP_FILE')
  requireThat(realpathSync(backupPath).startsWith(realpathSync(backupDir) + path.sep), 'ROLLBACK_BACKUP_OUTSIDE_DIRECTORY')
  if (process.platform !== 'win32') {
    requireThat((backupStat.mode & 0o777) === 0o600, 'UNPROTECTED_ROLLBACK_BACKUP')
    requireThat(backupStat.uid === envStat.uid, 'ROLLBACK_BACKUP_OWNER_MISMATCH')
  }
  const originalMetadata = parseEnvMetadata(readFileSync(backupPath).toString('utf8'), 'ROLLBACK_SOURCE_METADATA_MISSING')
  if (rollbackVersionCode === 36) validateCode36RollbackBaseline(originalMetadata)
  else if (rollbackVersionCode === 35) validateCode35RollbackBaseline(originalMetadata)
  else if (rollbackVersionCode === 34) validateCode34RollbackBaseline(originalMetadata)
  else if (rollbackVersionCode === 33) validateCode33RollbackBaseline(originalMetadata)
  else if (rollbackVersionCode === 32) {
    validateCurrentRc12(originalMetadata)
    requireThat(originalMetadata.ANDROID_APK_COS_KEY === CODE32_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  } else if (rollbackVersionCode === 31) validateCode31RollbackBaseline(originalMetadata)
  else validateRollbackBaseline(originalMetadata)

  const restoredMetadata = Object.fromEntries(METADATA_KEYS.map((key) => [key, originalMetadata[key]]))
  restoredMetadata.ANDROID_VERSION_NAME = rollbackVersionCode === 36 ? '1.0.0-beta.23' : rollbackVersionCode === 35 ? '1.0.0-beta.22' : '1.0.0-beta.21'
  restoredMetadata.ANDROID_VERSION_CODE = rollbackVersionCode
  restoredMetadata.ANDROID_MINIMUM_VERSION_CODE = 19
  restoredMetadata.ANDROID_FORCE_UPDATE = false
  restoredMetadata.ANDROID_APK_COS_KEY = rollbackVersionCode === 30 ? code30BackupObjectKey : originalMetadata.ANDROID_APK_COS_KEY
  restoredMetadata.ANDROID_APK_SHA256 = rollbackVersionCode === 36 ? BETA23_APK_SHA256 : rollbackVersionCode === 35 ? BETA22_APK_SHA256 : rollbackVersionCode === 34 ? RC14_APK_SHA256 : rollbackVersionCode === 33 ? RC13_APK_SHA256 : rollbackVersionCode === 32 ? RC12_APK_SHA256 : rollbackVersionCode === 31 ? RC11_APK_SHA256 : CODE30_APK_SHA256
  restoredMetadata.ANDROID_APK_SIZE = rollbackVersionCode === 36 ? BETA23_APK_SIZE : rollbackVersionCode === 35 ? BETA22_APK_SIZE : rollbackVersionCode === 34 ? RC14_APK_SIZE : rollbackVersionCode === 33 ? RC13_APK_SIZE : rollbackVersionCode === 32 ? RC12_APK_SIZE : rollbackVersionCode === 31 ? RC11_APK_SIZE : CODE30_APK_SIZE
  restoredMetadata.ANDROID_RELEASE_NOTES = originalMetadata.ANDROID_RELEASE_NOTES
  restoredMetadata.ANDROID_PUBLISHED_AT = originalMetadata.ANDROID_PUBLISHED_AT

  const updated = replaceMetadataLines(currentContents.toString('utf8'), restoredMetadata)
  const rollbackBackupPath = createProtectedBackup(sharedDir, envPath, envStat, currentContents, now)
  writeAtomically(envPath, updated, envStat)
  const written = readFileSync(envPath, 'utf8')
  requireThat(written === updated, 'ROLLBACK_ENV_UPDATE_VERIFICATION_FAILED')
  const writtenMetadata = parseEnvMetadata(written, 'ROLLBACK_RESULT_METADATA_MISSING')
  requireThat(writtenMetadata.ANDROID_VERSION_CODE === String(rollbackVersionCode)
    && writtenMetadata.ANDROID_APK_COS_KEY === restoredMetadata.ANDROID_APK_COS_KEY
    && writtenMetadata.ANDROID_APK_SHA256 === restoredMetadata.ANDROID_APK_SHA256
    && writtenMetadata.ANDROID_APK_SIZE === String(restoredMetadata.ANDROID_APK_SIZE)
    && writtenMetadata.ANDROID_RELEASE_NOTES === originalMetadata.ANDROID_RELEASE_NOTES
    && writtenMetadata.ANDROID_PUBLISHED_AT === originalMetadata.ANDROID_PUBLISHED_AT, 'ROLLBACK_RESULT_MISMATCH')
  return { backupPath: rollbackBackupPath, changedKeys: [...METADATA_KEYS], envSha256: sha256(written) }
}

function main() {
  requireThat(process.env.APP_DIR === PRODUCTION_APP_DIR, 'UNEXPECTED_PRODUCTION_APP_DIR')
  const expectedProductionSha = process.env.EXPECTED_PRODUCTION_SHA ?? ''
  const operation = process.env.ANDROID_RELEASE_OPERATION ?? 'publish'
  if (operation === 'rollback-code36') {
    const encoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({ appDir: PRODUCTION_APP_DIR, expectedProductionSha,
      backupName: rollback.backupName, targetVersionCode: 36,
      expectedCurrentMetadata: rollback.expectedCurrentMetadata, expectedCurrentObjectKey: rollback.expectedCurrentObjectKey, beta24Pin: rollback.beta24Pin })
    console.log('PRODUCTION_SHA_VERIFIED=' + expectedProductionSha)
    console.log('ANDROID_METADATA_KEYS_RESTORED=' + result.changedKeys.length)
    console.log('CODE37_ENV_BACKUP_CREATED=' + path.basename(result.backupPath))
    console.log('ANDROID_METADATA_ROLLBACK_TO_CODE36_ATOMIC=YES')
    return
  }
  if (operation === 'rollback-code35') {
    const encoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({ appDir: PRODUCTION_APP_DIR, expectedProductionSha,
      backupName: rollback.backupName, targetVersionCode: 35,
      expectedCurrentMetadata: rollback.expectedCurrentMetadata, expectedCurrentObjectKey: rollback.expectedCurrentObjectKey, beta23Pin: rollback.beta23Pin })
    console.log('PRODUCTION_SHA_VERIFIED=' + expectedProductionSha)
    console.log('ANDROID_METADATA_KEYS_RESTORED=' + result.changedKeys.length)
    console.log('CODE36_ENV_BACKUP_CREATED=' + path.basename(result.backupPath))
    console.log('ANDROID_METADATA_ROLLBACK_TO_CODE35_ATOMIC=YES')
    return
  }
  if (operation === 'rollback-code34') {
    const encoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({ appDir: PRODUCTION_APP_DIR, expectedProductionSha,
      backupName: rollback.backupName, targetVersionCode: 34,
      expectedCurrentMetadata: rollback.expectedCurrentMetadata, expectedCurrentObjectKey: rollback.expectedCurrentObjectKey, beta22Pin: rollback.beta22Pin })
    console.log('PRODUCTION_SHA_VERIFIED=' + expectedProductionSha)
    console.log('ANDROID_METADATA_KEYS_RESTORED=' + result.changedKeys.length)
    console.log('CODE35_ENV_BACKUP_CREATED=' + path.basename(result.backupPath))
    console.log('ANDROID_METADATA_ROLLBACK_TO_CODE34_ATOMIC=YES')
    return
  }
  if (operation === 'rollback-code33') {
    const encoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({ appDir: PRODUCTION_APP_DIR, expectedProductionSha,
      backupName: rollback.backupName, targetVersionCode: 33,
      expectedCurrentMetadata: rollback.expectedCurrentMetadata, expectedCurrentObjectKey: rollback.expectedCurrentObjectKey, rc14Pin: rollback.rc14Pin })
    console.log('PRODUCTION_SHA_VERIFIED=' + expectedProductionSha)
    console.log('ANDROID_METADATA_KEYS_RESTORED=' + result.changedKeys.length)
    console.log('CODE34_ENV_BACKUP_CREATED=' + path.basename(result.backupPath))
    console.log('ANDROID_METADATA_ROLLBACK_TO_CODE33_ATOMIC=YES')
    return
  }
  if (operation === 'rollback-code32') {
    const encoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({ appDir: PRODUCTION_APP_DIR, expectedProductionSha,
      backupName: rollback.backupName, targetVersionCode: 32,
      expectedCurrentMetadata: rollback.expectedCurrentMetadata, expectedCurrentObjectKey: rollback.expectedCurrentObjectKey, rc13Pin: rollback.rc13Pin })
    console.log('PRODUCTION_SHA_VERIFIED=' + expectedProductionSha)
    console.log('ANDROID_METADATA_KEYS_RESTORED=' + result.changedKeys.length)
    console.log('CODE33_ENV_BACKUP_CREATED=' + path.basename(result.backupPath))
    console.log('ANDROID_METADATA_ROLLBACK_TO_CODE32_ATOMIC=YES')
    return
  }
  if (operation === 'rollback-code31') {
    const rollbackEncoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(rollbackEncoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(rollbackEncoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({
      appDir: PRODUCTION_APP_DIR,
      expectedProductionSha,
      backupName: rollback.backupName,
      targetVersionCode: 31,
    })
    console.log('PRODUCTION_SHA_VERIFIED=' + expectedProductionSha)
    console.log('ANDROID_METADATA_KEYS_RESTORED=' + result.changedKeys.length)
    console.log('CODE32_ENV_BACKUP_CREATED=' + path.basename(result.backupPath))
    console.log('ANDROID_METADATA_ROLLBACK_TO_CODE31_ATOMIC=YES')
    return
  }
  if (operation === 'rollback') {
    const rollbackEncoded = process.env.ANDROID_RELEASE_ROLLBACK_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(rollbackEncoded), 'INVALID_ROLLBACK_METADATA_ENCODING')
    let rollback
    try { rollback = JSON.parse(Buffer.from(rollbackEncoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_ROLLBACK_METADATA_ENCODING') }
    const result = restoreAndroidVersionEnv({
      appDir: PRODUCTION_APP_DIR,
      expectedProductionSha,
      backupName: rollback.backupName,
      targetVersionCode: 30,
      code30BackupObjectKey: rollback.code30BackupObjectKey,
    })
    console.log(`PRODUCTION_SHA_VERIFIED=${expectedProductionSha}`)
    console.log(`ANDROID_METADATA_KEYS_RESTORED=${result.changedKeys.length}`)
    console.log(`CODE31_ENV_BACKUP_CREATED=${path.basename(result.backupPath)}`)
    console.log('ANDROID_METADATA_ROLLBACK_ATOMIC=YES')
    return
  }
  requireThat(operation === 'publish', 'INVALID_ANDROID_RELEASE_OPERATION')
  const encoded = process.env.ANDROID_RELEASE_METADATA_B64 ?? ''
  requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_METADATA_ENCODING')
  const expectedCurrentEncoded = process.env.ANDROID_EXPECTED_CURRENT_B64 ?? ''
  let metadata
  try { metadata = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_METADATA_ENCODING') }
  let expectedCurrentMetadata
  if (expectedCurrentEncoded) {
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(expectedCurrentEncoded), 'INVALID_EXPECTED_ANDROID_METADATA_ENCODING')
    try { expectedCurrentMetadata = JSON.parse(Buffer.from(expectedCurrentEncoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_EXPECTED_ANDROID_METADATA_ENCODING') }
  }
  let rc13Pin
  if (metadata?.ANDROID_VERSION_CODE === 33) {
    const pinEncoded = process.env.ANDROID_RC13_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'RC13_ARTIFACT_PIN_NOT_READY')
    try { rc13Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('RC13_ARTIFACT_PIN_NOT_READY') }
  }
  let rc14Pin
  if (metadata?.ANDROID_VERSION_CODE === 34) {
    const pinEncoded = process.env.ANDROID_RC14_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'RC14_ARTIFACT_PIN_NOT_READY')
    try { rc14Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('RC14_ARTIFACT_PIN_NOT_READY') }
  }
  let beta22Pin
  if (metadata?.ANDROID_VERSION_CODE === 35) {
    const pinEncoded = process.env.ANDROID_BETA22_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA22_ARTIFACT_PIN_NOT_READY')
    try { beta22Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA22_ARTIFACT_PIN_NOT_READY') }
  }
  let beta23Pin
  if (metadata?.ANDROID_VERSION_CODE === 36) {
    const pinEncoded = process.env.ANDROID_BETA23_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA23_ARTIFACT_PIN_NOT_READY')
    try { beta23Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA23_ARTIFACT_PIN_NOT_READY') }
  }
  let beta24Pin
  if (metadata?.ANDROID_VERSION_CODE === 37) {
    const pinEncoded = process.env.ANDROID_BETA24_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA24_ARTIFACT_PIN_NOT_READY')
    try { beta24Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA24_ARTIFACT_PIN_NOT_READY') }
  }
  let beta26Pin
  if (metadata?.ANDROID_VERSION_CODE === 39) {
    const pinEncoded = process.env.ANDROID_BETA26_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA26_ARTIFACT_PIN_NOT_READY')
    try { beta26Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA26_ARTIFACT_PIN_NOT_READY') }
  }
  let beta27Pin
  if (metadata?.ANDROID_VERSION_CODE === 40) {
    const pinEncoded = process.env.ANDROID_BETA27_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA27_ARTIFACT_PIN_NOT_READY')
    try { beta27Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA27_ARTIFACT_PIN_NOT_READY') }
  }
  let beta28Pin
  if (metadata?.ANDROID_VERSION_CODE === 41) {
    const pinEncoded = process.env.ANDROID_BETA28_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA28_ARTIFACT_PIN_NOT_READY')
    try { beta28Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA28_ARTIFACT_PIN_NOT_READY') }
  }
  let beta29Pin
  if (metadata?.ANDROID_VERSION_CODE === 42) {
    const pinEncoded = process.env.ANDROID_BETA29_ARTIFACT_PIN_B64 ?? ''
    requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(pinEncoded), 'BETA29_ARTIFACT_PIN_NOT_READY')
    try { beta29Pin = JSON.parse(Buffer.from(pinEncoded, 'base64').toString('utf8')) }
    catch { throw new Error('BETA29_ARTIFACT_PIN_NOT_READY') }
  }
  const result = configureAndroidVersionEnv({
    appDir: PRODUCTION_APP_DIR,
    expectedProductionSha,
    metadata,
    expectedCurrentMetadata,
    rc13Pin,
    rc14Pin,
    beta22Pin,
    beta23Pin,
    beta24Pin,
    beta26Pin,
    beta27Pin,
    beta28Pin,
    beta29Pin,
  })
  console.log(`PRODUCTION_SHA_VERIFIED=${expectedProductionSha}`)
  console.log(`ANDROID_METADATA_KEYS_UPDATED=${result.changedKeys.length}`)
  console.log(`ENV_BACKUP_CREATED=${path.basename(result.backupPath)}`)
  console.log('ENV_UPDATE_ATOMIC=YES')
}

if (process.argv[1] === '-' || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    main()
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    console.error(`ANDROID_METADATA_UPDATE_FAILED=${code}`)
    process.exitCode = 1
  }
}
