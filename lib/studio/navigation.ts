export const STUDIO_GALLERY_RETURN_STORAGE_KEY = 'studio_gallery_return'

export function isStudioGalleryPath(value: string | null | undefined) {
  if (!value) return false
  try {
    return new URL(value, 'https://ecfc.fans').pathname === '/studio/gallery'
  } catch {
    return false
  }
}
