import { randomUUID } from 'node:crypto'
import { processGuessSongAudio } from '@/lib/guess-song-audio'
import {
  buildGuessSongObjectKey,
  deleteGuessSongObjects,
  downloadGuessSongObject,
  uploadGuessSongObject,
} from '@/lib/guess-song-storage'
import { prisma } from '@/lib/prisma'

async function saveProcessedAudio(
  questionId: string,
  processed: Awaited<ReturnType<typeof processGuessSongAudio>>,
) {
  const revision = randomUUID()
  const uploadedPaths: string[] = []
  const sourceAudioPath = buildGuessSongObjectKey(`questions/${questionId}/source/${revision}.mp3`)

  try {
    await uploadGuessSongObject({ key: sourceAudioPath, body: processed.source })
    uploadedPaths.push(sourceAudioPath)
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
        audioVariants: { select: { storagePath: true } },
      },
    })
    if (!old) throw new Error('QUESTION_NOT_FOUND')

    await prisma.$transaction(async (tx) => {
      await tx.guessSongAudioVariant.deleteMany({ where: { questionId } })
      await tx.guessSongQuestion.update({
        where: { id: questionId },
        data: {
          sourceAudioPath,
          audioDurationMs: processed.durationMs,
          processingStatus: 'READY',
          processingError: null,
          enabled: false,
          audioVariants: {
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
      ...old.audioVariants.map((variant) => variant.storagePath),
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
    await saveProcessedAudio(questionId, processed)
    return prisma.guessSongQuestion.findUniqueOrThrow({
      where: { id: questionId },
      include: { audioVariants: { orderBy: { durationSeconds: 'asc' } } },
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
    select: { sourceAudioPath: true },
  })
  if (!question?.sourceAudioPath) throw new Error('音频源文件不存在，请重新上传')
  const source = await downloadGuessSongObject(question.sourceAudioPath)
  return uploadAndProcessGuessSongAudio(questionId, source, 'mp3')
}
