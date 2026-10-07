import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveCantoneseCourseReadiness, type CantoneseCourseReadiness } from '@/lib/cantonese-course-readiness'

export type CantoneseLessonState = 'NOT_RELEASED' | 'LOCKED' | 'AVAILABLE' | 'COMPLETED'
export type CantoneseProgressAction = 'START' | 'TEACHING_COMPLETE' | 'QUESTIONS_COMPLETE' | 'COMPLETE'

type ReviewStatus = 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED'

/** Retry a rolled-back transaction, never an individual milestone write. */
export async function retryCantoneseProgressTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const failure = error as { code?: unknown; meta?: { modelName?: unknown; target?: unknown } } | null
      const target = failure?.meta?.target
      const progressUniqueKey = target === 'CantoneseLessonProgress_userId_lessonId_key'
        || (Array.isArray(target) && target.length === 2 && target.includes('userId') && target.includes('lessonId'))
      const duplicateProgress = failure?.code === 'P2002' && progressUniqueKey
        && (!failure.meta?.modelName || failure.meta.modelName === 'CantoneseLessonProgress')
      // MySQL may emulate an upsert with read/create. A competing insert or
      // transaction deadlock must reload fresh authoritative progress before
      // retrying; NULL-guarded writes preserve the first committed timestamps.
      if (attempt >= 3 || (!duplicateProgress && failure?.code !== 'P2034')) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 20))
    }
  }
}

export type CantoneseLessonProgressRecord = {
  lessonId: string
  startedAt: Date | null
  teachingCompletedAt: Date | null
  questionsCompletedAt: Date | null
  completedAt: Date | null
}

export type CantoneseProgressContext = {
  definitions: { lessonId: string; lessonNumber: number; prerequisiteLessonId: string | null }[]
  readiness: CantoneseCourseReadiness[]
  progressRows: CantoneseLessonProgressRecord[]
}

type ProgressDb = Pick<PrismaClient,
  'cantoneseCourseDefinition' |
  'cantoneseLessonContent' |
  'cantoneseQuestion' |
  'cantoneseAudioAsset' |
  'cantoneseLessonProgress'
>

const progressSelect = {
  lessonId: true,
  startedAt: true,
  teachingCompletedAt: true,
  questionsCompletedAt: true,
  completedAt: true,
} as const

/**
 * Load the same approved-course readiness evidence used by the course API,
 * together with only the authenticated user's progress rows.
 */
export async function loadCantoneseProgressContext(
  userId: string,
  db: ProgressDb = prisma,
): Promise<CantoneseProgressContext> {
  const [definitions, teaching, questions, readyAudio, approvedContent, progressRows] = await Promise.all([
    db.cantoneseCourseDefinition.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ sortOrder: 'asc' }, { lessonNumber: 'asc' }],
      select: { lessonId: true, lessonNumber: true, prerequisiteLessonId: true },
    }),
    db.cantoneseLessonContent.findMany({
      select: { externalId: true, lessonId: true, status: true, requiresAudio: true, requiresSpeaking: true, audioId: true },
    }),
    db.cantoneseQuestion.findMany({
      select: { externalId: true, lessonId: true, status: true, questionType: true, prerequisiteContentIds: true, audioId: true, speakingReferenceId: true },
    }),
    db.cantoneseAudioAsset.findMany({
      where: { status: 'APPROVED', assetStatus: 'READY', cosKey: { not: null }, checksum: { not: null }, fileSize: { not: null } },
      select: { externalId: true, cosKey: true, checksum: true, fileSize: true },
    }),
    db.cantoneseLessonContent.findMany({
      where: { status: 'APPROVED' },
      select: { externalId: true, requiresAudio: true, requiresSpeaking: true, displayText: true, audioId: true },
    }),
    db.cantoneseLessonProgress.findMany({ where: { userId }, select: progressSelect }),
  ])

  const readyAudioIds = new Set(readyAudio
    .filter((asset) => Boolean(asset.cosKey && asset.checksum && asset.fileSize && asset.fileSize > 0))
    .map((asset) => asset.externalId))
  const approvedContentIds = new Set(approvedContent.map((item) => item.externalId))
  const speakingContentIds = new Set(approvedContent
    .filter((item) => item.requiresSpeaking && item.requiresAudio && item.displayText?.trim() && item.audioId && readyAudioIds.has(item.audioId))
    .map((item) => item.externalId))
  const visibleQuestionIds = new Set(questions.filter((item) =>
    Array.isArray(item.prerequisiteContentIds)
    && item.prerequisiteContentIds.every((id) => typeof id === 'string' && approvedContentIds.has(id))
    && (item.questionType !== 'LISTENING' || Boolean(item.audioId && readyAudioIds.has(item.audioId)))
    && (item.questionType !== 'SPEAKING' || Boolean(item.speakingReferenceId && speakingContentIds.has(item.speakingReferenceId))),
  ).map((item) => item.externalId))

  const lessonIds = [...new Set([
    ...definitions.map((course) => course.lessonId),
    ...teaching.map((item) => item.lessonId),
    ...questions.map((item) => item.lessonId),
  ])].sort()

  const readiness = resolveCantoneseCourseReadiness({
    lessonIds,
    teaching: teaching.map((item) => ({ ...item, status: item.status as ReviewStatus })),
    questions: questions.map((item) => ({ ...item, status: item.status as ReviewStatus })),
    readyAudioIds,
    visibleQuestionIds,
  })

  return { definitions, readiness, progressRows }
}

export function resolveCantoneseLessonState(input: {
  lessonId: string
  prerequisiteLessonId: string | null
  readiness: CantoneseCourseReadiness | undefined
  progressRows: readonly CantoneseLessonProgressRecord[]
}): CantoneseLessonState {
  const current = input.progressRows.find((row) => row.lessonId === input.lessonId)
  // Completion is historical and monotonic across course-content updates.
  if (current?.completedAt) return 'COMPLETED'
  if (input.readiness?.status !== 'READY') return 'NOT_RELEASED'
  if (input.prerequisiteLessonId !== null && !input.progressRows.some((row) => row.lessonId === input.prerequisiteLessonId && row.completedAt)) {
    return 'LOCKED'
  }
  return 'AVAILABLE'
}

export function buildCantoneseProgressResponse(context: CantoneseProgressContext) {
  const lessons = context.definitions.map((definition) => {
    const record = context.progressRows.find((row) => row.lessonId === definition.lessonId)
    const readiness = context.readiness.find((row) => row.lessonId === definition.lessonId)
    return {
      lessonId: definition.lessonId,
      lessonNumber: definition.lessonNumber,
      prerequisiteLessonId: definition.prerequisiteLessonId,
      state: resolveCantoneseLessonState({
        lessonId: definition.lessonId,
        prerequisiteLessonId: definition.prerequisiteLessonId,
        readiness,
        progressRows: context.progressRows,
      }),
      startedAt: record?.startedAt?.toISOString() ?? null,
      teachingCompletedAt: record?.teachingCompletedAt?.toISOString() ?? null,
      questionsCompletedAt: record?.questionsCompletedAt?.toISOString() ?? null,
      completedAt: record?.completedAt?.toISOString() ?? null,
    }
  })
  return { code: 'OK' as const, source: 'SERVER' as const, lessons }
}

export type CantoneseProgressPatch = Partial<Pick<CantoneseLessonProgressRecord,
  'startedAt' | 'teachingCompletedAt' | 'questionsCompletedAt' | 'completedAt'
>>

export type CantoneseProgressTransition =
  | { ok: true; patch: CantoneseProgressPatch }
  | { ok: false; code: 'LESSON_NOT_STARTED' | 'TEACHING_NOT_COMPLETE' | 'QUESTIONS_NOT_READY' | 'LEARNING_PARTS_INCOMPLETE' }

/** Pure, monotonic state transition. The route persists patches with `field IS NULL` updates. */
export function transitionCantoneseProgress(input: {
  current: CantoneseLessonProgressRecord | undefined
  action: CantoneseProgressAction
  now: Date
  questionsRequired: boolean
  questionsReady: boolean
}): CantoneseProgressTransition {
  const current = input.current
  if (current?.completedAt) return { ok: true, patch: {} }

  switch (input.action) {
    case 'START':
      return current?.startedAt ? { ok: true, patch: {} } : { ok: true, patch: { startedAt: input.now } }
    case 'TEACHING_COMPLETE':
      if (!current?.startedAt) return { ok: false, code: 'LESSON_NOT_STARTED' }
      return current.teachingCompletedAt ? { ok: true, patch: {} } : { ok: true, patch: { teachingCompletedAt: input.now } }
    case 'QUESTIONS_COMPLETE':
      if (!current?.startedAt) return { ok: false, code: 'LESSON_NOT_STARTED' }
      if (!current.teachingCompletedAt) return { ok: false, code: 'TEACHING_NOT_COMPLETE' }
      if (input.questionsRequired && !input.questionsReady) return { ok: false, code: 'QUESTIONS_NOT_READY' }
      return current.questionsCompletedAt ? { ok: true, patch: {} } : { ok: true, patch: { questionsCompletedAt: input.now } }
    case 'COMPLETE':
      if (!current?.startedAt) return { ok: false, code: 'LESSON_NOT_STARTED' }
      if (!current.teachingCompletedAt) return { ok: false, code: 'TEACHING_NOT_COMPLETE' }
      if (input.questionsRequired && !input.questionsReady) return { ok: false, code: 'QUESTIONS_NOT_READY' }
      if (input.questionsRequired && !current.questionsCompletedAt) return { ok: false, code: 'LEARNING_PARTS_INCOMPLETE' }
      return { ok: true, patch: { completedAt: input.now } }
  }
}
