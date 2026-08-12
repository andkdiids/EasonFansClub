import sharp, { type Metadata, type ResizeOptions, type Sharp } from 'sharp'
import { IMAGE_VARIANT_WIDTHS, type ImageVariant } from '@/lib/image-variants'

/**
 * 允许作为「输入」解码的常见图片格式（由 sharp 真实解码后再校验，不信任浏览器 MIME）。
 * 输出统一为 WebP。
 */
export const WEBP_SOURCE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif'])

export class ImageNormalizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageNormalizeError'
  }
}

export type NormalizeImageOptions = {
  /** 最大宽度（像素），超过则等比缩放；不放大。 */
  maxWidth?: number
  /** 最大高度（像素），与 maxWidth 同时设置时取「包含于框内」的结果。 */
  maxHeight?: number
  /** WebP 质量 1-100，默认 82。 */
  quality?: number
  /** 是否裁剪为正方形（用于头像等固定比例场景）。 */
  square?: boolean
  /** square 为 true 时的边长，默认 512。 */
  squareSize?: number
}

export type CreateImageVariantsOptions = {
  sourceMaxWidth?: number
  sourceMaxHeight?: number
  sourceQuality?: number
  /** Optional background for workflows that intentionally flatten artwork. */
  flatten?: string
  variants?: readonly ImageVariant[]
}

export type CreatedImageVariants = {
  format: string
  source: Buffer
  variants: Partial<Record<ImageVariant, Buffer>>
}

const defaultImageVariants: readonly ImageVariant[] = ['avatar-sm', 'avatar-md', 'thumb-sm', 'thumb-md', 'card', 'large']

function hasAnimatedWebpChunks(input: Buffer) {
  if (input.length < 20 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WEBP') {
    return false
  }

  let offset = 12
  while (offset + 8 <= input.length) {
    const chunkType = input.toString('ascii', offset, offset + 4)
    const chunkSize = input.readUInt32LE(offset + 4)
    if (chunkType === 'ANIM' || chunkType === 'ANMF') return true
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return false
}

function hasAnimatedPngChunks(input: Buffer) {
  if (input.length < 33 || input.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') return false

  let offset = 8
  while (offset + 12 <= input.length) {
    const chunkSize = input.readUInt32BE(offset)
    const chunkType = input.toString('ascii', offset + 4, offset + 8)
    if (chunkType === 'acTL') return true
    offset += 12 + chunkSize
  }
  return false
}

function isAnimatedMetadata(metadata: Metadata, input?: Buffer) {
  if (metadata.format === 'gif' || (typeof metadata.pages === 'number' && metadata.pages > 1)) return true
  if (!input) return false
  if (metadata.format === 'webp') return hasAnimatedWebpChunks(input)
  if (metadata.format === 'png') return hasAnimatedPngChunks(input)
  return false
}

/** Detect animation from both Sharp metadata and container chunks. */
export function isAnimatedImageInput(input: Buffer, metadata: Metadata) {
  return isAnimatedMetadata(metadata, input)
}

async function renderStaticWebp(input: Sharp, width: number | undefined, quality: number, flatten?: string) {
  const resizeOptions: ResizeOptions = { withoutEnlargement: true }
  if (typeof width === 'number') resizeOptions.width = width
  let pipeline = input.clone().rotate().resize(resizeOptions)
  if (flatten) pipeline = pipeline.flatten({ background: flatten })
  return pipeline.webp({ quality, effort: 4 }).toBuffer()
}

async function renderAnimatedWebp(input: Sharp, width: number | undefined, quality: number) {
  const resizeOptions: ResizeOptions = { withoutEnlargement: true }
  if (typeof width === 'number') resizeOptions.width = width
  return input.clone().rotate().resize(resizeOptions).webp({ quality, effort: 4 }).toBuffer()
}

/**
 * Generate one source image and a finite set of WebP display variants.
 * Transparency is preserved because no flatten/composite operation is used.
 * Animated inputs are rejected here; animation-specific uploaders keep their
 * own frame-preserving pipeline instead of silently producing a static image.
 */
export async function createImageVariants(
  input: Buffer,
  options: CreateImageVariantsOptions = {},
): Promise<CreatedImageVariants> {
  const image = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 })
  const metadata = await image.metadata()
  if (!metadata.format || !WEBP_SOURCE_FORMATS.has(metadata.format)) {
    throw new ImageNormalizeError('图片格式无效，仅支持 JPG / PNG / WebP / AVIF 等静态图片格式')
  }
  if (isAnimatedMetadata(metadata, input)) {
    throw new ImageNormalizeError('动态图片必须使用保留动画的上传流程')
  }

  const sourceQuality = Math.max(1, Math.min(100, options.sourceQuality ?? 82))
  const sourceMaxWidth = options.sourceMaxWidth ?? 1920
  const sourceMaxHeight = options.sourceMaxHeight
  const variants = options.variants || defaultImageVariants
  const sourceResize: ResizeOptions = { withoutEnlargement: true }
  if (typeof sourceMaxWidth === 'number') sourceResize.width = sourceMaxWidth
  if (typeof sourceMaxHeight === 'number') sourceResize.height = sourceMaxHeight
  if (typeof sourceMaxWidth === 'number' && typeof sourceMaxHeight === 'number') sourceResize.fit = 'inside'

  let sourcePipeline = image.clone().rotate().resize(sourceResize)
  if (options.flatten) sourcePipeline = sourcePipeline.flatten({ background: options.flatten })
  const source = await sourcePipeline.webp({ quality: sourceQuality, effort: 4 }).toBuffer()
  const rendered = await Promise.all(variants.map(async (variant) => {
    const width = IMAGE_VARIANT_WIDTHS[variant]
    const quality = width <= 240 ? 78 : width >= 1920 ? 88 : 82
    return [variant, await renderStaticWebp(image, width, quality, options.flatten)] as const
  }))

  return {
    format: metadata.format,
    source,
    variants: Object.fromEntries(rendered) as Partial<Record<ImageVariant, Buffer>>,
  }
}

/**
 * Animated counterpart of createImageVariants. Sharp keeps all frames when
 * the input is opened with animated:true; every generated WebP therefore
 * remains animated instead of silently becoming a still frame.
 */
export async function createAnimatedImageVariants(
  input: Buffer,
  options: CreateImageVariantsOptions = {},
): Promise<CreatedImageVariants> {
  const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 100_000_000 })
  const metadata = await image.metadata()
  if (!metadata.format || !WEBP_SOURCE_FORMATS.has(metadata.format) || !isAnimatedMetadata(metadata, input)) {
    throw new ImageNormalizeError('鍔ㄦ€佸浘鐗囨牸寮忔棤鏁堬紝璇峰厛纭繚杈撳叆鍖呭惈澶氬抚')
  }

  const sourceQuality = Math.max(1, Math.min(100, options.sourceQuality ?? 82))
  const sourceWidth = options.sourceMaxWidth ?? 1920
  const variants = options.variants || defaultImageVariants
  const source = await renderAnimatedWebp(image, sourceWidth, sourceQuality)
  const rendered = await Promise.all(variants.map(async (variant) => {
    const width = IMAGE_VARIANT_WIDTHS[variant]
    const quality = width <= 240 ? 78 : width >= 1920 ? 88 : 82
    return [variant, await renderAnimatedWebp(image, width, quality)] as const
  }))

  return {
    format: metadata.format,
    source,
    variants: Object.fromEntries(rendered) as Partial<Record<ImageVariant, Buffer>>,
  }
}

/**
 * 将任意受支持图片 Buffer 归一化为 WebP：
 * - 先按真实格式白名单校验，格式非法抛出 ImageNormalizeError（调用方应映射为 400）；
 * - 依据 EXIF 方向自动旋转；
 * - 在 [maxWidth, maxHeight] 框内等比缩放（不放大），或裁剪为 squareSize 正方形；
 * - 输出 WebP 压缩 Buffer。
 *
 * 统一复用，避免各上传 API 各自实现 sharp 参数与白名单。
 */
export async function normalizeImageToWebp(
  input: Buffer,
  options: NormalizeImageOptions = {},
): Promise<Buffer> {
  const { maxWidth, maxHeight, quality = 82, square = false, squareSize = 512 } = options

  const image = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 })
  const metadata = await image.metadata()
  const format = metadata.format
  if (!format || !WEBP_SOURCE_FORMATS.has(format)) {
    throw new ImageNormalizeError('图片格式无效，仅支持 JPG / PNG / WebP / GIF 等常见图片格式')
  }

  let pipeline = image.rotate()
  if (square) {
    pipeline = pipeline.resize(squareSize, squareSize, { fit: 'cover' })
  } else {
    const resizeOptions: ResizeOptions = { withoutEnlargement: true }
    if (typeof maxWidth === 'number') resizeOptions.width = maxWidth
    if (typeof maxHeight === 'number') resizeOptions.height = maxHeight
    pipeline = pipeline.resize(resizeOptions)
  }

  return pipeline.webp({ quality }).toBuffer()
}
