import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import { loadCantoneseProgressContext, resolveCantoneseLessonState } from '@/lib/cantonese-progress'
import { gradeCantoneseAnswer, nextCantoneseQuestionMastery, parseCantoneseAnswerIds } from '@/lib/cantonese-answer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
type Context = { params: Promise<{ questionId: string }> }
type AnswerMode = 'LESSON' | 'REVIEW'
type ParsedAnswerMode = AnswerMode | 'INVALID'

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status, headers: NO_STORE })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function answerText(ids: readonly string[], options: readonly { id: string; text: string }[]) {
  const labels = new Map(options.map((option) => [option.id, option.text]))
  return ids.map((id) => labels.get(id)).filter((label): label is string => Boolean(label)).join(' / ')
}

export async function POST(request: Request, { params }: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { questionId } = await params
  if (!/^[a-zA-Z0-9._:-]{1,191}$/.test(questionId)) return errorResponse('QUESTION_NOT_FOUND', 404)
  const body = await request.json().catch(() => null) as unknown
  if (!isRecord(body)) return errorResponse('INVALID_ANSWER', 400)
  const selectedOptionIds = parseCantoneseAnswerIds(body.selectedOptionIds)
  const mode: ParsedAnswerMode = body.mode === undefined || body.mode === 'LESSON' ? 'LESSON' : body.mode === 'REVIEW' ? 'REVIEW' : 'INVALID'
  if (!selectedOptionIds || mode === 'INVALID') return errorResponse('INVALID_ANSWER', 400)

  try {
    const question = await prisma.cantoneseQuestion.findUnique({
      where: { externalId: questionId },
      select: { externalId: true, lessonId: true, questionType: true, options: true, correctAnswer: true,
        explanation: true, prerequisiteContentIds: true, audioId: true, status: true },
    })
    if (!question || question.status !== 'APPROVED') return errorResponse('QUESTION_NOT_FOUND', 404)
    if (!['SINGLE_SELECT', 'MULTI_SELECT', 'TRUE_FALSE', 'LISTENING'].includes(question.questionType)) {
      return errorResponse('QUESTION_NOT_GRADEABLE', 409)
    }

    const graded = gradeCantoneseAnswer({
      questionType: question.questionType, options: question.options,
      selectedOptionIds, correctAnswer: question.correctAnswer,
    })
    if (!graded) {
      return errorResponse('QUESTION_CONTRACT_INVALID', 409)
    }

    const prerequisiteIds = Array.isArray(question.prerequisiteContentIds)
      ? question.prerequisiteContentIds.filter((id): id is string => typeof id === 'string') : []
    if (!Array.isArray(question.prerequisiteContentIds) || prerequisiteIds.length !== question.prerequisiteContentIds.length) {
      return errorResponse('QUESTION_NOT_AVAILABLE', 404)
    }
    const approvedContent = prerequisiteIds.length ? await prisma.cantoneseLessonContent.findMany({
      where: { externalId: { in: prerequisiteIds }, status: 'APPROVED' }, select: { externalId: true },
    }) : []
    if (approvedContent.length !== prerequisiteIds.length) return errorResponse('QUESTION_NOT_AVAILABLE', 404)

    if (question.questionType === 'LISTENING') {
      if (!question.audioId) return errorResponse('QUESTION_NOT_AVAILABLE', 404)
      const audio = await prisma.cantoneseAudioAsset.findUnique({
        where: { externalId: question.audioId }, select: { status: true, assetStatus: true, cosKey: true, checksum: true, fileSize: true },
      })
      if (!audio || audio.status !== 'APPROVED' || audio.assetStatus !== 'READY' || !audio.cosKey || !audio.checksum || !audio.fileSize) {
        return errorResponse('QUESTION_NOT_AVAILABLE', 404)
      }
    }

    const previous = await prisma.cantoneseLearnerQuestionProgress.findUnique({
      where: { userId_questionId: { userId: guard.user.id, questionId } },
      select: { wrongCount: true },
    })
    if (mode === 'REVIEW') {
      if (!previous?.wrongCount) return errorResponse('REVIEW_ITEM_NOT_FOUND', 404)
    } else {
      const context = await loadCantoneseProgressContext(guard.user.id)
      const lessonState = resolveCantoneseLessonState({
        lessonId: question.lessonId,
        prerequisiteLessonId: context.definitions.find((item) => item.lessonId === question.lessonId)?.prerequisiteLessonId ?? null,
        readiness: context.readiness.find((item) => item.lessonId === question.lessonId),
        progressRows: context.progressRows,
      })
      if (lessonState === 'NOT_RELEASED') return errorResponse('LESSON_NOT_RELEASED', 404)
      if (lessonState === 'LOCKED') return errorResponse('LESSON_LOCKED', 409)
      const lessonProgress = context.progressRows.find((item) => item.lessonId === question.lessonId)
      if (!lessonProgress?.startedAt || !lessonProgress.teachingCompletedAt) return errorResponse('TEACHING_NOT_COMPLETE', 409)
    }

    const correct = graded.correct
    const selectedText = answerText(graded.selectedOptionIds, graded.options)
    const correctText = answerText(graded.correctOptionIds, graded.options)
    const now = new Date()
    const saved = await prisma.$transaction(async (tx) => {
      const current = await tx.cantoneseLearnerQuestionProgress.findUnique({
        where: { userId_questionId: { userId: guard.user.id, questionId } },
      })
      const masteryState = nextCantoneseQuestionMastery({
        wrongCount: current?.wrongCount ?? 0,
        consecutiveCorrect: current?.consecutiveCorrect ?? 0,
      }, correct)
      return tx.cantoneseLearnerQuestionProgress.upsert({
        where: { userId_questionId: { userId: guard.user.id, questionId } },
        create: {
          userId: guard.user.id, questionId, attemptCount: 1, correctCount: correct ? 1 : 0,
          wrongCount: masteryState.wrongCount, consecutiveCorrect: masteryState.consecutiveCorrect, mastery: masteryState.mastery,
          lastWrongAt: correct ? null : now, lastCorrectAt: correct ? now : null, lastAnsweredAt: now,
          lastAnswerCorrect: correct,
          lastWrongAnswer: correct ? Prisma.JsonNull : [selectedText],
        },
        update: {
          attemptCount: { increment: 1 }, correctCount: { increment: correct ? 1 : 0 },
          wrongCount: { increment: correct ? 0 : 1 }, consecutiveCorrect: masteryState.consecutiveCorrect,
          mastery: masteryState.mastery, lastAnsweredAt: now, lastAnswerCorrect: correct,
          ...(correct ? { lastCorrectAt: now } : { lastWrongAt: now, lastWrongAnswer: [selectedText] }),
        },
        select: { attemptCount: true, correctCount: true, wrongCount: true, consecutiveCorrect: true, mastery: true,
          lastWrongAt: true, lastCorrectAt: true, lastAnsweredAt: true, lastAnswerCorrect: true },
      })
    })

    return NextResponse.json({
      code: 'OK', questionId, lessonId: question.lessonId, correct,
      answer: selectedText, correctAnswer: correctText, explanation: question.explanation,
      progress: { ...saved, lastWrongAt: saved.lastWrongAt?.toISOString() ?? null,
        lastCorrectAt: saved.lastCorrectAt?.toISOString() ?? null, lastAnsweredAt: saved.lastAnsweredAt?.toISOString() ?? null },
    }, { headers: NO_STORE })
  } catch {
    return errorResponse('ANSWER_UNAVAILABLE', 503)
  }
}
