import path from 'node:path'
import { NextResponse } from 'next/server'
import { MusicMediaStorageError, uploadMusicMedia } from '@/lib/music-media-storage'
import {
  createMusicPreview,
  MUSIC_AUDIO_MAX_FILE_SIZE,
  MUSIC_PREVIEW_DURATION,
  MusicPreviewProcessingError,
} from '@/lib/music-preview'
import { isSupportedMusicAudioFile } from '@/lib/music-upload-constraints'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request: Request, context: { params: Promise<{ songId: string }> }) {
  try {
    return await uploadPreview(request, context)
  } catch (error) {
    console.error('[music-preview.unhandled]', error)
    return failure(500, 'UPLOAD_FAILED', '试听片段上传失败，请查看服务器日志后重试')
  }
}

async function uploadPreview(request: Request, { params }: { params: Promise<{ songId: string }> }) {
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

  console.info('[music-preview.received]', {
    songId,
    fileName: file.name,
    mimeType: file.type || 'unknown',
    fileSize: file.size,
  })
  if (!isSupportedMusicAudioFile(file)) return failure(400, 'INVALID_FILE_TYPE', '仅支持 MP3、M4A、WAV、AAC')
  if (file.size === 0) return failure(400, 'EMPTY_FILE', '音频文件不能为空')
  if (file.size > MUSIC_AUDIO_MAX_FILE_SIZE) return failure(413, 'FILE_TOO_LARGE', '音频文件不能超过 100MB')

  let preview: Buffer
  const processingStartedAt = Date.now()
  try {
    const extension = path.extname(file.name).slice(1) || 'audio'
    preview = await createMusicPreview(Buffer.from(await file.arrayBuffer()), extension)
    console.info('[music-preview.processed]', {
      songId,
      outputSize: preview.byteLength,
      elapsedMs: Date.now() - processingStartedAt,
    })
  } catch (error) {
    console.error('[music-preview.ffmpeg]', error)
    return failure(
      400,
      'AUDIO_PROCESSING_FAILED',
      error instanceof MusicPreviewProcessingError ? error.message : '音频处理失败，请确认文件没有损坏',
    )
  }

  const objectPath = `music-preview/${song.albumId}/${song.id}/preview.mp3`
  try {
    const uploadStartedAt = Date.now()
    const objectUrl = await uploadMusicMedia({
      kind: 'preview',
      key: objectPath,
      body: preview,
      contentType: 'audio/mpeg',
    })
    console.info('[music-preview.cos-complete]', {
      songId,
      objectPath,
      elapsedMs: Date.now() - uploadStartedAt,
    })
    const previewUrl = `${objectUrl}?v=${Date.now()}`
    await prisma.musicSong.update({
      where: { id: song.id },
      data: { previewUrl, previewDuration: MUSIC_PREVIEW_DURATION },
    })
    console.info('[music-preview.complete]', { songId, sourceStored: false })
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
  return NextResponse.json({ success: false, code, error: message, message }, { status })
}
