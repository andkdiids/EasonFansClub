/**
 * The public Tencent COS host that older records may contain. Server-side
 * storage and signing code continues to use COS directly; browser-facing
 * responses are normalized through the media gateway below.
 */
export const PUBLIC_COS_HOST = 'ecfc-1306412725.cos.ap-guangzhou.myqcloud.com'
export const COS_PROXY_PREFIX = '/cos'
export const COS_PROXY_PREFIXES = ['/cos', '/cos-files'] as const
export const DEFAULT_MEDIA_PUBLIC_BASE_URL = 'https://media.ecfc.fans/media'

function trimValue(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

export function getMediaPublicBaseUrl() {
  const configured = process.env.MEDIA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
  if (!configured) return DEFAULT_MEDIA_PUBLIC_BASE_URL

  try {
    const parsed = new URL(configured)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return DEFAULT_MEDIA_PUBLIC_BASE_URL
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` || DEFAULT_MEDIA_PUBLIC_BASE_URL
  } catch {
    return DEFAULT_MEDIA_PUBLIC_BASE_URL
  }
}

/** Build a browser-facing URL for an object that is stored in Tencent COS. */
export function buildPublicMediaUrl(key: string) {
  const normalizedKey = key.trim().replace(/^\/+/, '')
  return `${getMediaPublicBaseUrl()}/${normalizedKey.split('/').map(encodeURIComponent).join('/')}`
}

function parseMediaPublicBaseUrl() {
  try {
    const parsed = new URL(getMediaPublicBaseUrl())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed
  } catch {
    return null
  }
}

function isCosProxyPath(value: string) {
  return COS_PROXY_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))
}

function cosProxyPathFromUrl(value: string) {
  try {
    const parsed = new URL(value, 'https://local.invalid')
    if (parsed.origin !== 'https://local.invalid' || !isCosProxyPath(parsed.pathname)) return null
    const prefix = COS_PROXY_PREFIXES.find((candidate) => parsed.pathname === candidate || parsed.pathname.startsWith(`${candidate}/`)) || COS_PROXY_PREFIX
    return {
      path: parsed.pathname.slice(prefix.length) || '/',
      search: parsed.search,
      hash: parsed.hash,
    }
  } catch {
    return null
  }
}

function isCosHost(value: URL) {
  const hostname = value.hostname.toLowerCase()
  return hostname === PUBLIC_COS_HOST
    || /^[^.]+\.cos\.[^.]+\.myqcloud\.com$/i.test(hostname)
}

function isMediaPublicUrl(value: URL) {
  const base = parseMediaPublicBaseUrl()
  if (!base || value.origin !== base.origin) return false
  const basePath = base.pathname === '/' ? '' : base.pathname
  return value.pathname === basePath || value.pathname.startsWith(`${basePath}/`)
}

function mediaPathFromUrl(value: URL) {
  const base = parseMediaPublicBaseUrl()
  if (!base || !isMediaPublicUrl(value)) return null
  const basePath = base.pathname === '/' ? '' : base.pathname
  return value.pathname.slice(basePath.length).replace(/^\/+/, '')
}

/** True when the browser should request an existing media proxy URL directly. */
export function isPublicMediaProxyUrl(value?: string | null) {
  const url = trimValue(value)
  if (!url) return false
  if (cosProxyPathFromUrl(url)) return true
  try {
    return isMediaPublicUrl(new URL(url))
  } catch {
    return false
  }
}

/**
 * Convert COS public URLs and legacy relative /cos proxy paths to the media
 * gateway. Local paths, data/blob URLs, unknown external URLs, and empty
 * values are kept unchanged.
 */
export function toPublicMediaUrl(value?: string | null) {
  const url = trimValue(value)
  if (!url) return null

  const cosProxyPath = cosProxyPathFromUrl(url)
  if (cosProxyPath) {
    return `${getMediaPublicBaseUrl()}${cosProxyPath.path}${cosProxyPath.search}${cosProxyPath.hash}`
  }
  if (isPublicMediaProxyUrl(url)) return url

  try {
    const parsed = new URL(url)
    if (!isCosHost(parsed) || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return url

    const base = getMediaPublicBaseUrl()
    const path = parsed.pathname || '/'
    return `${base}${path.startsWith('/') ? path : `/${path}`}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

/**
 * Convert a public proxy URL back to the original COS URL before persisting
 * input received from a browser. Arbitrary local and external URLs are never
 * rewritten.
 */
export function toStoredMediaUrl(value?: string | null) {
  const url = trimValue(value)
  if (!url || !isPublicMediaProxyUrl(url)) return url

  try {
    const parsed = new URL(url, 'https://local.invalid')
    const mediaPath = mediaPathFromUrl(parsed)
    if (mediaPath !== null) {
      return `https://${PUBLIC_COS_HOST}/${mediaPath}${parsed.search}${parsed.hash}`
    }
    const cosProxyPath = cosProxyPathFromUrl(url)
    if (cosProxyPath) return `https://${PUBLIC_COS_HOST}${cosProxyPath.path}${cosProxyPath.search}${cosProxyPath.hash}`
    return url
  } catch {
    return url
  }
}
