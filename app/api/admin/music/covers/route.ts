import { NextResponse } from 'next/server'
import {
  convertMusicCoverToWebp,
  MUSIC_COVER_MAX_FILE_SIZE,
  MUSIC_COVER_MAX_WIDTH,
  MUSIC_COVER_QUALITY,
  MUSIC_COVER_TYPES,
} from '@/lib/music-cover'
import { MusicMediaStorageError, uploadMusicMedia } from '@/lib/music-media-storage'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const formData = await request.formData().catch((error) => {
    console.error('[music-cover.form-data]', error)
    return null
  })
  if (!formData) {
    return NextResponse.json(
      { success: false, code: 'INVALID_MULTIPART', message: '上传请求无效或文件超过服务器限制' },
      { status: 400 },
    )
  }

  const file = formData.get('file')
  const entityType = sanitizeText(formData.get('entityType'), 20)
  const entityId = sanitizeText(formData.get('entityId'), 100)
  if (!(file instanceof File)) return failure(400, 'FILE_REQUIRED', '请选择封面图片')
  if (!['album', 'song', 'tour', 'concert'].includes(entityType)) return failure(400, 'INVALID_TARGET', '封面目标类型无效')
  if (!entityId) return failure(400, 'INVALID_TARGET', '封面目标不存在')
  if (!MUSIC_COVER_TYPES.has(file.type)) return failure(400, 'INVALID_FILE_TYPE', '仅支持 JPG、JPEG、PNG、WebP')
  if (file.size > MUSIC_COVER_MAX_FILE_SIZE) return failure(413, 'FILE_TOO_LARGE', '封面图片不能超过 10MB')

  const exists = entityType === 'album'
    ? await prisma.musicAlbum.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === 'song'
      ? await prisma.musicSong.findUnique({ where: { id: entityId }, select: { id: true } })
      : entityType === 'tour'
        ? await prisma.musicTour.findUnique({ where: { id: entityId }, select: { id: true } })
        : await prisma.musicConcert.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!exists) return failure(404, 'TARGET_NOT_FOUND', '封面目标不存在')

  let output: Buffer
  try {
    output = await convertMusicCoverToWebp(Buffer.from(await file.arrayBuffer()))
  } catch {
    return failure(400, 'IMAGE_PROCESSING_FAILED', '图片处理失败，请确认文件没有损坏')
  }

  const folder = entityType === 'album' ? 'albums' : entityType === 'song' ? 'songs' : entityType === 'tour' ? 'tours' : 'concerts'
  const objectPath = `music-cover/${folder}/${entityId}/cover.webp`
  try {
    const objectUrl = await uploadMusicMedia({ kind: 'cover', key: objectPath, body: output, contentType: 'image/webp' })
    const url = `${objectUrl}?v=${Date.now()}`
    if (entityType === 'album') await prisma.musicAlbum.update({ where: { id: entityId }, data: { coverUrl: url } })
    else if (entityType === 'song') await prisma.musicSong.update({ where: { id: entityId }, data: { coverUrl: url } })
    else if (entityType === 'tour') await prisma.musicTour.update({ where: { id: entityId }, data: { posterUrl: url } })
    else await prisma.musicConcert.update({ where: { id: entityId }, data: { posterUrl: url } })
    return NextResponse.json({
      success: true,
      url,
      format: 'webp',
      widthLimit: MUSIC_COVER_MAX_WIDTH,
      quality: MUSIC_COVER_QUALITY,
    })
  } catch (error) {
    if (!(error instanceof MusicMediaStorageError)) console.error('[music-cover.upload]', error)
    return failure(
      error instanceof MusicMediaStorageError ? 502 : 500,
      error instanceof MusicMediaStorageError ? 'COS_UPLOAD_FAILED' : 'DATABASE_ERROR',
      error instanceof Error ? error.message : '封面保存失败，请稍后重试',
    )
  }
}

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, message }, { status })
}
