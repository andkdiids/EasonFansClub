import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createHash } from 'node:crypto'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const lessonId = new URL(request.url).searchParams.get('lessonId')
  if (lessonId && !/^lesson-0[1-6]$/.test(lessonId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_LESSON' }, { status: 400 })
  }
  const lessonWhere = lessonId ? { lessonId } : {}
  const [lessonContents, questions, audioAssets] = await Promise.all([
    prisma.cantoneseLessonContent.findMany({
      where: { status: 'APPROVED', ...lessonWhere },
      orderBy: [{ lessonId: 'asc' }, { sortOrder: 'asc' }, { stageId: 'asc' }, { stepId: 'asc' }, { externalId: 'asc' }],
      select: {
        externalId: true, lessonId: true, stageId: true, stepId: true, title: true, body: true,
        contentType: true, displayText: true, jyutping: true, tone: true, examples: true,
        translation: true, explanation: true, audioId: true, sortOrder: true,
        requiresAudio: true, requiresSpeaking: true, updatedAt: true,
      },
    }),
    prisma.cantoneseQuestion.findMany({
      where: { status: 'APPROVED', ...lessonWhere },
      orderBy: [{ lessonId: 'asc' }, { sortOrder: 'asc' }, { stageId: 'asc' }, { externalId: 'asc' }],
      select: {
        externalId: true, lessonId: true, stageId: true, questionType: true, prompt: true,
        options: true, explanation: true, prerequisiteContentIds: true,
        audioId: true, speakingReferenceId: true, lyricPrescriptionId: true, sortOrder: true, updatedAt: true,
      },
    }),
    prisma.cantoneseAudioAsset.findMany({
      where: { status: 'APPROVED', assetStatus: 'READY', cosKey: { not: null }, ...lessonWhere },
      orderBy: [{ lessonId: 'asc' }, { externalId: 'asc' }],
      select: { externalId: true, audioKey: true, cosKey: true, text: true, jyutping: true, lessonId: true, contentId: true, audioVersion: true, checksum: true, fileSize: true, updatedAt: true },
    }),
  ])

  const readyAudioIds = new Set(audioAssets.map((asset) => asset.externalId))
  const approvedContentIds = new Set(lessonContents.map((item) => item.externalId))
  const speakingContentIds = new Set(lessonContents.filter((item) => item.requiresSpeaking && item.displayText?.trim()).map((item) => item.externalId))
  const visibleQuestions = questions.filter((item) =>
    Array.isArray(item.prerequisiteContentIds)
    && item.prerequisiteContentIds.every((id) => typeof id === 'string' && approvedContentIds.has(id))
    && (item.questionType !== 'LISTENING' || Boolean(item.audioId && readyAudioIds.has(item.audioId)))
    && (item.questionType !== 'SPEAKING' || Boolean(item.speakingReferenceId && speakingContentIds.has(item.speakingReferenceId))))

  return NextResponse.json({
    lessonContents: lessonContents.map((item) => ({ ...item, audioId: item.audioId && readyAudioIds.has(item.audioId) ? item.audioId : null })),
    questions: visibleQuestions.map((item) => ({ ...item, audioId: item.audioId && readyAudioIds.has(item.audioId) ? item.audioId : null })),
    audioAssets: audioAssets.map(({ cosKey, ...asset }) => ({ ...asset,
      audioKey: asset.audioKey ?? (cosKey ? createHash('sha256').update(cosKey).digest('hex') : null) })),
    statusFilter: 'APPROVED_ONLY',
  }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } })
}
