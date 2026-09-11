import { formatUid } from '@/lib/uid'

export const BEETHOVEN_ARTIST_ID = 'beethoven'
export const BEETHOVEN_ARTIST_SLUG = 'beethoven'

export function normalizeArtistSlug(value: unknown) {
  const slug = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null
}

export function artistPath(slug: string) {
  return `/artists/${encodeURIComponent(slug)}`
}

/** Public works authored by a user; intentionally separate from source Artist records. */
export function creatorPath(uid: number | string) {
  return `/artist/${encodeURIComponent(formatUid(uid))}`
}
