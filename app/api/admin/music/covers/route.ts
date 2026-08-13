import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { toPublicMediaUrl } from '@/lib/media-url'
import {
  convertMusicCoverToWebp,
  MUSIC_COVER_MAX_FILE_SIZE,
  MUSIC_COVER_MAX_WIDTH,
  MUSIC_COVER_QUALITY,
} from '@/lib/music-cover'
import { createImageVariants } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { MusicMediaStorageError, uploadMusicMedia } from '@/lib/music-media-storage'
import { isSupportedMusicCoverFile } from '@/lib/music-upload-constraints'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request: Request) {
  try {
    return await uploadCover(request)
  } catch (error) {
    console.error('[music-cover.unhandled]', error)
    return failure(500, 'UPLOAD_FAILED', '封面上传失败，请查看服务器日志后重试')
  }
}

async function uploadCover(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const formData = await request.formData().catch((error) => {
    console.error('[music-cover.form-data]', error)
    return null
  })
  if (!formData) return failure(400, 'INVALID_MULTIPART', '上传请求无效或文件超过服务器限制')

  const file = formData.get('file')
  const entityType = sanitizeText(formData.get('entityType'), 20)
  const entityId = sanitizeText(formData.get('entityId'), 100)
  if (!(file instanceof File)) return failure(400, 'FILE_REQUIRED', '请选择封面图片')
  if (!['album', 'song', 'tour', 'concert'].includes(entityType)) return failure(400, 'INVALID_TARGET', '封面目标类型无效')
  if (!entityId) return failure(400, 'INVALID_TARGET', '封面目标不存在')

  console.info('[music-cover.received]', {
    entityType,
    entityId,
    fileName: file.name,
    mimeType: file.type || 'unknown',
    fileSize: file.size,
  })
  if (!isSupportedMusicCoverFile(file)) return failure(400, 'INVALID_FILE_TYPE', '仅支持 JPG、JPEG、PNG、WebP')
  if (file.size === 0) return failure(400, 'EMPTY_FILE', '图片文件不能为空')
  if (file.size > MUSIC_COVER_MAX_FILE_SIZE) return failure(413, 'FILE_TOO_LARGE', '封面图片不能超过 10MB')

  const exists = entityType === 'album'
    ? await prisma.musicAlbum.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === 'song'
      ? await prisma.musicSong.findUnique({ where: { id: entityId }, select: { id: true } })
      : entityType === 'tour'
        ? await prisma.musicTour.findUnique({ where: { id: entityId }, select: { id: true } })
        : await prisma.musicConcert.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!exists) return failure(404, 'TARGET_NOT_FOUND', '封面目标不存在')

  let rawBuffer: Buffer
  let output: Buffer
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  const processingStartedAt = Date.now()
  try {
    rawBuffer = Buffer.from(await file.arrayBuffer())
    const rawMetadata = await sharp(rawBuffer, { failOn: 'none', limitInputPixels: 40_000_000 }).metadata()
    const preservesAlpha = rawMetadata.hasAlpha === true
    output = preservesAlpha ? rawBuffer : await convertMusicCoverToWebp(rawBuffer)
    generated = await createImageVariants(output, {
      sourceMaxWidth: MUSIC_COVER_MAX_WIDTH,
      sourceQuality: MUSIC_COVER_QUALITY,
      variants: ['thumb-sm', 'thumb-md', 'card', 'large'],
    })
    console.info('[music-cover.processed]', {
      entityType,
      entityId,
      outputSize: output.byteLength,
      preservesAlpha,
      variantSizes: Object.fromEntries(Object.entries(generated.variants).map(([key, body]) => [key, body.byteLength])),
      elapsedMs: Date.now() - processingStartedAt,
    })
  } catch (error) {
    console.error('[music-cover.sharp]', error)
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim().slice(0, 500)
      : 'Sharp 未返回具体错误'
    return failure(400, 'IMAGE_PROCESSING_FAILED', `图片转换失败：${detail}`)
  }

  const folder = entityType === 'album' ? 'albums' : entityType === 'song' ? 'songs' : entityType === 'tour' ? 'tours' : 'concerts'
  const objectPath = `music-cover/${folder}/${entityId}/source.webp`
  try {
    const uploadStartedAt = Date.now()
    const originalContentType = file.type === 'image/png'
      ? 'image/png'
      : file.type === 'image/webp'
        ? 'image/webp'
        : 'image/jpeg'
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: objectPath,
      original: rawBuffer,
      originalContentType,
      generated,
      upload: ({ key, body, contentType }) => uploadMusicMedia({ kind: 'cover', key, body, contentType: contentType as 'image/jpeg' | 'image/png' | 'image/webp' }),
    })
    const objectUrl = toPublicMediaUrl(uploadResult.sourceUrl) || uploadResult.sourceUrl
    console.info('[music-cover.cos-complete]', {
      entityType,
      entityId,
      objectPath,
      elapsedMs: Date.now() - uploadStartedAt,
    })
    const url = `${objectUrl}?v=${Date.now()}`
    if (entityType === 'album') await prisma.musicAlbum.update({ where: { id: entityId }, data: { coverUrl: url } })
    else if (entityType === 'song') await prisma.musicSong.update({ where: { id: entityId }, data: { coverUrl: url } })
    else if (entityType === 'tour') await prisma.musicTour.update({ where: { id: entityId }, data: { posterUrl: url } })
    else await prisma.musicConcert.update({ where: { id: entityId }, data: { posterUrl: url } })
    console.info('[music-cover.complete]', { entityType, entityId })
    return NextResponse.json({
      success: true,
      url: toPublicMediaUrl(url) || url,
      format: 'webp',
      widthLimit: MUSIC_COVER_MAX_WIDTH,
      quality: MUSIC_COVER_QUALITY,
    })
  } catch (error) {
    if (!(error instanceof MusicMediaStorageError)) console.error('[music-cover.save]', error)
    return failure(
      error instanceof MusicMediaStorageError ? 502 : 500,
      error instanceof MusicMediaStorageError ? 'COS_UPLOAD_FAILED' : 'DATABASE_ERROR',
      error instanceof Error ? error.message : '封面保存失败，请稍后重试',
    )
  }
}

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, error: message, message }, { status })
}
