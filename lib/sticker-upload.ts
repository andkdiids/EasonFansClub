import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { uploadSiteImage } from '@/lib/site-media-storage'

export type StickerUploadType = 'STATIC' | 'GIF'

export const STICKER_MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
export const STICKER_STATIC_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/apng'] as const
export const STICKER_GIF_MIME_TYPE = 'image/gif'
export const STICKER_ANIMATED_MIME_TYPES = ['image/gif', 'image/webp', 'image/png', 'image/apng'] as const

/**
 * sharp.metadata() 返回的是「真实文件格式标识」（如 'jpeg' / 'png' / 'webp'），
 * 不是 MIME（'image/jpeg'）。下列白名单基于真实格式，避免被浏览器伪造的 MIME 欺骗。
 */
const STATIC_STICKER_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif'])
const ANIMATED_STICKER_FORMATS = new Set(['gif', 'png', 'webp'])
const REJECTED_STICKER_FORMATS = new Set(['svg'])

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
  if (type === 'GIF') return (STICKER_ANIMATED_MIME_TYPES as readonly string[]).includes(normalized)
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
const STICKER_GIF_MAX_FRAMES = 120

/**
 * 用 sharp 解码真实图片格式，返回归一化格式标识。
 * 无法解码（文件损坏 / 非图片）时抛错。所有上传校验统一走这里，不信任浏览器 MIME。
 */
async function decodeImageMetadata(input: Buffer) {
  const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 20_000_000 })
  const metadata = await image.metadata()
  if (!metadata.format) throw new Error('图片损坏或格式无法识别')
  return metadata
}

async function decodeImageFormat(input: Buffer): Promise<string> {
  return (await decodeImageMetadata(input)).format as string
}

function hasApngAnimation(input: Buffer): boolean {
  if (input.length < 8 || input.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return false
  let offset = 8
  while (offset + 12 <= input.length) {
    const size = input.readUInt32BE(offset)
    if (offset + 12 + size > input.length) return false
    const chunkType = input.toString('ascii', offset + 4, offset + 8)
    if (chunkType === 'acTL') return true
    offset += 12 + size
  }
  return false
}

function hasAnimatedWebp(input: Buffer): boolean {
  if (input.length < 16 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WEBP') return false
  let offset = 12
  while (offset + 8 <= input.length) {
    const size = input.readUInt32LE(offset + 4)
    if (offset + 8 + size > input.length) return false
    const chunkType = input.toString('ascii', offset, offset + 4)
    if (chunkType === 'ANIM' || chunkType === 'ANMF') return true
    offset += 8 + size + (size % 2)
  }
  return false
}

function isAnimatedSticker(format: string, metadata: Awaited<ReturnType<typeof decodeImageMetadata>>, input: Buffer): boolean {
  if (format === 'gif') return true
  if (typeof metadata.pages === 'number' && metadata.pages > 1) return true
  if (format === 'webp') return hasAnimatedWebp(input)
  if (format === 'png') return hasApngAnimation(input)
  return false
}

/** 将静态表情转换为 WebP。默认保留透明背景；封面可传 flatten 铺白底。 */
export async function convertStaticStickerToWebp(input: Buffer, options?: { flatten?: boolean }): Promise<Buffer> {
  const format = await decodeImageFormat(input)
  if (REJECTED_STICKER_FORMATS.has(format)) {
    throw new Error(format === 'svg' ? '不支持 SVG 格式' : '不支持的图片格式')
  }
  if (!STATIC_STICKER_FORMATS.has(format)) {
    throw new Error('图片格式错误，仅支持 JPG / PNG / WebP / AVIF 静态图')
  }
  const image = sharp(input, { failOn: 'none', limitInputPixels: 20_000_000 })
  let pipeline = image.rotate().resize({ width: STICKER_STATIC_MAX_WIDTH, withoutEnlargement: true })
  if (options?.flatten) pipeline = pipeline.flatten({ background: '#ffffff' })
  return pipeline.webp({ quality: 85 }).toBuffer()
}

/**
 * 上传单个表情图片。依据 type 做类型校验与存储：
 * - STATIC：转换为 WebP（静态），确保只能是静态文件。
 * - GIF：原样保留（不转码，Content-Type 设为 image/gif），确保动效能保留。
 * 校验基于 sharp 解码的真实格式，不信任浏览器上报的 MIME。
 * 返回公开可访问的 url。
 */
export async function uploadStickerImage(params: {
  ownerId: string
  type: StickerUploadType
  buffer: Buffer
}): Promise<{ url: string; format: 'webp' | 'gif' | 'png'; type: StickerUploadType; isAnimated: boolean }> {
  const { ownerId, buffer } = params
  if (buffer.byteLength === 0) throw new Error('表情文件不能为空')
  if (buffer.byteLength > STICKER_MAX_FILE_SIZE) throw new Error('表情文件不能超过 5MB')

  const metadata = await decodeImageMetadata(buffer)
  const format = metadata.format as string
  if (REJECTED_STICKER_FORMATS.has(format)) {
    throw new Error(format === 'svg' ? '不支持 SVG 格式' : '不支持的图片格式')
  }

  const animated = isAnimatedSticker(format, metadata, buffer)

  if (animated) {
    if (!ANIMATED_STICKER_FORMATS.has(format)) {
      throw new Error('动态表情仅支持 GIF、Animated WebP 或 APNG 动图')
    }
    if (typeof metadata.pages === 'number' && metadata.pages > STICKER_GIF_MAX_FRAMES) {
      throw new Error(`动态表情帧数不能超过 ${STICKER_GIF_MAX_FRAMES} 帧`)
    }
    const storageFormat = format === 'gif' ? 'gif' : format === 'webp' ? 'webp' : 'png'
    const contentType = storageFormat === 'gif' ? 'image/gif' : storageFormat === 'webp' ? 'image/webp' : 'image/png'
    const objectPath = `stickers/${ownerId}/${randomUUID()}.${storageFormat}`
    const url = await uploadSiteImage({ key: objectPath, body: buffer, contentType })
    return { url, format: storageFormat, type: 'GIF', isAnimated: true }
  }

  const output = await convertStaticStickerToWebp(buffer)
  const objectPath = `stickers/${ownerId}/${randomUUID()}.webp`
  const url = await uploadSiteImage({ key: objectPath, body: output })
  return { url, format: 'webp', type: 'STATIC', isAnimated: false }
}

/**
 * 上传表情包封面。封面始终为静态图（webp），与合集 type 无关。
 * 校验同样基于 sharp 解码的真实格式，不信任浏览器上报的 MIME。
 */
export async function uploadStickerPackCover(params: {
  ownerId: string
  buffer: Buffer
}): Promise<string> {
  const { ownerId, buffer } = params
  if (buffer.byteLength === 0) throw new Error('封面文件不能为空')
  if (buffer.byteLength > STICKER_MAX_FILE_SIZE) throw new Error('封面文件不能超过 5MB')
  const output = await convertStaticStickerToWebp(buffer, { flatten: true })
  const objectPath = `stickers/covers/${ownerId}/${randomUUID()}.webp`
  return uploadSiteImage({ key: objectPath, body: output })
}
