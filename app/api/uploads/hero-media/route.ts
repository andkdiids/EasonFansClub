import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Metadata } from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { heroMediaTypes, normalizeHeroMediaType, type HeroMediaType } from '@/lib/hero-visuals'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'

// Keep this below Next's default request parser threshold; quality is protected
// by the high-quality transform and master upload, not by accepting oversized
// multipart bodies and hoping the proxy will pass them through.
const MAX_IMAGE_SIZE = 8 * 1024 * 1024
const MAX_VIDEO_SIZE = 8 * 1024 * 1024
const MAX_IMAGE_EDGE = 2560
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif'])
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/apng'])
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm'])

function isMp4(input: Buffer) {
  return input.length >= 12 && input.toString('ascii', 4, 8) === 'ftyp'
}

function isWebm(input: Buffer) {
  return input.length >= 4 && input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
}

function hasAnimatedWebp(input: Buffer) {
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

function hasAnimatedPng(input: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (input.length < signature.length || !input.subarray(0, signature.length).equals(signature)) return false
  let offset = signature.length
  while (offset + 12 <= input.length) {
    const size = input.readUInt32BE(offset)
    if (offset + 12 + size > input.length) return false
    if (input.toString('ascii', offset + 4, offset + 8) === 'acTL') return true
    offset += 12 + size
  }
  return false
}

function isAnimatedImage(metadata: Metadata, input: Buffer) {
  return metadata.format === 'gif'
    || (typeof metadata.pages === 'number' && metadata.pages > 1)
    || (metadata.format === 'webp' && hasAnimatedWebp(input))
    || (metadata.format === 'png' && hasAnimatedPng(input))
}

function extensionForImage(format: string) {
  if (format === 'jpeg') return 'jpg'
  if (format === 'png') return 'png'
  if (format === 'gif') return 'gif'
  return 'webp'
}

function imageContentType(format: string) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  return 'image/webp'
}

function mediaTypeFromImage(metadata: Metadata, input: Buffer): HeroMediaType {
  return isAnimatedImage(metadata, input) ? 'ANIMATED_IMAGE' : 'STATIC_IMAGE'
}

function expectedMediaType(value: FormDataEntryValue | null): HeroMediaType | null {
  if (typeof value !== 'string') return null
  if (value === 'IMAGE') return 'STATIC_IMAGE'
  return heroMediaTypes.includes(value as typeof heroMediaTypes[number]) ? normalizeHeroMediaType(value) : null
}

function safeScope(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return 'home'
  const scope = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)
  return scope || 'home'
}

async function decodeImage(input: Buffer) {
  try {
    return await sharp(input, { animated: true, failOn: 'none', limitInputPixels: 100_000_000 }).metadata()
  } catch {
    return null
  }
}

async function processStaticImage(input: Buffer, format: string) {
  const pipeline = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })

  if (format === 'jpeg') {
    return { body: await pipeline.jpeg({ quality: 94, progressive: true }).toBuffer(), extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (format === 'png') {
    return { body: await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer(), extension: 'png', contentType: 'image/png' }
  }
  if (format === 'webp') {
    return { body: await pipeline.webp({ quality: 94, effort: 4 }).toBuffer(), extension: 'webp', contentType: 'image/webp' }
  }
  return { body: input, extension: extensionForImage(format), contentType: imageContentType(format) }
}

function keepSafeOutput(input: Buffer, output: Buffer) {
  if (!output.length || output.length < input.length * 0.01) return input
  return output
}

function validateRequestedType(requested: HeroMediaType | null, detected: HeroMediaType) {
  if (!requested || requested === detected) return null
  // File content is authoritative for animated images so GIF and Animated
  // WebP cannot be persisted as a static image by mistake.
  if (detected === 'ANIMATED_IMAGE') return null
  if (requested === 'VIDEO') return '视频 Hero 请选择 MP4 或 WebM 文件'
  if (requested === 'ANIMATED_IMAGE') return '动态图片 Hero 请选择 GIF 或 Animated WebP 文件'
  return '静态图片 Hero 不支持动态图片或视频'
}

async function requireHeroMediaAdmin() {
  const siteConfigGuard = await requireAdmin('site_config_manage')
  if (siteConfigGuard.user) return siteConfigGuard
  const homeGuard = await requireAdmin('home_manage')
  return homeGuard.user ? homeGuard : siteConfigGuard
}

export async function POST(request: Request) {
  const guard = await requireHeroMediaAdmin()
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  const kind = formData?.get('kind') === 'poster' ? 'poster' : 'media'
  const requestedType = expectedMediaType(formData?.get('mediaType') ?? null)
  const scope = safeScope(formData?.get('scope') ?? null)

  if (!(file instanceof File)) return NextResponse.json({ message: '请选择 Hero 媒体文件' }, { status: 400 })
  const isVideoFile = file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name)
  const maxSize = isVideoFile ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
  if (file.size === 0 || file.size > maxSize) {
    return NextResponse.json({ message: 'Hero 媒体文件不能超过 8MB' }, { status: 400 })
  }

  try {
    const input = Buffer.from(await file.arrayBuffer())
    const imageMetadata = await decodeImage(input)
    let detectedType: HeroMediaType
    let output: Buffer
    let contentType: string
    let extension: string

    if (imageMetadata?.format && IMAGE_FORMATS.has(imageMetadata.format)) {
      const animated = isAnimatedImage(imageMetadata, input)
      if (kind === 'poster' && animated) {
        return NextResponse.json({ message: '视频封面必须使用静态 JPG、PNG 或 WebP 图片' }, { status: 400 })
      }
      detectedType = mediaTypeFromImage(imageMetadata, input)
      const typeError = kind === 'media' ? validateRequestedType(requestedType, detectedType) : null
      if (typeError) return NextResponse.json({ message: typeError }, { status: 400 })

      if (animated) {
        output = input
        extension = extensionForImage(imageMetadata.format)
        contentType = imageContentType(imageMetadata.format)
      } else {
        const processed = await processStaticImage(input, imageMetadata.format)
        output = keepSafeOutput(input, processed.body)
        extension = output === input ? extensionForImage(imageMetadata.format) : processed.extension
        contentType = output === input ? imageContentType(imageMetadata.format) : processed.contentType
        detectedType = 'STATIC_IMAGE'
      }
    } else if (isMp4(input) || isWebm(input)) {
      detectedType = 'VIDEO'
      const typeError = kind === 'media' ? validateRequestedType(requestedType, detectedType) : '视频封面不能使用视频文件'
      if (typeError) return NextResponse.json({ message: typeError }, { status: 400 })
      output = input
      extension = isMp4(input) ? 'mp4' : 'webm'
      contentType = isMp4(input) ? 'video/mp4' : 'video/webm'
    } else {
      const declaredType = typeof file.type === 'string' ? file.type.toLowerCase() : ''
      const message = IMAGE_MIME_TYPES.has(declaredType) || VIDEO_MIME_TYPES.has(declaredType)
        ? '文件内容无法识别，请重新导出后再上传'
        : '仅支持 JPG、PNG、WebP、GIF、MP4 或 WebM'
      return NextResponse.json({ message }, { status: 400 })
    }

    const objectId = randomUUID()
    const originalPath = `page-visuals/${scope}/original/${objectId}.${extension}`
    const optimizedPath = `page-visuals/${scope}/optimized/${objectId}.${extension}`
    const sourceUrl = publicImageUrl(await uploadSiteImage({ key: originalPath, body: input, contentType }))
    const url = publicImageUrl(await uploadSiteImage({ key: optimizedPath, body: output, contentType }))
    if (!url || !sourceUrl) return NextResponse.json({ message: 'Hero 媒体地址无效' }, { status: 500 })

    return NextResponse.json({
      url,
      sourceUrl,
      mediaType: kind === 'poster' ? 'STATIC_IMAGE' : detectedType,
      contentType,
      format: extension,
      originalSize: input.byteLength,
      size: output.byteLength,
      animated: kind === 'media' && detectedType === 'ANIMATED_IMAGE',
    })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[hero-media.upload]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Hero 媒体上传失败，请稍后重试' }, { status: 502 })
  }
}
