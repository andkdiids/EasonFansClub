export const STICKER_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/apng',
  'image/webp',
  'image/gif',
] as const

export const STICKER_UPLOAD_EXTENSIONS = ['jpg', 'jpeg', 'png', 'apng', 'webp', 'gif'] as const

export const STICKER_UPLOAD_ACCEPT = [
  ...STICKER_UPLOAD_EXTENSIONS.map((extension) => `.${extension}`),
  ...STICKER_UPLOAD_MIME_TYPES,
].join(',')

/**
 * File.type is empty or application/octet-stream in some browsers and drag/drop paths.
 * The server still validates the actual bytes with Sharp; this is only the client-side
 * candidate filter used to keep supported image files selectable.
 */
export function isSupportedStickerFile(file: { name: string; type: string }): boolean {
  const mime = file.type.trim().toLowerCase()
  if ((STICKER_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) return true

  const extension = file.name.trim().toLowerCase().split('.').pop() || ''
  return (STICKER_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)
}
