const INTERNAL_ORIGIN = 'https://ecfc.internal'

/**
 * Only accept an internal path as a post return target. The value is carried
 * in a query string, so rejecting external URLs and control characters here
 * keeps every caller on the same site and preserves the original query/filter.
 */
export function normalizePostReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//') || /[\u0000-\u001f\u007f]/u.test(trimmed)) return null

  try {
    const url = new URL(trimmed, INTERNAL_ORIGIN)
    if (url.origin !== INTERNAL_ORIGIN) return null
    if (url.pathname.startsWith('/api/') || url.pathname === '/login' || url.pathname.startsWith('/posts/')) return null
    return `${url.pathname}${url.search}${url.hash}` || '/'
  } catch {
    return null
  }
}

export function postDetailHref(postId: string, returnTo?: string | null) {
  const path = `/posts/${encodeURIComponent(postId)}`
  const normalized = normalizePostReturnTo(returnTo)
  return normalized ? `${path}?${new URLSearchParams({ returnTo: normalized }).toString()}` : path
}

export function postEditHref(postId: string, returnTo?: string | null) {
  const path = `/posts/${encodeURIComponent(postId)}/edit`
  const normalized = normalizePostReturnTo(returnTo)
  return normalized ? `${path}?${new URLSearchParams({ returnTo: normalized }).toString()}` : path
}

export function postBoardFallbackHref(boardSlug?: string | null) {
  const normalized = typeof boardSlug === 'string' ? boardSlug.trim() : ''
  return normalized ? `/forum?board=${encodeURIComponent(normalized)}` : '/forum'
}

/** Return target used by both desktop and mobile post-detail back controls. */
export function postBackHref(returnTo?: string | null, boardSlug?: string | null) {
  return normalizePostReturnTo(returnTo) || postBoardFallbackHref(boardSlug)
}
