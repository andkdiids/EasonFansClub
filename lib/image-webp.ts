import sharp, { type ResizeOptions } from 'sharp'

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
