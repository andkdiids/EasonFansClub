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
const CODE31_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk'
const CODE32_ROLLBACK_OBJECT_KEY = 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-185753-run41698377689-attempt1.apk'

function requireThat(condition, code) {
  if (!condition) throw new Error(code)
}

function validateMetadata(metadata, rc13Pin) {
  requireThat(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'INVALID_METADATA')
  const actualKeys = Object.keys(metadata).sort()
  requireThat(JSON.stringify(actualKeys) === JSON.stringify([...METADATA_KEYS].sort()), 'INVALID_METADATA_KEYS')
  requireThat(/^1\.0\.0-beta\.21$/.test(metadata.ANDROID_VERSION_NAME), 'INVALID_VERSION_NAME')
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
                    : metadata.ANDROID_VERSION_CODE === 33 ? 'rc13' : null
  requireThat(releaseCandidate !== null, 'INVALID_VERSION_CODE')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === 19, 'INVALID_MINIMUM_VERSION_CODE')
  requireThat(metadata.ANDROID_FORCE_UPDATE === false, 'INVALID_FORCE_UPDATE')
  const objectKeyPattern = releaseCandidate === 'rc11' || releaseCandidate === 'rc12' || releaseCandidate === 'rc13'
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
  requireThat(notes[5] === `Beta.21 ${releaseCandidate.toUpperCase()} 内测版本`, 'INVALID_RELEASE_NOTES')
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

export function configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata, expectedCurrentMetadata, rc13Pin, now = new Date() }) {
  validateMetadata(metadata, rc13Pin)
  if (metadata.ANDROID_VERSION_CODE === 33) {
    requireThat(expectedCurrentMetadata && expectedCurrentMetadata.ANDROID_VERSION_CODE === 32
      && String(expectedCurrentMetadata.ANDROID_APK_SHA256).toUpperCase() === RC12_APK_SHA256
      && expectedCurrentMetadata.ANDROID_APK_SIZE === RC12_APK_SIZE, 'RC13_CODE32_CAS_BASELINE_REQUIRED')
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

export function restoreAndroidVersionEnv({ appDir, expectedProductionSha, backupName, targetVersionCode, code30BackupObjectKey, expectedCurrentMetadata, expectedCurrentObjectKey, rc13Pin, now = new Date() }) {
  const rollbackVersionCode = targetVersionCode
  requireThat(rollbackVersionCode === 30 || rollbackVersionCode === 31 || rollbackVersionCode === 32, 'INVALID_ROLLBACK_TARGET')
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
  if (rollbackVersionCode === 32) {
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
  if (rollbackVersionCode === 32) {
    validateCurrentRc12(originalMetadata)
    requireThat(originalMetadata.ANDROID_APK_COS_KEY === CODE32_ROLLBACK_OBJECT_KEY, 'ROLLBACK_SOURCE_OBJECT_KEY_MISMATCH')
  } else if (rollbackVersionCode === 31) validateCode31RollbackBaseline(originalMetadata)
  else validateRollbackBaseline(originalMetadata)

  const restoredMetadata = Object.fromEntries(METADATA_KEYS.map((key) => [key, originalMetadata[key]]))
  restoredMetadata.ANDROID_VERSION_NAME = '1.0.0-beta.21'
  restoredMetadata.ANDROID_VERSION_CODE = rollbackVersionCode
  restoredMetadata.ANDROID_MINIMUM_VERSION_CODE = 19
  restoredMetadata.ANDROID_FORCE_UPDATE = false
  restoredMetadata.ANDROID_APK_COS_KEY = rollbackVersionCode === 30 ? code30BackupObjectKey : originalMetadata.ANDROID_APK_COS_KEY
  restoredMetadata.ANDROID_APK_SHA256 = rollbackVersionCode === 32 ? RC12_APK_SHA256 : rollbackVersionCode === 31 ? RC11_APK_SHA256 : CODE30_APK_SHA256
  restoredMetadata.ANDROID_APK_SIZE = rollbackVersionCode === 32 ? RC12_APK_SIZE : rollbackVersionCode === 31 ? RC11_APK_SIZE : CODE30_APK_SIZE
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
  const result = configureAndroidVersionEnv({
    appDir: PRODUCTION_APP_DIR,
    expectedProductionSha,
    metadata,
    expectedCurrentMetadata,
    rc13Pin,
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
