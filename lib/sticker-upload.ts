import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { uploadSiteImage } from '@/lib/site-media-storage'
import {
  STICKER_FILE_TOO_LARGE_MESSAGE,
  STICKER_MAX_FILE_SIZE,
  STICKER_UNSUPPORTED_FORMAT_MESSAGE,
  STICKER_UPLOAD_FAILED_MESSAGE,
  STICKER_UPLOAD_MIME_TYPES,
} from '@/lib/sticker-upload-constraints'

export {
  STICKER_FILE_TOO_LARGE_MESSAGE,
  STICKER_MAX_FILE_SIZE,
  STICKER_UNSUPPORTED_FORMAT_MESSAGE,
  STICKER_UPLOAD_FAILED_MESSAGE,
} from '@/lib/sticker-upload-constraints'

export type StickerUploadType = 'STATIC' | 'GIF'

export const STICKER_STATIC_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/apng'] as const
export const STICKER_GIF_MIME_TYPE = 'image/gif'
export const STICKER_ANIMATED_MIME_TYPES = ['image/gif', 'image/webp', 'image/png', 'image/apng'] as const

const STATIC_STICKER_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif'])
const ANIMATED_STICKER_FORMATS = new Set(['gif', 'png', 'webp'])
const REJECTED_STICKER_FORMATS = new Set(['svg'])

export const STICKER_MAX_NAME_LENGTH = 4
export const STICKER_MAX_PACK_NAME_LENGTH = 40
export const STICKER_MAX_DESCRIPTION_LENGTH = 200

const STICKER_STATIC_MAX_WIDTH = 400
const STICKER_ANIMATED_MAX_FRAMES = 120
const STICKER_ANIMATED_TARGET_SIZE = 1 * 1024 * 1024
const STICKER_ANIMATED_MAX_SIZE = 2 * 1024 * 1024
const STICKER_ANIMATED_MIN_OUTPUT_RATIO = 0.01
const ANIMATED_STICKER_COMPRESSION_PROFILES = [
  { width: 320, quality: 80 },
  { width: 240, quality: 70 },
  { width: 200, quality: 60 },
] as const

export type StickerUploadErrorCode = 'FILE_TOO_LARGE' | 'UNSUPPORTED_FORMAT' | 'PROCESSING_FAILED' | 'SERVER_ERROR'

export class StickerUploadError extends Error {
  constructor(public readonly code: StickerUploadErrorCode, message: string) {
    super(message)
    this.name = 'StickerUploadError'
  }
}

export function getStickerUploadErrorResponse(error: unknown): {
  status: 400 | 413 | 500
  code: StickerUploadErrorCode
  message: string
} {
  if (error instanceof StickerUploadError) {
    return {
      status: error.code === 'FILE_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_FORMAT' ? 400 : 500,
      code: error.code,
      message: error.message,
    }
  }
  return { status: 500, code: 'SERVER_ERROR', message: STICKER_UPLOAD_FAILED_MESSAGE }
}

export function getStickerFormDataErrorResponse(error: unknown): {
  status: 413 | 500
  code: 'FILE_TOO_LARGE' | 'SERVER_ERROR'
  message: string
} {
  const detail = error instanceof Error ? error.message.toLowerCase() : ''
  const likelyTooLarge = /body.*(?:size|limit|exceed)|(?:payload|request|content).*(?:large|limit|exceed)|413|too large/.test(detail)
  return likelyTooLarge
    ? { status: 413, code: 'FILE_TOO_LARGE', message: STICKER_FILE_TOO_LARGE_MESSAGE }
    : { status: 500, code: 'SERVER_ERROR', message: STICKER_UPLOAD_FAILED_MESSAGE }
}

/** The type selector is only a UI hint; the server always checks the real bytes. */
export function isStickerMimeAllowed(mime: string, type: StickerUploadType): boolean {
  const normalized = mime.trim().toLowerCase()
  return (type === 'STATIC' || type === 'GIF') && (STICKER_UPLOAD_MIME_TYPES as readonly string[]).includes(normalized)
}

export function sanitizeStickerName(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (!str) return null
  if ([...str].length > STICKER_MAX_NAME_LENGTH) {
    throw new Error(`表情名称不能超过 ${STICKER_MAX_NAME_LENGTH} 个字`)
  }
  return str
}

async function decodeImageMetadata(input: Buffer) {
  try {
    const metadata = await sharp(input, {
      animated: true,
      failOn: 'none',
      limitInputPixels: 20_000_000,
    }).metadata()
    if (!metadata.format) throw new Error('missing image format')
    return metadata
  } catch {
    throw new StickerUploadError('UNSUPPORTED_FORMAT', STICKER_UNSUPPORTED_FORMAT_MESSAGE)
  }
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

type PngChunk = { type: string; data: Buffer }

type ApngFrameControl = {
  width: number
  height: number
  xOffset: number
  yOffset: number
  delay: number
  disposeOp: 0 | 1 | 2
  blendOp: 0 | 1
}

type ApngFrameParts = {
  control: ApngFrameControl
  data: Buffer[]
}

type DecodedApng = {
  width: number
  height: number
  frames: Buffer[]
  delays: number[]
  loop: number
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function parsePngChunks(input: Buffer): PngChunk[] {
  if (input.length < PNG_SIGNATURE.length || input.subarray(0, PNG_SIGNATURE.length).compare(PNG_SIGNATURE) !== 0) {
    throw new Error('invalid PNG signature')
  }

  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (chunkEnd > input.length) throw new Error('truncated PNG chunk')
    chunks.push({ type: input.toString('ascii', offset + 4, offset + 8), data: input.subarray(dataStart, dataEnd) })
    offset = chunkEnd
    if (chunks[chunks.length - 1].type === 'IEND') break
  }
  if (!chunks.some((chunk) => chunk.type === 'IEND')) throw new Error('missing PNG IEND')
  return chunks
}

function pngCrc32(type: string, data: Buffer): number {
  let crc = 0xffffffff
  const bytes = Buffer.concat([Buffer.from(type, 'ascii'), data])
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(pngCrc32(type, data), 8 + data.length)
  return chunk
}

function buildApngFramePng(ihdr: Buffer, sharedChunks: PngChunk[], frame: ApngFrameParts): Buffer {
  const frameIhdr = Buffer.from(ihdr)
  frameIhdr.writeUInt32BE(frame.control.width, 0)
  frameIhdr.writeUInt32BE(frame.control.height, 4)
  const chunks = [makePngChunk('IHDR', frameIhdr)]
  for (const chunk of sharedChunks) chunks.push(makePngChunk(chunk.type, chunk.data))
  const frameData = Buffer.concat(frame.data)
  if (!frameData.length) throw new Error('APNG frame has no image data')
  chunks.push(makePngChunk('IDAT', frameData), makePngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

function readApngFrameControl(data: Buffer, canvasWidth: number, canvasHeight: number): ApngFrameControl {
  if (data.length !== 26) throw new Error('invalid APNG frame control')
  const width = data.readUInt32BE(4)
  const height = data.readUInt32BE(8)
  const xOffset = data.readUInt32BE(12)
  const yOffset = data.readUInt32BE(16)
  const delayNumerator = data.readUInt16BE(20)
  const delayDenominator = data.readUInt16BE(22) || 1000
  const delay = Math.max(1, Math.min(65535, Math.round((delayNumerator * 1000) / delayDenominator)))
  const disposeOp = data[24]
  const blendOp = data[25]
  if (
    width === 0 ||
    height === 0 ||
    xOffset + width > canvasWidth ||
    yOffset + height > canvasHeight ||
    (disposeOp !== 0 && disposeOp !== 1 && disposeOp !== 2) ||
    (blendOp !== 0 && blendOp !== 1)
  ) {
    throw new Error('invalid APNG frame bounds')
  }
  return {
    width,
    height,
    xOffset,
    yOffset,
    delay,
    disposeOp: disposeOp as ApngFrameControl['disposeOp'],
    blendOp: blendOp as ApngFrameControl['blendOp'],
  }
}

function alphaComposite(source: Buffer, sourceOffset: number, target: Buffer, targetOffset: number): void {
  const sourceAlpha = source[sourceOffset + 3] / 255
  if (sourceAlpha <= 0) return
  if (sourceAlpha >= 1) {
    target[targetOffset] = source[sourceOffset]
    target[targetOffset + 1] = source[sourceOffset + 1]
    target[targetOffset + 2] = source[sourceOffset + 2]
    target[targetOffset + 3] = source[sourceOffset + 3]
    return
  }

  const targetAlpha = target[targetOffset + 3] / 255
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  if (outputAlpha <= 0) {
    target.fill(0, targetOffset, targetOffset + 4)
    return
  }
  const targetWeight = targetAlpha * (1 - sourceAlpha)
  target[targetOffset] = Math.round((source[sourceOffset] * sourceAlpha + target[targetOffset] * targetWeight) / outputAlpha)
  target[targetOffset + 1] = Math.round((source[sourceOffset + 1] * sourceAlpha + target[targetOffset + 1] * targetWeight) / outputAlpha)
  target[targetOffset + 2] = Math.round((source[sourceOffset + 2] * sourceAlpha + target[targetOffset + 2] * targetWeight) / outputAlpha)
  target[targetOffset + 3] = Math.round(outputAlpha * 255)
}

function clearApngFrame(canvas: Buffer, canvasWidth: number, control: ApngFrameControl): void {
  for (let y = 0; y < control.height; y += 1) {
    const start = ((control.yOffset + y) * canvasWidth + control.xOffset) * 4
    canvas.fill(0, start, start + control.width * 4)
  }
}

async function decodeApng(input: Buffer): Promise<DecodedApng> {
  const chunks = parsePngChunks(input)
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data
  const animationControl = chunks.find((chunk) => chunk.type === 'acTL')?.data
  if (!ihdr || ihdr.length !== 13 || !animationControl || animationControl.length !== 8) {
    throw new Error('invalid APNG structure')
  }

  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const loop = animationControl.readUInt32BE(4)
  const sharedChunks = chunks.filter((chunk) => !['IHDR', 'acTL', 'fcTL', 'IDAT', 'fdAT', 'IEND'].includes(chunk.type))
  const frameParts: ApngFrameParts[] = []
  let current: ApngFrameParts | null = null

  for (const chunk of chunks) {
    if (chunk.type === 'fcTL') {
      if (current?.data.length) frameParts.push(current)
      current = { control: readApngFrameControl(chunk.data, width, height), data: [] }
    } else if (chunk.type === 'IDAT') {
      if (!current) current = {
        control: { width, height, xOffset: 0, yOffset: 0, delay: 100, disposeOp: 0, blendOp: 0 },
        data: [],
      }
      current.data.push(chunk.data)
    } else if (chunk.type === 'fdAT') {
      if (!current || chunk.data.length < 4) throw new Error('invalid APNG frame data')
      current.data.push(chunk.data.subarray(4))
    }
  }
  if (current?.data.length) frameParts.push(current)
  if (frameParts.length < 2) throw new Error('APNG has fewer than two frames')

  const canvas = Buffer.alloc(width * height * 4)
  const frames: Buffer[] = []
  const delays: number[] = []
  for (const frame of frameParts) {
    const decoded = await sharp(buildApngFramePng(ihdr, sharedChunks, frame), {
      failOn: 'none',
      limitInputPixels: 20_000_000,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== frame.control.width || decoded.info.height !== frame.control.height) {
      throw new Error('APNG frame dimensions do not match control data')
    }

    const previousCanvas = frame.control.disposeOp === 2 ? Buffer.from(canvas) : null
    for (let y = 0; y < frame.control.height; y += 1) {
      for (let x = 0; x < frame.control.width; x += 1) {
        const sourceOffset = (y * frame.control.width + x) * 4
        const targetOffset = ((frame.control.yOffset + y) * width + frame.control.xOffset + x) * 4
        if (frame.control.blendOp === 0) {
          decoded.data.copy(canvas, targetOffset, sourceOffset, sourceOffset + 4)
        } else {
          alphaComposite(decoded.data, sourceOffset, canvas, targetOffset)
        }
      }
    }
    frames.push(Buffer.from(canvas))
    delays.push(frame.control.delay)
    if (frame.control.disposeOp === 1) clearApngFrame(canvas, width, frame.control)
    if (frame.control.disposeOp === 2 && previousCanvas) previousCanvas.copy(canvas)
  }

  return { width, height, frames, delays, loop }
}

async function encodeApngAsAnimatedWebp(
  animation: DecodedApng,
  profile: (typeof ANIMATED_STICKER_COMPRESSION_PROFILES)[number],
): Promise<Buffer> {
  const stackedFrames = Buffer.concat(animation.frames)
  return sharp(stackedFrames, {
    animated: true,
    pages: animation.frames.length,
    raw: {
      width: animation.width,
      height: animation.height * animation.frames.length,
      channels: 4,
      pageHeight: animation.height,
    },
  })
    .resize({ width: profile.width, height: profile.width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: profile.quality, effort: 4, delay: animation.delays, loop: animation.loop })
    .toBuffer()
}

function isAnimatedSticker(format: string, metadata: Awaited<ReturnType<typeof decodeImageMetadata>>, input: Buffer): boolean {
  if (format === 'gif') return true
  if (typeof metadata.pages === 'number' && metadata.pages > 1) return true
  if (format === 'webp') return hasAnimatedWebp(input)
  if (format === 'png') return hasApngAnimation(input)
  return false
}

export async function convertStaticStickerToWebp(input: Buffer, options?: { flatten?: boolean }): Promise<Buffer> {
  const format = await decodeImageFormat(input)
  if (REJECTED_STICKER_FORMATS.has(format) || !STATIC_STICKER_FORMATS.has(format)) {
    throw new StickerUploadError('UNSUPPORTED_FORMAT', STICKER_UNSUPPORTED_FORMAT_MESSAGE)
  }

  try {
    let pipeline = sharp(input, { failOn: 'none', limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width: STICKER_STATIC_MAX_WIDTH, withoutEnlargement: true })
    if (options?.flatten) pipeline = pipeline.flatten({ background: '#ffffff' })
    return await pipeline.webp({ quality: 85 }).toBuffer()
  } catch {
    throw new StickerUploadError('PROCESSING_FAILED', STICKER_UPLOAD_FAILED_MESSAGE)
  }
}

function requiresAnimatedOutput(metadata: Awaited<ReturnType<typeof decodeImageMetadata>>, format: string, input: Buffer): boolean {
  if (format === 'gif') return true
  return (typeof metadata.pages === 'number' && metadata.pages > 1)
    || hasAnimatedWebp(input)
    || hasApngAnimation(input)
}

async function assertAnimatedWebp(output: Buffer, required: boolean): Promise<void> {
  if (!required) return
  try {
    const metadata = await sharp(output, { animated: true, failOn: 'none', limitInputPixels: 20_000_000 }).metadata()
    const animated = (typeof metadata.pages === 'number' && metadata.pages > 1) || hasAnimatedWebp(output)
    if (!animated) throw new Error('animated output was not produced')
  } catch {
    throw new StickerUploadError('PROCESSING_FAILED', STICKER_UPLOAD_FAILED_MESSAGE)
  }
}

export async function compressAnimatedStickerToWebp(
  input: Buffer,
  metadata: Awaited<ReturnType<typeof decodeImageMetadata>>,
  format: string,
): Promise<Buffer> {
  const requiredAnimation = requiresAnimatedOutput(metadata, format, input)
  let lastOutput: Buffer | null = null

  try {
    const apngAnimation = format === 'png' && hasApngAnimation(input) ? await decodeApng(input) : null
    for (const profile of ANIMATED_STICKER_COMPRESSION_PROFILES) {
      const output = apngAnimation
        ? await encodeApngAsAnimatedWebp(apngAnimation, profile)
        : await sharp(input, { animated: true, failOn: 'none', limitInputPixels: 20_000_000 })
          .resize({
            width: profile.width,
            height: profile.width,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: profile.quality, effort: 4 })
          .toBuffer()

      await assertAnimatedWebp(output, requiredAnimation)
      if (output.byteLength < input.byteLength * STICKER_ANIMATED_MIN_OUTPUT_RATIO) {
        console.warn('[sticker-upload] animated output is below 1% of the source; preserving the source to avoid an abnormal result', {
          inputBytes: input.byteLength,
          outputBytes: output.byteLength,
          profile,
        })
        return lastOutput || input
      }

      lastOutput = output
      if (output.byteLength <= STICKER_ANIMATED_TARGET_SIZE) return output
      if (output.byteLength <= STICKER_ANIMATED_MAX_SIZE && profile.width !== 320) return output
    }
  } catch (error) {
    if (error instanceof StickerUploadError) throw error
    throw new StickerUploadError('PROCESSING_FAILED', STICKER_UPLOAD_FAILED_MESSAGE)
  }

  if (!lastOutput) throw new StickerUploadError('PROCESSING_FAILED', STICKER_UPLOAD_FAILED_MESSAGE)
  return lastOutput
}

export async function uploadStickerImage(params: {
  ownerId: string
  type: StickerUploadType
  buffer: Buffer
}): Promise<{ url: string; format: 'webp' | 'gif' | 'png'; type: StickerUploadType; isAnimated: boolean }> {
  const { ownerId, buffer } = params
  if (buffer.byteLength === 0) throw new StickerUploadError('UNSUPPORTED_FORMAT', STICKER_UNSUPPORTED_FORMAT_MESSAGE)
  if (buffer.byteLength > STICKER_MAX_FILE_SIZE) throw new StickerUploadError('FILE_TOO_LARGE', STICKER_FILE_TOO_LARGE_MESSAGE)

  const metadata = await decodeImageMetadata(buffer)
  const format = metadata.format as string
  if (REJECTED_STICKER_FORMATS.has(format)) {
    throw new StickerUploadError('UNSUPPORTED_FORMAT', STICKER_UNSUPPORTED_FORMAT_MESSAGE)
  }

  const animated = isAnimatedSticker(format, metadata, buffer)
  if (animated) {
    if (!ANIMATED_STICKER_FORMATS.has(format)) {
      throw new StickerUploadError('UNSUPPORTED_FORMAT', STICKER_UNSUPPORTED_FORMAT_MESSAGE)
    }
    if (typeof metadata.pages === 'number' && metadata.pages > STICKER_ANIMATED_MAX_FRAMES) {
      throw new StickerUploadError('PROCESSING_FAILED', `动态表情帧数不能超过 ${STICKER_ANIMATED_MAX_FRAMES} 帧`)
    }
    const output = await compressAnimatedStickerToWebp(buffer, metadata, format)
    const outputIsAnimatedWebp = hasAnimatedWebp(output)
    const sourceFormat = format === 'gif' ? 'gif' : format === 'png' ? 'png' : 'webp'
    const outputFormat: 'webp' | 'gif' | 'png' = outputIsAnimatedWebp ? 'webp' : sourceFormat
    const outputBody = outputFormat === 'webp' ? output : buffer
    const contentType = outputFormat === 'gif' ? 'image/gif' : outputFormat === 'png' ? 'image/png' : 'image/webp'
    const objectPath = `stickers/${ownerId}/${randomUUID()}.${outputFormat}`
    const url = await uploadSiteImage({ key: objectPath, body: outputBody, contentType })
    return { url, format: outputFormat, type: 'GIF', isAnimated: true }
  }

  const output = await convertStaticStickerToWebp(buffer)
  const objectPath = `stickers/${ownerId}/${randomUUID()}.webp`
  const url = await uploadSiteImage({ key: objectPath, body: output })
  return { url, format: 'webp', type: 'STATIC', isAnimated: false }
}

export async function uploadStickerPackCover(params: {
  ownerId: string
  buffer: Buffer
}): Promise<string> {
  const { ownerId, buffer } = params
  if (buffer.byteLength === 0) throw new StickerUploadError('UNSUPPORTED_FORMAT', STICKER_UNSUPPORTED_FORMAT_MESSAGE)
  if (buffer.byteLength > STICKER_MAX_FILE_SIZE) throw new StickerUploadError('FILE_TOO_LARGE', STICKER_FILE_TOO_LARGE_MESSAGE)
  const output = await convertStaticStickerToWebp(buffer, { flatten: true })
  const objectPath = `stickers/covers/${ownerId}/${randomUUID()}.webp`
  return uploadSiteImage({ key: objectPath, body: output })
}
