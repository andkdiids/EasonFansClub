/**
 * The public Tencent COS host that is currently stored in the database.
 * Browser requests for this host are served by the existing Nginx /cos/
 * reverse proxy, while server-side SDK and signing code continues to use COS
 * directly.
 */
export const PUBLIC_COS_HOST = 'ecfc-1306412725.cos.ap-guangzhou.myqcloud.com'
export const COS_PROXY_PREFIX = '/cos'

function trimValue(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

function isCosProxyPath(value: string) {
  return value === COS_PROXY_PREFIX || value.startsWith(`${COS_PROXY_PREFIX}/`)
}

function isCosHost(value: URL) {
  const hostname = value.hostname.toLowerCase()
  return hostname === PUBLIC_COS_HOST
}

/** True when the browser should request the existing same-origin /cos proxy directly. */
export function isPublicMediaProxyUrl(value?: string | null) {
  const url = trimValue(value)
  return Boolean(url && isCosProxyPath(url))
}

/**
 * Convert only the known public COS host to the existing lightweight-server
 * proxy. Other URLs, local paths, data/blob URLs, and empty values are kept
 * unchanged (apart from the existing trim/null behavior).
 */
export function toPublicMediaUrl(value?: string | null) {
  const url = trimValue(value)
  if (!url || isPublicMediaProxyUrl(url)) return url

  try {
    const parsed = new URL(url)
    if (!isCosHost(parsed) || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return url

    const path = parsed.pathname || '/'
    const normalizedPath = path === COS_PROXY_PREFIX || path.startsWith(`${COS_PROXY_PREFIX}/`)
      ? path.slice(COS_PROXY_PREFIX.length) || '/'
      : path
    return `${COS_PROXY_PREFIX}${normalizedPath}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

/**
 * Convert a proxy URL back to the original COS URL before persisting input
 * received from a browser. This is intentionally limited to /cos/ paths so
 * arbitrary local and external URLs are never rewritten.
 */
export function toStoredMediaUrl(value?: string | null) {
  const url = trimValue(value)
  if (!url || !isPublicMediaProxyUrl(url)) return url

  try {
    const parsed = new URL(url, 'https://local.invalid')
    const path = parsed.pathname.slice(COS_PROXY_PREFIX.length) || '/'
    return `https://${PUBLIC_COS_HOST}${path}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}
