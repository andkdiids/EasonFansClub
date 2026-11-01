import { createHash } from 'node:crypto'

const INSTAGRAM_POST_PATH = /^\/(p|reel|tv)\/([A-Za-z0-9_-]{1,191})\/?$/

export type ManualPostMediaKind = 'IMAGE' | 'VIDEO'

export function resolveManualSocialPostMediaType(
  hasCaption: boolean,
  mediaTypes: readonly ManualPostMediaKind[],
): 'TEXT' | 'IMAGE' | 'VIDEO' | 'CAROUSEL' | null {
  if (!hasCaption && mediaTypes.length === 0) return null
  if (mediaTypes.length === 0) return 'TEXT'
  if (mediaTypes.length === 1) return mediaTypes[0]
  return 'CAROUSEL'
}

export function canonicalizeInstagramSourceUrl(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) return { permalink: null, shortcode: null }
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(host)
      || url.username || url.password || (url.port && url.port !== '443')) {
      return { permalink: null, shortcode: null }
    }
    const match = INSTAGRAM_POST_PATH.exec(url.pathname)
    if (!match) return { permalink: null, shortcode: null }
    return {
      permalink: `https://www.instagram.com/${match[1]}/${match[2]}/`,
      shortcode: match[2],
    }
  } catch {
    return { permalink: null, shortcode: null }
  }
}

export function buildManualSocialPostExternalId(input: {
  permalink: string | null
  shortcode: string | null
  caption: string
  publishedAt: Date
  mediaType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'CAROUSEL'
  mediaSha256: string | null
}) {
  const stableSource = input.shortcode
    ? `instagram-shortcode:${input.shortcode}`
    : input.permalink
      ? `instagram-url:${input.permalink}`
      : `exact-content:${input.mediaType}:${input.publishedAt.toISOString()}:${input.caption.trim().normalize('NFC')}:${input.mediaSha256 || ''}`
  return `manual:${createHash('sha256').update(stableSource).digest('hex')}`
}

export function buildInstagramPostIdentityFilters(input: {
  externalId: string
  shortcode: string | null
  permalink: string | null
  authorUsername?: string
}) {
  const authorUsername = input.authorUsername?.trim().toLowerCase()
  return [
    { externalId: input.externalId },
    ...(input.shortcode ? [{ shortcode: input.shortcode, ...(authorUsername ? { authorUsername } : {}) }] : []),
    ...(input.permalink ? [{ permalink: input.permalink, ...(authorUsername ? { authorUsername } : {}) }] : []),
  ]
}
