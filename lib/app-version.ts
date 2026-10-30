export const ANDROID_APP_DOWNLOAD_PATH = '/api/app/download/android'
export const ANDROID_APP_DOWNLOAD_URL = `https://ecfc.fans${ANDROID_APP_DOWNLOAD_PATH}`

export type AppVersionConfig = {
  platform: 'android'
  versionName: string
  versionCode: number
  minimumVersionCode: number
  forceUpdate: boolean
  downloadUrl: string
  apkSha256: string
  size: number
  /** Private server-side storage key. Never serialize this value to clients. */
  apkObjectKey: string
  releaseNotes: string[]
  publishedAt?: string
}

export type AppVersionManifest = Omit<AppVersionConfig, 'apkObjectKey'>
export type AppVersionEnvironment = Readonly<Record<string, string | undefined>>

const MAX_VERSION_NAME_LENGTH = 80
const MAX_ANDROID_VERSION_CODE = 2_100_000_000
const MAX_RELEASE_NOTE_LENGTH = 500
const MAX_RELEASE_NOTES = 50
const SAFE_APK_OBJECT_KEY = /^android\/releases\/[A-Za-z0-9][A-Za-z0-9._/-]{0,220}\.apk$/

function trimmed(env: AppVersionEnvironment, name: string) {
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_ANDROID_VERSION_CODE ? parsed : null
}

function parseBoolean(value: string) {
  if (!value) return false
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function parseReleaseNotes(value: string) {
  if (!value) return []
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!Array.isArray(parsed) || parsed.length > MAX_RELEASE_NOTES) return null
  const notes = parsed.map((note) => (typeof note === 'string' ? note.trim() : ''))
  if (notes.some((note) => !note || note.length > MAX_RELEASE_NOTE_LENGTH)) return null
  return notes
}

function parsePublishedAt(value: string) {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function parseApkObjectKey(value: string) {
  if (!SAFE_APK_OBJECT_KEY.test(value) || value.includes('\\')) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return value
}

function parseSha256(value: string) {
  return /^[a-f\d]{64}$/i.test(value) ? value.toLowerCase() : null
}

/**
 * Reads the Android update contract from deployment environment variables.
 * The storage key remains server-only; API callers receive only the fixed ECFC
 * download endpoint and the digest for client-side verification.
 */
export function parseAppVersionConfig(env: AppVersionEnvironment): AppVersionConfig | null {
  const versionName = trimmed(env, 'ANDROID_VERSION_NAME')
  const versionCode = parsePositiveInteger(trimmed(env, 'ANDROID_VERSION_CODE'))
  const minimumVersionCode = parsePositiveInteger(trimmed(env, 'ANDROID_MINIMUM_VERSION_CODE'))
  const forceUpdate = parseBoolean(trimmed(env, 'ANDROID_FORCE_UPDATE'))
  const apkObjectKey = parseApkObjectKey(trimmed(env, 'ANDROID_APK_COS_KEY'))
  const apkSha256 = parseSha256(trimmed(env, 'ANDROID_APK_SHA256'))
  const apkSize = parsePositiveInteger(trimmed(env, 'ANDROID_APK_SIZE'))
  const releaseNotes = parseReleaseNotes(trimmed(env, 'ANDROID_RELEASE_NOTES'))
  const publishedAt = parsePublishedAt(trimmed(env, 'ANDROID_PUBLISHED_AT'))
  const cosConfigured = Boolean(
    trimmed(env, 'TENCENT_COS_SECRET_ID') || trimmed(env, 'COS_SECRET_ID'),
  ) && Boolean(
    trimmed(env, 'TENCENT_COS_SECRET_KEY') || trimmed(env, 'COS_SECRET_KEY'),
  ) && Boolean(
    trimmed(env, 'TENCENT_COS_BUCKET') || trimmed(env, 'COS_BUCKET'),
  ) && Boolean(
    trimmed(env, 'TENCENT_COS_REGION') || trimmed(env, 'COS_REGION'),
  )

  if (
    !versionName
    || versionName.length > MAX_VERSION_NAME_LENGTH
    || versionCode === null
    || minimumVersionCode === null
    || minimumVersionCode > versionCode
    || forceUpdate === null
    || apkObjectKey === null
    || apkSha256 === null
    || apkSize === null
    || !cosConfigured
    || releaseNotes === null
    || publishedAt === null
  ) return null

  return {
    platform: 'android',
    versionName,
    versionCode,
    minimumVersionCode,
    forceUpdate,
    downloadUrl: ANDROID_APP_DOWNLOAD_URL,
    apkSha256,
    size: apkSize,
    apkObjectKey,
    releaseNotes,
    ...(publishedAt ? { publishedAt } : {}),
  }
}

export function toPublicAppVersionManifest(config: AppVersionConfig): AppVersionManifest {
  return {
    platform: config.platform,
    versionName: config.versionName,
    versionCode: config.versionCode,
    minimumVersionCode: config.minimumVersionCode,
    forceUpdate: config.forceUpdate,
    downloadUrl: config.downloadUrl,
    apkSha256: config.apkSha256,
    size: config.size,
    releaseNotes: config.releaseNotes,
    ...(config.publishedAt ? { publishedAt: config.publishedAt } : {}),
  }
}
