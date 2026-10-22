import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import { gradeCantoneseAnswer } from '@/lib/cantonese-answer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function safeOptions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return []
    const item = option as Record<string, unknown>
    const text = typeof item.text === 'string' ? item.text : typeof item.label === 'string' ? item.label : null
    return typeof item.id === 'string' && text?.trim() ? [{ id: item.id, text: text.trim() }] : []
  })
}

function safeAnswerIds(value: unknown) {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return []
  return value as string[]
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const url = new URL(request.url)
  const state = url.searchParams.get('state') || 'DUE'
  const questionId = url.searchParams.get('questionId')
  if (!['DUE', 'MASTERED', 'ALL'].includes(state)) {
    return NextResponse.json({ ok: false, code: 'INVALID_STATE' }, { status: 400, headers: NO_STORE })
  }
  if (questionId && !/^[a-zA-Z0-9._:-]{1,191}$/.test(questionId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_QUESTION' }, { status: 400, headers: NO_STORE })
  }
  const parsedLimit = Number.parseInt(url.searchParams.get('limit') || '8', 10)
  const parsedOffset = Number.parseInt(url.searchParams.get('offset') || '0', 10)
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50 || !Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 100_000) {
    return NextResponse.json({ ok: false, code: 'INVALID_PAGE' }, { status: 400, headers: NO_STORE })
  }
  const limit = parsedLimit

  try {
    const rows = await prisma.cantoneseLearnerQuestionProgress.findMany({
      where: { userId: guard.user.id, wrongCount: { gt: 0 }, ...(questionId ? { questionId } : {}), ...(state === 'DUE' ? { mastery: { not: 'MASTERED' } } : state === 'MASTERED' ? { mastery: 'MASTERED' } : {}) },
      orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }, { questionId: 'asc' }],
      skip: questionId ? 0 : parsedOffset,
      take: questionId ? 1 : limit,
      select: { questionId: true, attemptCount: true, correctCount: true, wrongCount: true,
        consecutiveCorrect: true, mastery: true, lastWrongAt: true, lastCorrectAt: true,
        lastAnsweredAt: true, lastWrongAnswer: true },
    })
    const ids = rows.map((row) => row.questionId)
    const questions = ids.length ? await prisma.cantoneseQuestion.findMany({
      where: { externalId: { in: ids }, status: 'APPROVED' },
      select: { externalId: true, lessonId: true, questionType: true, prompt: true, options: true,
        correctAnswer: true, explanation: true, prerequisiteContentIds: true, audioId: true },
    }) : []
    const visibleIds = new Set(questions.map((question) => question.externalId))
    const prerequisites = [...new Set(questions.flatMap((question) => Array.isArray(question.prerequisiteContentIds)
      ? question.prerequisiteContentIds.filter((id): id is string => typeof id === 'string') : []))]
    const content = prerequisites.length ? await prisma.cantoneseLessonContent.findMany({
      where: { externalId: { in: prerequisites }, status: 'APPROVED' },
      select: { externalId: true, displayText: true, jyutping: true, translation: true, audioId: true },
    }) : []
    const audioIds = [...new Set(questions.flatMap((question) => question.audioId ? [question.audioId] : []))]
    const readyAudio = audioIds.length ? await prisma.cantoneseAudioAsset.findMany({
      where: { externalId: { in: audioIds }, status: 'APPROVED', assetStatus: 'READY', cosKey: { not: null }, checksum: { not: null }, fileSize: { not: null } },
      select: { externalId: true, cosKey: true, checksum: true, fileSize: true },
    }) : []
    const readyAudioIds = new Set(readyAudio.filter((item) => Boolean(item.cosKey && item.checksum && item.fileSize)).map((item) => item.externalId))
    const contentById = new Map(content.map((item) => [item.externalId, item]))
    const questionsById = new Map(questions.filter((question) => {
      const prerequisiteIds = question.prerequisiteContentIds
      const options = safeOptions(question.options)
      const correctIds = safeAnswerIds(question.correctAnswer)
      const validAnswer = gradeCantoneseAnswer({ questionType: question.questionType, options: question.options, selectedOptionIds: correctIds, correctAnswer: question.correctAnswer }) !== null
      const supportedType = ['SINGLE_SELECT', 'MULTI_SELECT', 'TRUE_FALSE', 'LISTENING'].includes(question.questionType)
      const validPrerequisites = Array.isArray(prerequisiteIds) && prerequisiteIds.every((id) => typeof id === 'string' && contentById.has(id))
      const validAudio = question.questionType !== 'LISTENING' || Boolean(question.audioId && readyAudioIds.has(question.audioId))
      return supportedType && validAnswer && validPrerequisites && validAudio && options.length >= 2
    }).map((item) => [item.externalId, item]))
    const progressById = new Map(rows.map((item) => [item.questionId, item]))
    const items = ids.flatMap((id) => {
      const question = questionsById.get(id)
      const progress = progressById.get(id)
      if (!question || !progress || (question.questionType === 'LISTENING' && (!question.audioId || !readyAudioIds.has(question.audioId)))) return []
      const options = safeOptions(question.options)
      const correctAnswer = safeAnswerIds(question.correctAnswer).map((answerId) => options.find((option) => option.id === answerId)?.text).filter((text): text is string => Boolean(text))
      const knowledge = (Array.isArray(question.prerequisiteContentIds) ? question.prerequisiteContentIds : [])
        .filter((contentId): contentId is string => typeof contentId === 'string')
        .map((contentId) => contentById.get(contentId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      return [{
        questionId: id, lessonId: question.lessonId, type: question.questionType,
        prompt: question.prompt, options, correctAnswer, explanation: question.explanation,
        knowledge: knowledge.map((item) => ({ text: item.displayText, jyutping: item.jyutping,
          meaning: item.translation, audioId: item.audioId && readyAudioIds.has(item.audioId) ? item.audioId : null })),
        lastWrongAnswer: progress.lastWrongAnswer, attemptCount: progress.attemptCount,
        correctCount: progress.correctCount, wrongCount: progress.wrongCount,
        consecutiveCorrect: progress.consecutiveCorrect, mastery: progress.mastery,
        lastWrongAt: progress.lastWrongAt?.toISOString() ?? null,
        lastCorrectAt: progress.lastCorrectAt?.toISOString() ?? null,
        lastAnsweredAt: progress.lastAnsweredAt?.toISOString() ?? null,
      }]
    }).filter((item) => visibleIds.has(item.questionId))

    return NextResponse.json({ code: 'OK', state, items, statusFilter: 'APPROVED_ONLY' }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'REVIEW_UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
