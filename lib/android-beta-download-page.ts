import { ANDROID_APP_DOWNLOAD_URL, ANDROID_APP_DOWNLOAD_PATH, type AppVersionManifest } from '@/lib/app-version'

export const ANDROID_BETA_DOWNLOAD_PAGE_PATH = '/app/android'
export const ANDROID_BETA_DOWNLOAD_PAGE_URL = `https://ecfc.fans${ANDROID_BETA_DOWNLOAD_PAGE_PATH}`
export const ANDROID_BETA_DIRECT_DOWNLOAD_URL = ANDROID_APP_DOWNLOAD_URL

export type AndroidDownloadVisitor = 'ios' | 'wechat-android' | 'standard'

export type AndroidDownloadPageModel =
  | { status: 'available'; visitor: AndroidDownloadVisitor; manifest: AppVersionManifest }
  | { status: 'unavailable'; visitor: AndroidDownloadVisitor }

function isPublicManifest(value: unknown): value is AppVersionManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<AppVersionManifest>
  return manifest.platform === 'android'
    && typeof manifest.versionName === 'string'
    && manifest.versionName.length > 0
    && manifest.versionName.length <= 80
    && Number.isSafeInteger(manifest.versionCode)
    && Number.isSafeInteger(manifest.minimumVersionCode)
    && Number(manifest.minimumVersionCode) > 0
    && Number(manifest.minimumVersionCode) <= Number(manifest.versionCode)
    && typeof manifest.forceUpdate === 'boolean'
    && manifest.downloadUrl === ANDROID_APP_DOWNLOAD_URL
    && typeof manifest.apkSha256 === 'string'
    && /^[a-f\d]{64}$/i.test(manifest.apkSha256)
    && Number.isSafeInteger(manifest.size)
    && Number(manifest.size) > 0
    && Array.isArray(manifest.releaseNotes)
    && manifest.releaseNotes.every((note) => typeof note === 'string' && note.trim().length > 0 && note.length <= 500)
    && (manifest.publishedAt === undefined || (typeof manifest.publishedAt === 'string' && Number.isFinite(Date.parse(manifest.publishedAt))))
}

export function classifyAndroidDownloadVisitor(userAgent: string, platformHint = ''): AndroidDownloadVisitor {
  const agent = userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(agent) || platformHint.replaceAll('"', '').toLowerCase() === 'ios') return 'ios'
  if (/android/.test(agent) && /micromessenger/.test(agent)) return 'wechat-android'
  return 'standard'
}

export function createAndroidDownloadPageModel(manifest: unknown, visitor: AndroidDownloadVisitor): AndroidDownloadPageModel {
  if (!isPublicManifest(manifest)) return { status: 'unavailable', visitor }
  return { status: 'available', visitor, manifest }
}

export function formatAndroidApkSize(bytes: number): string | null {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

export function formatAndroidPublishedDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getAndroidDownloadContract() {
  return {
    landingPageUrl: ANDROID_BETA_DOWNLOAD_PAGE_URL,
    directDownloadUrl: ANDROID_BETA_DIRECT_DOWNLOAD_URL,
    directDownloadPath: ANDROID_APP_DOWNLOAD_PATH,
  }
}
