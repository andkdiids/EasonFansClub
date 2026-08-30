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
type RemoveImageObject = (key: string) => Promise<void>

/**
 * Persist one source image, an optional preserved original, and the requested
 * fixed display variants under one deterministic object-key family.
 *
 * The callback keeps this helper usable with the site, profile, and music
 * buckets without duplicating the key/cache policy in each upload route.
 */
export async function uploadImageVariantFamily(params: {
  sourceObjectPath: string
  original: Buffer
  originalContentType: string
  /** Set false for categories whose source must only be used as a processor input. */
  preserveOriginal?: boolean
  generated: CreatedImageVariants
  upload: UploadImageObject
  remove?: RemoveImageObject
}) {
  const sourceObjectPath = params.sourceObjectPath.replace(/^\/+/, '')
  const uploadedKeys: string[] = []
  const upload = async (input: { key: string; body: Buffer; contentType: string }) => {
    const key = input.key.replace(/^\/+/, '')
    const url = await params.upload({ ...input, key })
    uploadedKeys.push(key)
    return url
  }
  try {
    const originalObjectKey = params.preserveOriginal === false ? null : imageOriginalObjectPath(sourceObjectPath)
    const originalUrl = originalObjectKey
      ? await upload({ key: originalObjectKey, body: params.original, contentType: params.originalContentType })
      : null
    const sourceUrl = await upload({ key: sourceObjectPath, body: params.generated.source, contentType: 'image/webp' })

    const variants = Object.entries(params.generated.variants) as Array<[ImageVariant, Buffer]>
    // Wait for every in-flight upload to settle before entering the catch
    // block. This makes cleanup complete even when one parallel variant fails
    // while another finishes a moment later.
    const variantResults = await Promise.allSettled(variants.map(async ([variant, body]) => [variant, await upload({
      key: imageVariantObjectPath(sourceObjectPath, variant),
      body,
      contentType: 'image/webp',
    })] as const))
    const failedVariant = variantResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failedVariant) throw failedVariant.reason
    const variantUrls = variantResults.map((result) => (result as PromiseFulfilledResult<readonly [ImageVariant, string]>).value)

    return {
      originalUrl,
      originalObjectKey,
      sourceUrl,
      sourceObjectKey: sourceObjectPath,
      variantUrls: Object.fromEntries(variantUrls) as Partial<Record<ImageVariant, string>>,
      variantObjectKeys: Object.fromEntries(variants.map(([variant]) => [variant, imageVariantObjectPath(sourceObjectPath, variant)])) as Partial<Record<ImageVariant, string>>,
    }
  } catch (error) {
    if (params.remove && uploadedKeys.length) {
      await Promise.allSettled(uploadedKeys.map((key) => params.remove!(key)))
    }
    throw error
  }
}
