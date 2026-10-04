import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { isCantoneseQuestionType, safeReviewIdentifier } from '@/lib/cantonese-review'
import { parseContentType } from '@/lib/cantonese-content-admin'
import { validateCantoneseQuestionQuality } from '@/lib/cantonese-question-quality'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const MAX_ROWS_PER_TYPE = 400
const MAX_IMPORT_BYTES = 2_000_000
const STAGE_LESSONS: Record<string, string> = {
  'tone-introduction': 'lesson-01',
  'six-tone-practice': 'lesson-02',
  'entering-tone': 'lesson-03',
  'tone-integration': 'lesson-04',
  'real-language': 'lesson-05',
  'graduation': 'lesson-06',
  'greetings-basic': 'lesson-05',
  'directions-travel': 'lesson-06',
  'restaurant-ordering': 'lesson-07',
}

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
  return typeof stageId === 'string' ? STAGE_LESSONS[stageId] || null : null
}

function matchingLesson(explicit: unknown, inferred: string | null, definedLessonIds: Set<string>) {
  if (inferred) return explicit === undefined || explicit === inferred ? inferred : null
  return typeof explicit === 'string' && definedLessonIds.has(explicit) ? explicit : null
}

function uniqueExternalIds(rows: { externalId: string }[]) {
  return new Set(rows.map((row) => row.externalId)).size === rows.length
}

function lessonNumber(lessonId: string) {
  const match = /^lesson-(0[1-9]|[1-9][0-9])$/.exec(lessonId)
  return match ? Number(match[1]) : null
}

export function parseCandidateImport(rawBody: string) {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ ok: false, code: 'IMPORT_TOO_LARGE' }, { status: 413, headers: NO_STORE })
  }
  const body = record((() => { try { return JSON.parse(rawBody) as unknown } catch { return null } })())
  const teachingRows = body?.teaching
  const questionRows = body?.questions
  const audioRows = body?.audio
  const definitionRows = body?.definitions ?? []
  const selectedLessonId = body?.selectedLessonId === undefined ? null : bounded(body.selectedLessonId, 32, true)
  const updateExistingCandidates = body?.updateExistingCandidates === true
  if (!body || !Array.isArray(teachingRows) || !Array.isArray(questionRows) || !Array.isArray(audioRows) || !Array.isArray(definitionRows)
    || teachingRows.length > MAX_ROWS_PER_TYPE || questionRows.length > MAX_ROWS_PER_TYPE || audioRows.length > MAX_ROWS_PER_TYPE || definitionRows.length > 99
    || (selectedLessonId !== null && !/^lesson-(0[1-9]|[1-9][0-9])$/.test(selectedLessonId))) {
    return NextResponse.json({ ok: false, code: 'INVALID_IMPORT' }, { status: 400, headers: NO_STORE })
  }

  const definitions: Prisma.CantoneseCourseDefinitionCreateManyInput[] = []
  for (const raw of definitionRows) {
    const item = record(raw)
    const lessonId = bounded(item?.lessonId, 32, true)
    const number = lessonId ? lessonNumber(lessonId) : null
    const title = bounded(item?.title, 255, true)
    const subtitle = item?.subtitle === null || item?.subtitle === undefined ? '' : bounded(item.subtitle, 255)
    const description = bounded(item?.description, 10_000, true)
    const sortOrder = item?.sortOrder === undefined ? number : Number(item.sortOrder)
    const prerequisiteLessonId = item?.prerequisiteLessonId === null || item?.prerequisiteLessonId === undefined ? null : bounded(item.prerequisiteLessonId, 32, true)
    const expectedPrerequisite = number === 1 ? null : number ? `lesson-${String(number - 1).padStart(2, '0')}` : null
    if (!lessonId || number === null || item?.lessonNumber !== number || !title || subtitle === null || !description
      || !Number.isSafeInteger(sortOrder) || (sortOrder as number) < 0
      || (prerequisiteLessonId !== null && (lessonNumber(prerequisiteLessonId) === null || prerequisiteLessonId === lessonId))
      || prerequisiteLessonId !== expectedPrerequisite) {
      return NextResponse.json({ ok: false, code: 'INVALID_COURSE_DEFINITION_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    definitions.push({ lessonId, lessonNumber: number, title, subtitle: subtitle || null, description, sortOrder: sortOrder as number, prerequisiteLessonId, status: 'CONTENT_REVIEW_REQUIRED' })
  }
  const definedLessonIds = new Set(definitions.map((row) => row.lessonId))
  if (selectedLessonId !== null && !definedLessonIds.has(selectedLessonId) && !Object.values(STAGE_LESSONS).includes(selectedLessonId)) {
    return NextResponse.json({ ok: false, code: 'UNKNOWN_SELECTED_LESSON' }, { status: 400, headers: NO_STORE })
  }

  const teaching: Prisma.CantoneseLessonContentCreateManyInput[] = []
  for (const raw of teachingRows) {
    const item = record(raw)
    const stageId = bounded(item?.stageId, 64, true)
    const lessonId = matchingLesson(item?.lessonId, stageLesson(stageId), definedLessonIds)
    const externalId = safeReviewIdentifier(item?.externalId)
    const stepId = safeReviewIdentifier(item?.stepId)
    const title = bounded(item?.title, 255, true)
    const text = bounded(item?.body, 100_000, true)
    const displayText = bounded(item?.displayText, 10_000)
    const jyutping = bounded(item?.jyutping, 255)
    const tone = bounded(item?.tone, 64)
    const contentType = item?.contentType === undefined ? 'CONCEPT' : parseContentType(item.contentType)
    const translation = bounded(item?.translation, 10_000)
    const explanation = bounded(item?.explanation, 20_000)
    const section = bounded(item?.section, 100)
    const usageNote = bounded(item?.usageNote, 10_000)
    const sourceReference = bounded(item?.sourceReference, 2_000)
    const dialogueId = bounded(item?.dialogueId, 100)
    const speaker = bounded(item?.speaker, 16)
    const contentVersion = item?.version === undefined ? 1 : Number(item.version)
    const sortOrder = item?.sortOrder === undefined ? 0 : Number(item.sortOrder)
    const audioId = item?.audioId === null || item?.audioId === undefined ? null : safeReviewIdentifier(item.audioId)
    const examples = item?.examples === undefined || item.examples === null ? undefined : json(item.examples)
    const requiresAudio = item?.requiresAudio === true
    const requiresSpeaking = item?.requiresSpeaking === true
    if (!lessonId || !externalId || !stepId || !title || !text || !contentType || displayText === null || jyutping === null || tone === null || translation === null || explanation === null || section === null || usageNote === null || sourceReference === null || dialogueId === null || speaker === null || !Number.isSafeInteger(contentVersion) || contentVersion < 1 || !Number.isSafeInteger(sortOrder) || sortOrder < 0
      || (requiresSpeaking && !requiresAudio)
      || ((requiresAudio || requiresSpeaking) && (!displayText?.trim() || displayText.length > 4000))
      || (item?.audioId !== null && item?.audioId !== undefined && !audioId)
      || (item?.examples !== undefined && item.examples !== null && examples === null)) {
      return NextResponse.json({ ok: false, code: 'INVALID_TEACHING_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    teaching.push({ externalId, lessonId, stageId: stageId!, stepId, title, body: text, displayText: displayText || null, jyutping: jyutping || null, tone: tone || null, examples: examples ?? undefined, audioId, contentType, translation: translation || null, explanation: explanation || null, section: section || null, usageNote: usageNote || null, sourceReference: sourceReference || null, dialogueId: dialogueId || null, speaker: speaker || null, contentVersion, sortOrder, requiresAudio, requiresSpeaking, reviewNote: (requiresAudio || requiresSpeaking) ? 'JYUTPING_REVIEW_REQUIRED' : null, status: 'CONTENT_REVIEW_REQUIRED' })
  }

  const questions: Prisma.CantoneseQuestionCreateManyInput[] = []
  for (const raw of questionRows) {
    const item = record(raw)
    const stageId = bounded(item?.stageId, 64, true)
    const lessonId = matchingLesson(item?.lessonId, stageLesson(stageId), definedLessonIds)
    const externalId = safeReviewIdentifier(item?.externalId)
    const questionType = typeof item?.questionType === 'string' && isCantoneseQuestionType(item.questionType) ? item.questionType : null
    const prompt = bounded(item?.prompt, 20_000, true)
    const explanation = bounded(item?.explanation, 20_000, true)
    const sourceReference = bounded(item?.sourceReference, 2_000)
    const contentVersion = item?.version === undefined ? 1 : Number(item.version)
    const options = json(item?.options)
    const correctAnswer = json(item?.correctAnswer)
    const prerequisiteContentIds = safeArray(item?.prerequisiteContentIds)
    const audioId = item?.audioId === null || item?.audioId === undefined ? null : safeReviewIdentifier(item.audioId)
    const speakingReferenceId = item?.speakingReferenceId === null || item?.speakingReferenceId === undefined ? null : safeReviewIdentifier(item.speakingReferenceId)
    const lyricPrescriptionId = item?.lyricPrescriptionId === null || item?.lyricPrescriptionId === undefined ? null : safeReviewIdentifier(item.lyricPrescriptionId)
    const sortOrder = item?.sortOrder === undefined ? 0 : Number(item.sortOrder)
    if (!lessonId || !externalId || !questionType || !prompt || !explanation || sourceReference === null || !Number.isSafeInteger(contentVersion) || contentVersion < 1 || !Array.isArray(item?.options) || options === null
      || correctAnswer === null || prerequisiteContentIds === null
      || !Number.isSafeInteger(sortOrder) || sortOrder < 0
      || (item?.audioId !== null && item?.audioId !== undefined && !audioId)
      || (item?.speakingReferenceId !== null && item?.speakingReferenceId !== undefined && !speakingReferenceId)
      || (item?.lyricPrescriptionId !== null && item?.lyricPrescriptionId !== undefined && !lyricPrescriptionId)) {
      return NextResponse.json({ ok: false, code: 'INVALID_QUESTION_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    if (externalId.startsWith('cantonese.v6.question.')) {
      const qualityCode = validateCantoneseQuestionQuality({ questionType, options: item.options, correctAnswer: item.correctAnswer, audioId, speakingReferenceId })
      if (qualityCode) return NextResponse.json({ ok: false, code: 'INVALID_V6_QUESTION', reason: qualityCode }, { status: 400, headers: NO_STORE })
    }
    questions.push({ externalId, lessonId, stageId: stageId!, questionType, prompt, explanation, sourceReference: sourceReference || null, contentVersion, options, correctAnswer, prerequisiteContentIds, audioId, speakingReferenceId, lyricPrescriptionId, sortOrder, status: 'CONTENT_REVIEW_REQUIRED' })
  }

  const audio: Prisma.CantoneseAudioAssetCreateManyInput[] = []
  for (const raw of audioRows) {
    const item = record(raw)
    const externalId = safeReviewIdentifier(item?.externalId)
    const spokenText = bounded(item?.text, 4000, true)
    const jyutping = bounded(item?.jyutping, 255)
    const stageId = item?.stageId === null || item?.stageId === undefined ? null : bounded(item.stageId, 64, true)
    const lessonId = stageId === null ? null : matchingLesson(item?.lessonId, stageLesson(stageId), definedLessonIds)
    const contentId = item?.contentId === null || item?.contentId === undefined ? null : safeReviewIdentifier(item.contentId)
    const audioVersion = bounded(item?.audioVersion ?? 'v1', 32, true)
    const voiceProfile = bounded(item?.voiceProfile ?? '101019', 64, true)
    const speed = item?.speed === undefined || item?.speed === null || item?.speed === '' ? null : Number(item.speed)
    const sampleRate = item?.sampleRate === undefined ? 16000 : Number(item.sampleRate)
    const codec = String(item?.codec ?? 'mp3').toLowerCase()
    const notes = bounded(item?.notes, 10_000)
    if (!externalId || !spokenText || jyutping === null || (stageId !== null && !lessonId)
      || (item?.contentId !== null && item?.contentId !== undefined && !contentId)
      || !audioVersion || !voiceProfile || (speed !== null && (!Number.isFinite(speed) || speed < -2 || speed > 6))
      || !Number.isSafeInteger(sampleRate) || ![8000, 16000].includes(sampleRate) || codec !== 'mp3' || notes === null) {
      return NextResponse.json({ ok: false, code: 'INVALID_AUDIO_IMPORT' }, { status: 400, headers: NO_STORE })
    }
    audio.push({ externalId, text: spokenText, jyutping: jyutping || null, lessonId, contentId, audioVersion, voiceProfile, speed, sampleRate, codec, notes: notes || null, assetStatus: 'NOT_GENERATED', reviewNote: 'JYUTPING_REVIEW_REQUIRED', status: 'CONTENT_REVIEW_REQUIRED' })
  }

  if (!uniqueExternalIds(teaching) || !uniqueExternalIds(questions) || !uniqueExternalIds(audio)
    || new Set(definitions.map((row) => row.lessonId)).size !== definitions.length) {
    return NextResponse.json({ ok: false, code: 'DUPLICATE_EXTERNAL_ID' }, { status: 400, headers: NO_STORE })
  }
  const teachingById = new Map(teaching.map((row) => [row.externalId, row]))
  const audioById = new Map(audio.map((row) => [row.externalId, row]))
  for (const item of teaching.filter((row) => row.externalId.startsWith('cantonese.v6.content.') && (row.requiresAudio || row.requiresSpeaking))) {
    const asset = item.audioId ? audioById.get(item.audioId) : null
    if (!asset || asset.contentId !== item.externalId || asset.lessonId !== item.lessonId
      || asset.text !== item.displayText || asset.jyutping !== item.jyutping) {
      return NextResponse.json({ ok: false, code: 'INVALID_V6_TEACHING_AUDIO_LINK' }, { status: 400, headers: NO_STORE })
    }
  }
  for (const question of questions.filter((row) => row.externalId.startsWith('cantonese.v6.question.'))) {
    const raw = questionRows.find((row) => record(row)?.externalId === question.externalId)
    const item = record(raw)
    const prerequisites = question.prerequisiteContentIds as string[]
    if (prerequisites.some((id) => !teachingById.has(id) || teachingById.get(id)?.lessonId !== question.lessonId)) {
      return NextResponse.json({ ok: false, code: 'INVALID_V6_QUESTION_PREREQUISITE' }, { status: 400, headers: NO_STORE })
    }
    if (question.audioId && (!audioById.has(question.audioId) || audioById.get(question.audioId)?.lessonId !== question.lessonId)) {
      return NextResponse.json({ ok: false, code: 'INVALID_V6_QUESTION_AUDIO' }, { status: 400, headers: NO_STORE })
    }
    if (question.audioId && question.questionType === 'SPEAKING'
      && audioById.get(question.audioId)?.contentId !== question.speakingReferenceId) {
      return NextResponse.json({ ok: false, code: 'INVALID_V6_SPEAKING_AUDIO_CONTENT' }, { status: 400, headers: NO_STORE })
    }
    if (question.questionType === 'SPEAKING') {
      const spoken = question.speakingReferenceId ? teachingById.get(question.speakingReferenceId) : null
      if (!spoken || spoken.lessonId !== question.lessonId || !spoken.requiresSpeaking || spoken.audioId !== question.audioId) {
        return NextResponse.json({ ok: false, code: 'INVALID_V6_SPEAKING_REFERENCE' }, { status: 400, headers: NO_STORE })
      }
    }
    if (question.questionType === 'LISTENING' && (!question.audioId || !item || !audioById.has(question.audioId))) {
      return NextResponse.json({ ok: false, code: 'INVALID_V6_LISTENING_AUDIO' }, { status: 400, headers: NO_STORE })
    }
  }
  return {
    definitions: selectedLessonId ? definitions.filter((row) => row.lessonId === selectedLessonId) : definitions,
    teaching: selectedLessonId ? teaching.filter((row) => row.lessonId === selectedLessonId) : teaching,
    questions: selectedLessonId ? questions.filter((row) => row.lessonId === selectedLessonId) : questions,
    audio: selectedLessonId ? audio.filter((row) => row.lessonId === selectedLessonId) : audio,
    selectedLessonId,
    updateExistingCandidates,
  }
}
