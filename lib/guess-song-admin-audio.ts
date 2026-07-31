import {
  GuessSongAudioProcessingError,
  processGuessSongAudio,
} from '@/lib/guess-song-audio'
import {
  buildGuessSongObjectKey,
  deleteGuessSongObjects,
  downloadGuessSongObject,
  uploadGuessSongObject,
} from '@/lib/guess-song-storage'
import { prisma } from '@/lib/prisma'
import { createUUID } from '@/lib/utils/uuid'

async function saveProcessedAudio(
  questionId: string,
  processed: Awaited<ReturnType<typeof processGuessSongAudio>>,
  options: {
    audioSourceType: 'MANUAL_UPLOAD' | 'EASMUSIC_SONG'
    musicSourceRevision?: string | null
    persistSource: boolean
  },
) {
  const revision = createUUID()
  const uploadedPaths: string[] = []
  const sourceAudioPath = options.persistSource
    ? buildGuessSongObjectKey(`questions/${questionId}/source/${revision}.mp3`)
    : null

  try {
    if (sourceAudioPath) {
      await uploadGuessSongObject({ key: sourceAudioPath, body: processed.source })
      uploadedPaths.push(sourceAudioPath)
    }
    for (const variant of processed.variants) {
      const storagePath = buildGuessSongObjectKey(
        `questions/${questionId}/variants/${revision}/${variant.durationSeconds}s.mp3`,
      )
      await uploadGuessSongObject({ key: storagePath, body: variant.buffer })
      uploadedPaths.push(storagePath)
    }

    const old = await prisma.guessSongQuestion.findUnique({
      where: { id: questionId },
      select: {
        sourceAudioPath: true,
        GuessSongAudioVariant: { select: { storagePath: true } },
      },
    })
    if (!old) throw new Error('QUESTION_NOT_FOUND')

    await prisma.$transaction(async (tx) => {
      await tx.guessSongAudioVariant.deleteMany({ where: { questionId } })
      await tx.guessSongQuestion.update({
        where: { id: questionId },
        data: {
          sourceAudioPath,
          audioSourceType: options.audioSourceType,
          musicSourceRevision: options.musicSourceRevision || null,
          audioDurationMs: processed.durationMs,
          processingStatus: 'READY',
          processingError: null,
          enabled: false,
          GuessSongAudioVariant: {
            create: processed.variants.map((variant) => ({
              durationSeconds: variant.durationSeconds,
              storagePath: buildGuessSongObjectKey(
                `questions/${questionId}/variants/${revision}/${variant.durationSeconds}s.mp3`,
              ),
              fileSize: variant.buffer.byteLength,
            })),
          },
        },
      })
    })

    const oldPaths = [
      ...(old.sourceAudioPath ? [old.sourceAudioPath] : []),
      ...old.GuessSongAudioVariant.map((variant) => variant.storagePath),
    ].filter((path) => !uploadedPaths.includes(path))
    await deleteGuessSongObjects(oldPaths).catch((error) => {
      console.error('[guess-song.audio.cleanup-old]', error)
    })
  } catch (error) {
    await deleteGuessSongObjects(uploadedPaths).catch(() => null)
    throw error
  }
}

export async function uploadAndProcessGuessSongAudio(
  questionId: string,
  input: Buffer,
  extension: string,
) {
  await prisma.guessSongQuestion.update({
    where: { id: questionId },
    data: { processingStatus: 'PROCESSING', processingError: null, enabled: false },
  })
  try {
    const processed = await processGuessSongAudio(input, extension)
    await saveProcessedAudio(questionId, processed, {
      audioSourceType: 'MANUAL_UPLOAD',
      musicSourceRevision: null,
      persistSource: true,
    })
    return prisma.guessSongQuestion.findUniqueOrThrow({
      where: { id: questionId },
      include: { GuessSongAudioVariant: { orderBy: { durationSeconds: 'asc' } } },
    })
  } catch (error) {
    await prisma.guessSongQuestion.updateMany({
      where: { id: questionId },
      data: {
        processingStatus: 'FAILED',
        processingError: error instanceof Error ? error.message.slice(0, 500) : '音频处理失败',
        enabled: false,
      },
    })
    throw error
  }
}

export async function regenerateGuessSongAudio(questionId: string) {
  const question = await prisma.guessSongQuestion.findUnique({
    where: { id: questionId },
    select: {
      sourceAudioPath: true,
      audioSourceType: true,
      musicSongId: true,
      MusicSong: {
        select: {
          sourceAudioPath: true,
          sourceAudioRevision: true,
        },
      },
    },
  })
  if (question?.audioSourceType === 'EASMUSIC_SONG' && question.musicSongId) {
    return generateGuessSongAudioFromMusicSong(questionId)
  }
  if (!question?.sourceAudioPath) throw new Error('音频源文件不存在，请重新上传')
  const source = await downloadGuessSongObject(question.sourceAudioPath)
  return uploadAndProcessGuessSongAudio(questionId, source, 'mp3')
}

export async function generateGuessSongAudioFromMusicSong(questionId: string) {
  const question = await prisma.guessSongQuestion.findUnique({
    where: { id: questionId },
    select: {
      musicSongId: true,
      MusicSong: {
        select: {
          sourceAudioPath: true,
          sourceAudioRevision: true,
        },
      },
    },
  })
  if (!question) throw new GuessSongAudioProcessingError('题目不存在')
  if (!question.musicSongId || !question.MusicSong) {
    throw new GuessSongAudioProcessingError('请先选择 EasMusic 歌曲')
  }
  if (!question.MusicSong.sourceAudioPath || !question.MusicSong.sourceAudioRevision) {
    throw new GuessSongAudioProcessingError('所选歌曲尚未上传可用音频源')
  }

  await prisma.guessSongQuestion.update({
    where: { id: questionId },
    data: { processingStatus: 'PROCESSING', processingError: null, enabled: false },
  })
  try {
   console.log(
  '[COS DEBUG PATH]',
  question.MusicSong.sourceAudioPath,
)

const source = await downloadGuessSongObject(
  question.MusicSong.sourceAudioPath,
)

const processed = await processGuessSongAudio(source, 'mp3')
    await saveProcessedAudio(questionId, processed, {
      audioSourceType: 'EASMUSIC_SONG',
      musicSourceRevision: question.MusicSong.sourceAudioRevision,
      persistSource: false,
    })
    return prisma.guessSongQuestion.findUniqueOrThrow({
      where: { id: questionId },
      include: {
        GuessSongAudioVariant: { orderBy: { durationSeconds: 'asc' } },
        MusicSong: true,
      },
    })
  } catch (error) {
    await prisma.guessSongQuestion.updateMany({
      where: { id: questionId },
      data: {
        processingStatus: 'FAILED',
        processingError: error instanceof Error ? error.message.slice(0, 500) : '音频处理失败',
        enabled: false,
      },
    })
    throw error
  }
}
