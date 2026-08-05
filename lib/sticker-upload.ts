import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { uploadSiteImage } from '@/lib/site-media-storage'

export type StickerUploadType = 'STATIC' | 'GIF'

export const STICKER_MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
export const STICKER_STATIC_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const STICKER_GIF_MIME_TYPE = 'image/gif'

export const STICKER_MAX_NAME_LENGTH = 4
export const STICKER_MAX_PACK_NAME_LENGTH = 40
export const STICKER_MAX_DESCRIPTION_LENGTH = 200

/**
 * 纯函数：判断某 MIME 是否允许作为指定类型的表情。
 * 静态表情仅接受 jpg / png / webp；GIF 仅接受 image/gif。
 * 用于把「创建时必须先选类型」「静态只能传静态、GIF 只能传动态」的规则落到上传校验。
 */
export function isStickerMimeAllowed(mime: string, type: StickerUploadType): boolean {
  const normalized = mime.toLowerCase()
  if (type === 'GIF') return normalized === STICKER_GIF_MIME_TYPE
  return (STICKER_STATIC_MIME_TYPES as readonly string[]).includes(normalized)
}

/** 校验并清洗表情名称（最多 4 字）。空值返回 null；超长抛错。 */
export function sanitizeStickerName(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (!str) return null
  if ([...str].length > STICKER_MAX_NAME_LENGTH) {
    throw new Error(`表情名称不能超过 ${STICKER_MAX_NAME_LENGTH} 个字`)
  }
  return str
}

const STICKER_STATIC_MAX_WIDTH = 400

/** 将静态表情转换为 WebP（保证只能是静态图，不保留动画）。 */
export async function convertStaticStickerToWebp(input: Buffer): Promise<Buffer> {
  const image = sharp(input, { failOn: 'none', limitInputPixels: 20_000_000 })
  const metadata = await image.metadata()
  if (!metadata.format || !STICKER_STATIC_MIME_TYPES.includes(metadata.format as never)) {
    throw new Error('图片内容格式无效')
  }
  return image
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: STICKER_STATIC_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()
}

/**
 * 上传单个表情图片。依据 type 做类型校验与存储：
 * - STATIC：转换为 WebP（静态），确保只能是静态文件。
 * - GIF：原样保留（不转码，Content-Type 设为 image/gif），确保动效能保留。
 * 返回公开可访问的 url。
 */
export async function uploadStickerImage(params: {
  ownerId: string
  type: StickerUploadType
  mime: string
  buffer: Buffer
}): Promise<{ url: string; format: 'webp' | 'gif' }> {
  const { ownerId, type, mime, buffer } = params
  if (!isStickerMimeAllowed(mime, type)) {
    throw new Error(type === 'GIF' ? '动态表情包只能上传 GIF 动图' : '静态表情包只能上传 JPG / PNG / WebP 静态图')
  }
  if (buffer.byteLength === 0) throw new Error('表情文件不能为空')
  if (buffer.byteLength > STICKER_MAX_FILE_SIZE) throw new Error('表情文件不能超过 5MB')

  if (type === 'GIF') {
    const objectPath = `stickers/${ownerId}/${randomUUID()}.gif`
    const url = await uploadSiteImage({ key: objectPath, body: buffer, contentType: 'image/gif' })
    return { url, format: 'gif' }
  }

  const output = await convertStaticStickerToWebp(buffer)
  const objectPath = `stickers/${ownerId}/${randomUUID()}.webp`
  const url = await uploadSiteImage({ key: objectPath, body: output })
  return { url, format: 'webp' }
}

/**
 * 上传表情包封面。封面始终为静态图（webp），与合集 type 无关。
 */
export async function uploadStickerPackCover(params: {
  ownerId: string
  mime: string
  buffer: Buffer
}): Promise<string> {
  const { ownerId, mime, buffer } = params
  if (!isStickerMimeAllowed(mime, 'STATIC')) throw new Error('封面只能是 JPG / PNG / WebP 静态图')
  if (buffer.byteLength === 0) throw new Error('封面文件不能为空')
  if (buffer.byteLength > STICKER_MAX_FILE_SIZE) throw new Error('封面文件不能超过 5MB')
  const output = await convertStaticStickerToWebp(buffer)
  const objectPath = `stickers/covers/${ownerId}/${randomUUID()}.webp`
  return uploadSiteImage({ key: objectPath, body: output })
}
