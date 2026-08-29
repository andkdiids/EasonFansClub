import type { Metadata } from 'next'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { publicImageUrl } from '@/lib/images'
import { getMediaPublicBaseUrl } from '@/lib/media-url'
import { formatBeijingDateTimeDisplay } from '@/lib/registration-availability'
import { extractPlainText } from '@/lib/rich-text'

export const SITE_TITLE = '私家E院 | Eason Fans Club'
export const SITE_NAME = '私家E院 | Eason Fans Club'
export const SITE_DESCRIPTION = '陈奕迅中文粉丝社区'
/** Deployment asset contract: provide a non-transparent 1200x630 PNG here. */
export const DEFAULT_OG_IMAGE_PATH = '/images/og-default.png'
export const DEFAULT_OG_IMAGE_DIMENSIONS = { width: 1200, height: 630 } as const

const DEFAULT_SITE_ORIGIN = 'https://ecfc.fans'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const PUBLIC_HOSTS = new Set(['ecfc.fans', 'www.ecfc.fans'])
const VIDEO_FILE_PATTERN = /\.(?:3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogm|ogv|webm|wmv|m3u8)$/i

function metadataOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim()
  if (configured) {
    try {
      const parsed = new URL(configured)
      const hostname = parsed.hostname.toLowerCase()
      const isLocal = LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost')
      const isProduction = process.env.NODE_ENV === 'production'
      const isAllowedProductionHost = PUBLIC_HOSTS.has(hostname)
      if (parsed.protocol === 'https:' && !isLocal && (!isProduction || isAllowedProductionHost)) {
        return parsed.origin
      }
    } catch {
      // Fall through to the canonical production origin.
    }
  }
  return DEFAULT_SITE_ORIGIN
}

function normalizedText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    const normalizedName = name.toLowerCase()
    if (normalizedName.startsWith('#x')) {
      const codePoint = Number.parseInt(normalizedName.slice(2), 16)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
    }
    if (normalizedName.startsWith('#')) {
      const codePoint = Number.parseInt(normalizedName.slice(1), 10)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
    }
    return namedEntities[normalizedName] || entity
  })
}

/** Convert stored rich/HTML-ish content into crawler-safe plain text. */
export function htmlToPlainText(value: string | null | undefined) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/\[\[content-image:[^\]]+\]\]/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function summarizePlainText(value: string | null | undefined, length = 180) {
  const text = htmlToPlainText(value)
  if (text.length <= length) return text
  return `${text.slice(0, Math.max(1, length - 1)).trimEnd()}…`
}

/** Return one plain-text view for cards, search and crawler metadata. */
export function postContentPlainText(content: string | null | undefined, richContent?: unknown | null) {
  const richText = richContent === null || richContent === undefined ? '' : extractPlainText(richContent)
  return richText || htmlToPlainText(content)
}

/** Use the post title when present and the first meaningful body text otherwise. */
export function createPostShareTitle(title: string | null | undefined, content: string | null | undefined, richContent?: unknown | null) {
  return htmlToPlainText(title) || summarizePlainText(postContentPlainText(content, richContent), 80) || 'E院广场帖子'
}

export function createPostShareDescription(content: string | null | undefined, richContent?: unknown | null) {
  return summarizePlainText(postContentPlainText(content, richContent), 180) || '来自私家E院的帖子。'
}

function activityDate(value: string | Date | null | undefined) {
  return value ? formatBeijingDateTimeDisplay(value) : ''
}

export function createActivityShareDescription({
  startsAt,
  endsAt,
  locationName,
  locationAddress,
  description,
}: Readonly<{
  startsAt?: string | Date | null
  endsAt?: string | Date | null
  locationName?: string | null
  locationAddress?: string | null
  description?: string | null
}>) {
  const details: string[] = []
  const start = activityDate(startsAt)
  const end = activityDate(endsAt)
  if (start) details.push(`时间：${start}${end ? ` — ${end}` : ''}`)

  const location = [locationName, locationAddress]
    .map(normalizedText)
    .filter(Boolean)
    .join('，')
  if (location) details.push(`地点：${location}`)

  const intro = htmlToPlainText(description)
  if (intro) details.push(`简介：${intro}`)
  return summarizePlainText(details.join('；'), 180) || '查看私家E院活动详情。'
}

function canonicalUrl(path: string) {
  const origin = metadataOrigin()
  const safePath = path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`
  return new URL(safePath || '/', origin).toString()
}

function metadataMediaOrigin() {
  try {
    return new URL(getMediaPublicBaseUrl()).origin
  } catch {
    return null
  }
}

function resolveMetadataImageUrl(value: string | null | undefined) {
  const origin = metadataOrigin()
  const raw = normalizedText(value)
  if (!raw || raw.startsWith('//') || (!raw.startsWith('/') && !/^https?:\/\//i.test(raw))) return null

  try {
    const publicValue = publicImageUrl(raw)
    if (!publicValue) return null
    const parsed = new URL(publicValue, origin)
    if (parsed.protocol !== 'https:' || VIDEO_FILE_PATTERN.test(parsed.pathname)) return null

    const trustedOrigins = new Set([
      new URL(origin).origin,
      ...Array.from(PUBLIC_HOSTS, (hostname) => `https://${hostname}`),
      metadataMediaOrigin(),
    ].filter((item): item is string => Boolean(item)))
    // Only project-controlled HTTPS origins are known to be public and login-free.
    // An image-looking URL on an arbitrary host could still be private or signed.
    if (!trustedOrigins.has(parsed.origin)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** Convert a public image to a deterministic large variant without throwing. */
export function metadataImageVariantUrl(value: string | null | undefined) {
  try {
    return publicImageVariantUrl(value, 'large')
  } catch {
    return null
  }
}

/** Only HTTPS, non-video image URLs are allowed into crawler metadata. */
export function absoluteMetadataImageUrl(value: string | null | undefined) {
  return resolveMetadataImageUrl(value) || new URL(DEFAULT_OG_IMAGE_PATH, metadataOrigin()).toString()
}

export function firstAbsoluteMetadataImageUrl(values: readonly (string | null | undefined)[]) {
  for (const value of values) {
    const resolved = resolveMetadataImageUrl(value)
    if (resolved) return resolved
  }
  return new URL(DEFAULT_OG_IMAGE_PATH, metadataOrigin()).toString()
}

export type PageMetadataInput = Readonly<{
  title?: string | null
  description?: string | null
  canonical?: string
  imageUrl?: string | null
  noindex?: boolean
}>

/** Build one consistent metadata shape for every shareable page. */
export function buildPageMetadata({
  title,
  description,
  canonical = '/',
  imageUrl,
  noindex = false,
}: PageMetadataInput = {}): Metadata {
  const resolvedTitle = htmlToPlainText(title) || SITE_TITLE
  const resolvedDescription = htmlToPlainText(description) || SITE_DESCRIPTION
  const resolvedCanonical = canonicalUrl(canonical)
  const resolvedImage = absoluteMetadataImageUrl(imageUrl)
  return {
    metadataBase: new URL(metadataOrigin()),
    title: resolvedTitle,
    description: resolvedDescription,
    alternates: { canonical: resolvedCanonical },
    openGraph: {
      type: 'website',
      title: resolvedTitle,
      description: resolvedDescription,
      url: resolvedCanonical,
      siteName: SITE_NAME,
      images: [{ url: resolvedImage, alt: resolvedTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title: resolvedTitle,
      description: resolvedDescription,
      images: [resolvedImage],
    },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  }
}

export type PostMetadataInput = Readonly<{
  postId?: string
  canonical?: string
  title?: string | null
  content?: string | null
  richContent?: unknown | null
  imageUrl?: string | null
  isPublic?: boolean
}>

export function buildPostMetadata({
  postId,
  canonical,
  title,
  content,
  richContent,
  imageUrl,
  isPublic = true,
}: PostMetadataInput): Metadata {
  const path = canonical || `/posts/${encodeURIComponent(postId || '')}`
  if (!isPublic) return buildPageMetadata({ canonical: path, noindex: true })
  return buildPageMetadata({
    title: createPostShareTitle(title, content, richContent),
    description: createPostShareDescription(content, richContent),
    canonical: path,
    imageUrl,
  })
}

export type ActivityMetadataInput = Readonly<{
  activityId?: string
  canonical?: string
  title?: string | null
  description?: string | null
  startsAt?: string | Date | null
  endsAt?: string | Date | null
  locationName?: string | null
  locationAddress?: string | null
  imageUrl?: string | null
  isPublic?: boolean
}>

export function buildActivityMetadata({
  activityId,
  canonical,
  title,
  description,
  startsAt,
  endsAt,
  locationName,
  locationAddress,
  imageUrl,
  isPublic = true,
}: ActivityMetadataInput): Metadata {
  const path = canonical || `/activities/${encodeURIComponent(activityId || '')}`
  if (!isPublic) return buildPageMetadata({ canonical: path, noindex: true })
  return buildPageMetadata({
    title: normalizedText(title) || '私家E院活动',
    description: createActivityShareDescription({ startsAt, endsAt, locationName, locationAddress, description }),
    canonical: path,
    imageUrl,
  })
}
