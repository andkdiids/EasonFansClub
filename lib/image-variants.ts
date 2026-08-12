import { publicImageUrl } from '@/lib/images'

/**
 * Fixed image sizes used by the public UI.  New uploads may generate this
 * finite set; callers must not invent arbitrary query-string dimensions.
 */
export const IMAGE_VARIANT_WIDTHS = {
  'avatar-sm': 64,
  'avatar-md': 128,
  'thumb-sm': 240,
  'thumb-md': 480,
  card: 640,
  large: 1280,
  hero: 1920,
} as const

export type ImageVariant = keyof typeof IMAGE_VARIANT_WIDTHS

const SOURCE_FILE_PATTERN = /^(.*)\/source\.[a-z0-9]+$/i

function splitSourcePath(value?: string | null) {
  const publicUrl = publicImageUrl(value)
  if (!publicUrl || !publicUrl.startsWith('/cos/')) return null

  const parsed = new URL(publicUrl, 'https://ecfc.fans')
  const pathWithoutProxy = parsed.pathname.replace(/^\/cos(?=\/|$)/i, '') || '/'
  const match = pathWithoutProxy.match(SOURCE_FILE_PATTERN)
  if (!match) return null
  return { parsed, directory: match[1] }
}

/**
 * Resolve a deterministic variant URL only for the new `.../source.webp`
 * object layout. Existing URLs intentionally return null so old data falls
 * back directly to its original object without a chain of 404 requests.
 */
export function toImageVariantUrl(value: string | null | undefined, variant: ImageVariant) {
  const source = splitSourcePath(value)
  if (!source) return null
  return `/cos${source.directory}/${variant}.webp${source.parsed.search}${source.parsed.hash}`
}

export function publicImageVariantUrl(value: string | null | undefined, variant: ImageVariant) {
  return toImageVariantUrl(publicImageUrl(value), variant) || publicImageUrl(value)
}

/**
 * Resolve the responsive Hero family. Hero uploads have a dedicated
 * `hero.webp` entry point rather than exposing their source URL to the UI;
 * legacy URLs remain unchanged so old records do not cause speculative 404s.
 */
export function publicHeroVariantUrl(value: string | null | undefined, variant: ImageVariant) {
  const publicUrl = publicImageUrl(value)
  if (!publicUrl) return null
  if (!publicUrl.startsWith('/cos/')) return publicUrl
  const parsed = new URL(publicUrl, 'https://ecfc.fans')
  const pathWithoutProxy = parsed.pathname.replace(/^\/cos(?=\/|$)/i, '') || '/'
  if (!pathWithoutProxy.endsWith('/hero.webp')) return toImageVariantUrl(publicUrl, variant) || publicUrl
  return `/cos${pathWithoutProxy.slice(0, -'/hero.webp'.length)}/${variant}.webp${parsed.search}${parsed.hash}`
}

/** Resolve the preserved original object for a new source URL. */
export function toImageOriginalUrl(value: string | null | undefined) {
  const source = splitSourcePath(value)
  if (!source) return null
  return `/cos${source.directory}/original${source.parsed.search}${source.parsed.hash}`
}

export function publicImageOriginalUrl(value: string | null | undefined) {
  return toImageOriginalUrl(publicImageUrl(value)) || publicImageUrl(value)
}

export function isImageVariantSourceUrl(value: string | null | undefined) {
  return Boolean(splitSourcePath(value))
}

/** Build the COS object key used by the upload pipeline. */
export function imageVariantObjectPath(sourceObjectPath: string, variant: ImageVariant) {
  const normalized = sourceObjectPath.replace(/^\/+/, '')
  if (!/\/source\.[a-z0-9]+$/i.test(normalized)) throw new Error('图片 source 对象路径无效')
  return normalized.replace(/\/source\.[a-z0-9]+$/i, `/${variant}.webp`)
}

export function imageOriginalObjectPath(sourceObjectPath: string) {
  const normalized = sourceObjectPath.replace(/^\/+/, '')
  if (!/\/source\.[a-z0-9]+$/i.test(normalized)) throw new Error('图片 source 对象路径无效')
  return normalized.replace(/\/source\.[a-z0-9]+$/i, '/original')
}

export function imageVariantObjectPaths(sourceObjectPath: string, variants: readonly ImageVariant[]) {
  return variants.map((variant) => imageVariantObjectPath(sourceObjectPath, variant))
}
