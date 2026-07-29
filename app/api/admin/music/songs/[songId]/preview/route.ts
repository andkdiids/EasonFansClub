import path from 'node:path'
import { NextResponse } from 'next/server'
import { MusicMediaStorageError, uploadMusicMedia } from '@/lib/music-media-storage'
import {
  createMusicPreview,
  MUSIC_AUDIO_MAX_FILE_SIZE,
  MUSIC_AUDIO_TYPES,
  MUSIC_PREVIEW_DURATION,
  MusicPreviewProcessingError,
} from '@/lib/music-preview'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request: Request, { params }: { params: Promise<{ songId: string }> }) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { songId } = await params
  const song = await prisma.musicSong.findUnique({
    where: { id: songId },
    select: { id: true, albumId: true },
  })
  if (!song) return failure(404, 'SONG_NOT_FOUND', '歌曲不存在')

  const formData = await request.formData().catch((error) => {
    console.error('[music-preview.form-data]', error)
    return null
  })
  if (!formData) return failure(400, 'INVALID_MULTIPART', '上传请求无效或文件超过服务器限制')
  const file = formData.get('file')
  if (!(file instanceof File)) return failure(400, 'FILE_REQUIRED', '请选择音频文件')
  if (!MUSIC_AUDIO_TYPES.has(file.type)) return failure(400, 'INVALID_FILE_TYPE', '仅支持 MP3、M4A、WAV、AAC')
  if (file.size > MUSIC_AUDIO_MAX_FILE_SIZE) return failure(413, 'FILE_TOO_LARGE', '音频文件不能超过 100MB')

  let preview: Buffer
  try {
    const extension = path.extname(file.name).slice(1) || 'audio'
    preview = await createMusicPreview(Buffer.from(await file.arrayBuffer()), extension)
  } catch (error) {
    if (!(error instanceof MusicPreviewProcessingError)) console.error('[music-preview.ffmpeg]', error)
    return failure(
      400,
      'AUDIO_PROCESSING_FAILED',
      error instanceof MusicPreviewProcessingError ? error.message : '音频处理失败，请确认文件没有损坏',
    )
  }

  try {
    const objectPath = `music-preview/${song.albumId}/${song.id}/preview.mp3`
    const objectUrl = await uploadMusicMedia({
      kind: 'preview',
      key: objectPath,
      body: preview,
      contentType: 'audio/mpeg',
    })
    const previewUrl = `${objectUrl}?v=${Date.now()}`
    await prisma.musicSong.update({
      where: { id: song.id },
      data: { previewUrl, previewDuration: MUSIC_PREVIEW_DURATION },
    })
    return NextResponse.json({
      success: true,
      previewUrl,
      previewDuration: MUSIC_PREVIEW_DURATION,
      sourceStored: false,
    })
  } catch (error) {
    if (!(error instanceof MusicMediaStorageError)) console.error('[music-preview.save]', error)
    return failure(
      error instanceof MusicMediaStorageError ? 502 : 500,
      error instanceof MusicMediaStorageError ? 'COS_UPLOAD_FAILED' : 'DATABASE_ERROR',
      error instanceof Error ? error.message : '试听片段保存失败，请稍后重试',
    )
  }
}

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, message }, { status })
}
