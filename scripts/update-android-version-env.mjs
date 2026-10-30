import { randomUUID, createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, chownSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PRODUCTION_APP_DIR = '/home/apps/easonfansclub'
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

function requireThat(condition, code) {
  if (!condition) throw new Error(code)
}

function validateMetadata(metadata) {
  requireThat(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'INVALID_METADATA')
  const actualKeys = Object.keys(metadata).sort()
  requireThat(JSON.stringify(actualKeys) === JSON.stringify([...METADATA_KEYS].sort()), 'INVALID_METADATA_KEYS')
  requireThat(/^1\.0\.0-beta\.21$/.test(metadata.ANDROID_VERSION_NAME), 'INVALID_VERSION_NAME')
  requireThat(metadata.ANDROID_VERSION_CODE === 21, 'INVALID_VERSION_CODE')
  requireThat(metadata.ANDROID_MINIMUM_VERSION_CODE === 19, 'INVALID_MINIMUM_VERSION_CODE')
  requireThat(metadata.ANDROID_FORCE_UPDATE === false, 'INVALID_FORCE_UPDATE')
  requireThat(typeof metadata.ANDROID_APK_COS_KEY === 'string'
    && /^android\/releases\/ECFC-1\.0\.0-beta\.21-release-beta21-rc1-20261030-133912\.apk$/.test(metadata.ANDROID_APK_COS_KEY), 'INVALID_APK_OBJECT_KEY')
  requireThat(typeof metadata.ANDROID_APK_SHA256 === 'string'
    && metadata.ANDROID_APK_SHA256 === '0ED0920207C34A42DDBC4537FED476BB158D175AC5503B67F9A4054AF4B4ADF2', 'INVALID_APK_SHA256')
  requireThat(metadata.ANDROID_APK_SIZE === 180295939, 'INVALID_APK_SIZE')
  requireThat(typeof metadata.ANDROID_RELEASE_NOTES === 'string', 'INVALID_RELEASE_NOTES')
  let notes
  try { notes = JSON.parse(metadata.ANDROID_RELEASE_NOTES) } catch { throw new Error('INVALID_RELEASE_NOTES') }
  requireThat(Array.isArray(notes) && notes.length === 4
    && notes.every((note) => typeof note === 'string' && note.length > 0 && note.length <= 500), 'INVALID_RELEASE_NOTES')
  requireThat(typeof metadata.ANDROID_PUBLISHED_AT === 'string'
    && Number.isFinite(Date.parse(metadata.ANDROID_PUBLISHED_AT)), 'INVALID_PUBLISHED_AT')
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

export function configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata, now = new Date() }) {
  validateMetadata(metadata)
  validateProductionRelease(appDir, expectedProductionSha)
  const root = path.resolve(appDir)
  const sharedDir = path.join(root, 'shared')
  const sharedStat = lstatSync(sharedDir)
  requireThat(sharedStat.isDirectory() && !sharedStat.isSymbolicLink(), 'UNSAFE_SHARED_DIRECTORY')
  const envPath = path.join(sharedDir, '.env')
  const envStat = lstatSync(envPath)
  requireThat(envStat.isFile() && !envStat.isSymbolicLink() && envStat.size > 0, 'UNSAFE_ENV_FILE')
  const original = readFileSync(envPath)
  const updated = replaceMetadataLines(original.toString('utf8'), metadata)
  const backupPath = createProtectedBackup(sharedDir, envPath, envStat, original, now)
  writeAtomically(envPath, updated, envStat)
  const written = readFileSync(envPath, 'utf8')
  requireThat(written === updated, 'ENV_UPDATE_VERIFICATION_FAILED')
  return { backupPath, changedKeys: [...METADATA_KEYS], envSha256: sha256(written) }
}

function main() {
  requireThat(process.env.APP_DIR === PRODUCTION_APP_DIR, 'UNEXPECTED_PRODUCTION_APP_DIR')
  const expectedProductionSha = process.env.EXPECTED_PRODUCTION_SHA ?? ''
  const encoded = process.env.ANDROID_RELEASE_METADATA_B64 ?? ''
  requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_METADATA_ENCODING')
  let metadata
  try { metadata = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { throw new Error('INVALID_METADATA_ENCODING') }
  const result = configureAndroidVersionEnv({
    appDir: PRODUCTION_APP_DIR,
    expectedProductionSha,
    metadata,
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
