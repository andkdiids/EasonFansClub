import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isCantoneseQuestionType, lessonIdForStage, safeReviewIdentifier } from '@/lib/cantonese-review'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const MAX_ROWS_PER_TYPE = 400
const MAX_IMPORT_BYTES = 2_000_000
const STAGES = new Set(['tone-introduction', 'six-tone-practice', 'entering-tone', 'tone-integration', 'real-language', 'graduation'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function bounded(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string') return required ? null : ''
  const trimmed = value.trim()
  return trimmed.length <= max && (!required || Boolean(trimmed)) ? trimmed : null
}

function json(value: unknown, maxLength = 64_000): Prisma.InputJsonValue | null {
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > maxLength) return null
    return JSON.parse(serialized) as Prisma.InputJsonValue
  } catch {
    return null
  }
}

function safeArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const ids = value.map(safeReviewIdentifier)
  return ids.every((id): id is string => id !== null) ? ids : null
}

function stageLesson(stageId: unknown) {
  return typeof stageId === 'string' && STAGES.has(stageId) ? lessonIdForStage(stageId) : null
}

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }

  const rawBody = await request.text().catch(() => '')
  if (new TextEncoder().encode(rawBody).byteLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ ok: false, code: 'IMPORT_TOO_LARGE' }, { status: 413, headers: NO_STORE })
  }
  const body = record((() => { try { return JSON.parse(rawBody) as unknown } catch { return null } })())
  const teachingRows = body?.teaching
  const questionRows = body?.questions
  const audioRows = body?.audio
  if (!body || !Array.isArray(teachingRows) || !Array.isArray(questionRows) || !Array.isArray(audioRows)
    || teachingRows.length > MAX_ROWS_PER_TYPE || questionRows.length > MAX_ROWS_PER_TYPE || audioRows.length > MAX_ROWS_PER_TYPE) {
    return NextResponse.json({ ok: false, code: 'INVALID_IMPORT' }, { status: 400, headers: NO_STORE })
  }

  const teaching: Prisma.CantoneseLessonContentCreateManyInput[] = []
  for (const raw of teachingRows) {
    const item = record(raw)
    const stageId = bounded(item?.stageId, 64, true)
    const lessonId = stageLesson(stageId)
    const externalId = safeReviewIdentifier(item?.externalId)
    const stepId = safeReviewIdentifier(item?.stepId)
    const title = bounded(item?.title, 255, true)
    const text = bounded(item?.body, 100_000, true)
    const displayText = bounded(item?.displayText, 10_000)
    const jyutping = bounded(item?.jyutping, 255)
    const tone = bounded(item?.tone, 64)
    const audioId = item?.audioId === null || item?.audioId === undefined ? null : safeReviewIdentifier(item.audioId)
    const examples = item?.examples === undefined || item.examples === null ? undefined : json(item.examples)
    if (!lessonId || !externalId || !stepId || !title || !text || displayText === null || jyutping === null || tone === null
      || (item?.audioId !== null && item?.audioId !== undefined && !audioId)
      || (item?.examples !== undefined && item.examples !== null && examples === null)) {
      return NextResponse.json({ ok: false, code: 'INVALID_TEACHING_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    teaching.push({ externalId, lessonId, stageId: stageId!, stepId, title, body: text, displayText: displayText || null, jyutping: jyutping || null, tone: tone || null, audioId, examples: examples ?? undefined, status: 'CONTENT_REVIEW_REQUIRED' })
  }

  const questions: Prisma.CantoneseQuestionCreateManyInput[] = []
  for (const raw of questionRows) {
    const item = record(raw)
    const stageId = bounded(item?.stageId, 64, true)
    const lessonId = stageLesson(stageId)
    const externalId = safeReviewIdentifier(item?.externalId)
    const questionType = typeof item?.questionType === 'string' && isCantoneseQuestionType(item.questionType) ? item.questionType : null
    const prompt = bounded(item?.prompt, 20_000, true)
    const explanation = bounded(item?.explanation, 20_000, true)
    const options = json(item?.options)
    const correctAnswer = json(item?.correctAnswer)
    const prerequisiteContentIds = safeArray(item?.prerequisiteContentIds)
    const audioId = item?.audioId === null || item?.audioId === undefined ? null : safeReviewIdentifier(item.audioId)
    const lyricPrescriptionId = item?.lyricPrescriptionId === null || item?.lyricPrescriptionId === undefined ? null : safeReviewIdentifier(item.lyricPrescriptionId)
    if (!lessonId || !externalId || !questionType || !prompt || !explanation || !Array.isArray(item?.options) || options === null
      || correctAnswer === null || prerequisiteContentIds === null
      || (item?.audioId !== null && item?.audioId !== undefined && !audioId)
      || (item?.lyricPrescriptionId !== null && item?.lyricPrescriptionId !== undefined && !lyricPrescriptionId)) {
      return NextResponse.json({ ok: false, code: 'INVALID_QUESTION_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    questions.push({ externalId, lessonId, stageId: stageId!, questionType, prompt, explanation, options, correctAnswer, prerequisiteContentIds, audioId, lyricPrescriptionId, status: 'CONTENT_REVIEW_REQUIRED' })
  }

  const audio: Prisma.CantoneseAudioAssetCreateManyInput[] = []
  for (const raw of audioRows) {
    const item = record(raw)
    const externalId = safeReviewIdentifier(item?.externalId)
    const spokenText = bounded(item?.text, 4000, true)
    const jyutping = bounded(item?.jyutping, 255)
    const stageId = item?.stageId === null || item?.stageId === undefined ? null : bounded(item.stageId, 64, true)
    const lessonId = stageId === null ? null : stageLesson(stageId)
    const contentId = item?.contentId === null || item?.contentId === undefined ? null : safeReviewIdentifier(item.contentId)
    if (!externalId || !spokenText || jyutping === null || (stageId !== null && !lessonId)
      || (item?.contentId !== null && item?.contentId !== undefined && !contentId)) {
      return NextResponse.json({ ok: false, code: 'INVALID_AUDIO_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    audio.push({ externalId, text: spokenText, jyutping: jyutping || null, lessonId, contentId, audioVersion: 'v1', assetStatus: 'NOT_GENERATED', status: 'CONTENT_REVIEW_REQUIRED' })
  }

  try {
    const counts = await prisma.$transaction(async (tx) => {
      const teachingResult = teaching.length ? await tx.cantoneseLessonContent.createMany({ data: teaching, skipDuplicates: true }) : { count: 0 }
      const questionResult = questions.length ? await tx.cantoneseQuestion.createMany({ data: questions, skipDuplicates: true }) : { count: 0 }
      const audioResult = audio.length ? await tx.cantoneseAudioAsset.createMany({ data: audio, skipDuplicates: true }) : { count: 0 }
      return { teaching: teachingResult.count, questions: questionResult.count, audio: audioResult.count }
    })
    return NextResponse.json({ imported: counts, status: 'CONTENT_REVIEW_REQUIRED', existingRecordsPreserved: true }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'CANDIDATE_IMPORT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
