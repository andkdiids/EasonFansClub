import {
  imageOriginalObjectPath,
  imageVariantObjectPath,
  type ImageVariant,
} from '@/lib/image-variants'
import type { CreatedImageVariants } from '@/lib/image-webp'

type UploadImageObject = (params: {
  key: string
  body: Buffer
  contentType: string
}) => Promise<string>

/**
 * Persist one source image, its preserved original, and the requested fixed
 * display variants under one deterministic object-key family.
 *
 * The callback keeps this helper usable with the site, profile, and music
 * buckets without duplicating the key/cache policy in each upload route.
 */
export async function uploadImageVariantFamily(params: {
  sourceObjectPath: string
  original: Buffer
  originalContentType: string
  generated: CreatedImageVariants
  upload: UploadImageObject
}) {
  const sourceObjectPath = params.sourceObjectPath.replace(/^\/+/, '')
  const originalUrl = await params.upload({
    key: imageOriginalObjectPath(sourceObjectPath),
    body: params.original,
    contentType: params.originalContentType,
  })
  const sourceUrl = await params.upload({
    key: sourceObjectPath,
    body: params.generated.source,
    contentType: 'image/webp',
  })

  const variants = Object.entries(params.generated.variants) as Array<[ImageVariant, Buffer]>
  const variantUrls = await Promise.all(variants.map(async ([variant, body]) => [variant, await params.upload({
    key: imageVariantObjectPath(sourceObjectPath, variant),
    body,
    contentType: 'image/webp',
  })] as const))

  return {
    originalUrl,
    sourceUrl,
    variantUrls: Object.fromEntries(variantUrls) as Partial<Record<ImageVariant, string>>,
  }
}
