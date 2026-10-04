import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createHash } from 'node:crypto'
import { resolveCantoneseCourseReadiness } from '@/lib/cantonese-course-readiness'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const lessonId = new URL(request.url).searchParams.get('lessonId')
  if (lessonId && !/^lesson-\d{2,3}$/.test(lessonId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_LESSON' }, { status: 400 })
  }
  const [courseDefinitions, lessonContents, questions, audioAssets, teachingInventory, questionInventory] = await Promise.all([
    prisma.cantoneseCourseDefinition.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ sortOrder: 'asc' }, { lessonNumber: 'asc' }],
      select: { lessonId: true, lessonNumber: true, title: true, subtitle: true, description: true, sortOrder: true, prerequisiteLessonId: true },
    }),
    prisma.cantoneseLessonContent.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ lessonId: 'asc' }, { sortOrder: 'asc' }, { stageId: 'asc' }, { stepId: 'asc' }, { externalId: 'asc' }],
      select: {
        externalId: true, lessonId: true, stageId: true, stepId: true, title: true, body: true,
        contentType: true, displayText: true, jyutping: true, tone: true, examples: true,
        section: true, usageNote: true, dialogueId: true, speaker: true, contentVersion: true,
        translation: true, explanation: true, audioId: true, sortOrder: true,
        requiresAudio: true, requiresSpeaking: true, updatedAt: true,
      },
    }),
    prisma.cantoneseQuestion.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ lessonId: 'asc' }, { sortOrder: 'asc' }, { stageId: 'asc' }, { externalId: 'asc' }],
      select: {
        externalId: true, lessonId: true, stageId: true, questionType: true, prompt: true,
        options: true, explanation: true, prerequisiteContentIds: true,
        audioId: true, speakingReferenceId: true, lyricPrescriptionId: true, sortOrder: true, updatedAt: true,
      },
    }),
    prisma.cantoneseAudioAsset.findMany({
      where: { status: 'APPROVED', assetStatus: 'READY', cosKey: { not: null }, checksum: { not: null }, fileSize: { not: null } },
      orderBy: [{ lessonId: 'asc' }, { externalId: 'asc' }],
      select: { externalId: true, audioKey: true, cosKey: true, text: true, jyutping: true, lessonId: true, contentId: true, audioVersion: true, checksum: true, fileSize: true, updatedAt: true },
    }),
    prisma.cantoneseLessonContent.findMany({
      select: { externalId: true, lessonId: true, status: true, requiresAudio: true, requiresSpeaking: true, audioId: true },
    }),
    prisma.cantoneseQuestion.findMany({
      select: { externalId: true, lessonId: true, status: true },
    }),
  ])

  const readyAudioAssets = audioAssets.filter((asset) => Boolean(asset.cosKey && asset.checksum && asset.fileSize))
  const readyAudioIds = new Set(readyAudioAssets.map((asset) => asset.externalId))
  const approvedContentIds = new Set(lessonContents.map((item) => item.externalId))
  const speakingContentIds = new Set(lessonContents.filter((item) => item.requiresSpeaking && item.requiresAudio && item.displayText?.trim() && item.audioId && readyAudioIds.has(item.audioId)).map((item) => item.externalId))
  const visibleQuestions = questions.filter((item) =>
    Array.isArray(item.prerequisiteContentIds)
    && item.prerequisiteContentIds.every((id) => typeof id === 'string' && approvedContentIds.has(id))
    && (item.questionType !== 'LISTENING' || Boolean(item.audioId && readyAudioIds.has(item.audioId)))
    && (item.questionType !== 'SPEAKING' || Boolean(item.speakingReferenceId && speakingContentIds.has(item.speakingReferenceId))))

  const courseReadiness = resolveCantoneseCourseReadiness({
    lessonIds: [...new Set([...courseDefinitions.map((course) => course.lessonId), ...teachingInventory.map((item) => item.lessonId), ...questionInventory.map((item) => item.lessonId)])].sort(),
    teaching: teachingInventory,
    questions: questionInventory,
    readyAudioIds,
    visibleQuestionIds: new Set(visibleQuestions.map((item) => item.externalId)),
  })

  const publicContents = lessonContents.filter((item) => !lessonId || item.lessonId === lessonId)
    .map((item) => ({ ...item, audioId: item.audioId && readyAudioIds.has(item.audioId) ? item.audioId : null }))
  const publicQuestions = visibleQuestions.filter((item) => !lessonId || item.lessonId === lessonId)
    .map((item) => ({ ...item, audioId: item.audioId && readyAudioIds.has(item.audioId) ? item.audioId : null }))
  const lessons = [...new Set([...courseDefinitions.map((course) => course.lessonId), ...publicContents.map((item) => item.lessonId), ...publicQuestions.map((item) => item.lessonId)])]
    .filter((id) => !lessonId || id === lessonId).sort().map((id) => {
    const lessonContentsForLesson = publicContents.filter((item) => item.lessonId === id)
    const lessonQuestionsForLesson = publicQuestions.filter((item) => item.lessonId === id)
    const quizSectionId = '07-小测'
    const sectionIds = [...new Set([
      ...lessonContentsForLesson.map((item) => item.section?.trim() || item.stageId),
      ...(lessonQuestionsForLesson.length ? [quizSectionId] : []),
    ])].sort()
    const sections = sectionIds.map((sectionId) => {
      const sectionContents = lessonContentsForLesson.filter((item) => (item.section?.trim() || item.stageId) === sectionId)
      return {
      sectionId,
      stageId: sectionContents[0]?.stageId ?? lessonQuestionsForLesson[0]?.stageId ?? sectionId,
      steps: sectionContents.map((item) => ({
        stepId: item.stepId,
        contentId: item.externalId,
        sortOrder: item.sortOrder,
        content: item,
      })),
      questions: sectionId === quizSectionId ? lessonQuestionsForLesson : [],
    }})
    return { lessonId: id, definition: courseDefinitions.find((course) => course.lessonId === id) ?? null, sections }
  })

  return NextResponse.json({
    courses: courseDefinitions.filter((course) => !lessonId || course.lessonId === lessonId),
    lessons,
    courseReadiness,
    code: lessons.length ? 'OK' : 'EMPTY_CONTENT',
    lessonContents: publicContents,
    questions: publicQuestions,
    audioAssets: readyAudioAssets.filter((asset) => !lessonId || asset.lessonId === lessonId || publicContents.some((item) => item.audioId === asset.externalId) || publicQuestions.some((item) => item.audioId === asset.externalId)).map(({ cosKey, ...asset }) => ({ ...asset,
      audioKey: asset.audioKey ?? (cosKey ? createHash('sha256').update(cosKey).digest('hex') : null) })),
    statusFilter: 'APPROVED_ONLY',
  }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } })
}
