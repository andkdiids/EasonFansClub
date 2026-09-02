const STUDIO_THUMBNAIL_PATTERN = /^data:image\/(?:png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i
export const STUDIO_THUMBNAIL_MAX_BYTES = 240 * 1024

/**
 * Studio thumbnails are generated from the Pattern Grid, never from the
 * uploaded source image. Keep the optional local fallback small and limited
 * to raster formats that the existing share-card pipeline understands.
 */
export function parseStudioThumbnail(value: unknown) {
  if (typeof value !== 'string' || value.length < 32 || value.length > STUDIO_THUMBNAIL_MAX_BYTES * 2) return null
  const match = value.match(STUDIO_THUMBNAIL_PATTERN)
  if (!match) return null
  const encoded = match[1]
  if (!encoded || Math.ceil(encoded.length * 3 / 4) > STUDIO_THUMBNAIL_MAX_BYTES) return null
  return value
}
