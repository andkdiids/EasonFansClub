import path from 'node:path'
import { NextResponse } from 'next/server'
import { ensureAutoQuestionForSong } from '@/lib/guess-song-auto'
import { MusicMediaStorageError, uploadMusicMedia } from '@/lib/music-media-storage'
import {
  createMusicSourceAndPreview,
  MUSIC_AUDIO_MAX_FILE_SIZE,
  MusicPreviewProcessingError,
} from '@/lib/music-preview'
import { detectMusicAudioType, isSupportedMusicAudioFile } from '@/lib/music-upload-constraints'
import {
  buildGuessSongObjectKey,
  deleteGuessSongObject,
  uploadGuessSongObject,
} from '@/lib/guess-song-storage'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'
import { createUUID } from '@/lib/utils/uuid'

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
    select: { id: true, albumId: true, sourceAudioPath: true },
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

  const input = Buffer.from(await file.arrayBuffer())
  const detectedType = detectMusicAudioType(input)
  if (!detectedType) {
    return failure(400, 'INVALID_FILE_CONTENT', '音频文件内容无效或格式不受支持')
  }

  let processed: Awaited<ReturnType<typeof createMusicSourceAndPreview>>
  const processingStartedAt = Date.now()
  try {
    const extension = path.extname(file.name).slice(1) || detectedType
    processed = await createMusicSourceAndPreview(input, extension)
    console.info('[music-preview.processed]', {
      songId,
      sourceSize: processed.source.byteLength,
      previewSize: processed.preview.byteLength,
      durationMs: processed.durationMs,
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

  const revision = createUUID()
  const sourceAudioPath = buildGuessSongObjectKey(
    `music-sources/${song.albumId}/${song.id}/${revision}.mp3`,
  )
  const objectPath = `music-preview/${song.albumId}/${song.id}/${revision}.mp3`
  let privateSourceUploaded = false
  try {
    const uploadStartedAt = Date.now()
    await uploadGuessSongObject({
      key: sourceAudioPath,
      body: processed.source,
      contentType: 'audio/mpeg',
    })
    privateSourceUploaded = true
    const objectUrl = await uploadMusicMedia({
      kind: 'preview',
      key: objectPath,
      body: processed.preview,
      contentType: 'audio/mpeg',
    })
    console.info('[music-preview.cos-complete]', {
      songId,
      objectPath,
      elapsedMs: Date.now() - uploadStartedAt,
    })
    const previewUrl = `${objectUrl}?v=${encodeURIComponent(revision)}`
    await prisma.musicSong.update({
      where: { id: song.id },
      data: {
        sourceAudioPath,
        sourceAudioDurationMs: processed.durationMs,
        sourceAudioRevision: revision,
        previewUrl,
        previewDuration: processed.previewDuration,
      },
    })
    if (song.sourceAudioPath && song.sourceAudioPath !== sourceAudioPath) {
      await deleteGuessSongObject(song.sourceAudioPath).catch((cleanupError) => {
        console.error('[music-preview.cleanup-old-source]', cleanupError)
      })
    }
    // A published song with fresh audio joins the guess-song pool automatically;
    // failures here must never fail the upload itself.
    const guessClip = await ensureAutoQuestionForSong(song.id)
      .then((result) => (result.created ? 'created' : `skipped:${result.reason}`))
      .catch((hookError: unknown) => {
        console.error('[music-preview.guess-clip]', hookError)
        return 'failed'
      })
    console.info('[music-preview.complete]', { songId, sourceStored: true, guessClip })
    return NextResponse.json({
      success: true,
      previewUrl,
      previewDuration: processed.previewDuration,
      sourceDuration: Math.round(processed.durationMs / 100) / 10,
      sourceStored: true,
      guessClip,
    })
  } catch (error) {
    if (privateSourceUploaded) {
      await deleteGuessSongObject(sourceAudioPath).catch(() => null)
    }
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
