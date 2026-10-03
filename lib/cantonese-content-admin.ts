import type { Prisma } from '@prisma/client'
import { isCantoneseQuestionType, safeReviewIdentifier } from '@/lib/cantonese-review'
import { sanitizeText } from '@/lib/security'

export const CANTONESE_CONTENT_TYPES = [
  'CONCEPT', 'CHARACTER', 'WORD', 'SENTENCE', 'DIALOGUE', 'CONTRAST', 'SUMMARY', 'SPEAKING_PRACTICE',
] as const

export const CANTONESE_AUDIO_CODECS = ['mp3'] as const

/** A teaching step that promises playback cannot be published without its reviewed asset. */
export function teachingAudioReady(
  content: { requiresAudio: boolean; requiresSpeaking: boolean; audioId: string | null },
  audio: { externalId: string; status: string; assetStatus: string; cosKey: string | null; checksum: string | null; fileSize: number | null } | null,
): boolean {
  if (content.requiresSpeaking && !content.requiresAudio) return false
  if (!content.requiresAudio) return true
  return Boolean(
    content.audioId && audio?.externalId === content.audioId
      && audio.status === 'APPROVED' && audio.assetStatus === 'READY'
      && audio.cosKey && audio.checksum && audio.fileSize && audio.fileSize > 0,
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function objectBody(value: unknown) {
  return record(value)
}

export function boundedText(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string') return required ? null : ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return required ? null : ''
  return sanitizeText(trimmed, max)
}

export function optionalIdentifier(value: unknown, max = 191): string | null {
  if (value === undefined || value === null || value === '') return null
  const normalized = safeReviewIdentifier(value)
  return normalized && normalized.length <= max ? normalized : null
}

export function jsonValue(value: unknown, maxBytes = 128_000): Prisma.InputJsonValue | null {
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > maxBytes) return null
    return JSON.parse(serialized) as Prisma.InputJsonValue
  } catch {
    return null
  }
}

export function identifierArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const result = value.map((item) => safeReviewIdentifier(item))
  return result.every((item): item is string => Boolean(item)) ? result : null
}

export function nonNegativeInteger(value: unknown, fallback = 0): number | null {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

export function parseContentType(value: unknown) {
  return typeof value === 'string' && CANTONESE_CONTENT_TYPES.includes(value as (typeof CANTONESE_CONTENT_TYPES)[number])
    ? value
    : null
}

export function parseTeachingCreate(value: unknown): {
  externalId: string
  lessonId: string
  stageId: string
  stepId: string
  title: string
  body: string
  displayText: string | null
  jyutping: string | null
  tone: string | null
  examples?: Prisma.InputJsonValue
  audioId: string | null
  contentType: string
  translation: string | null
  explanation: string | null
  sortOrder: number
  requiresAudio: boolean
  requiresSpeaking: boolean
} | null {
  const body = record(value)
  if (!body) return null
  const externalId = safeReviewIdentifier(body.externalId)
  const lessonId = boundedText(body.lessonId, 32, true)
  const stageId = boundedText(body.stageId, 64, true)
  const stepId = boundedText(body.stepId, 100, true)
  const title = boundedText(body.title, 255, true)
  const text = boundedText(body.body, 100_000, true)
  const displayText = body.displayText === undefined || body.displayText === null ? null : boundedText(body.displayText, 10_000)
  const jyutping = body.jyutping === undefined || body.jyutping === null ? null : boundedText(body.jyutping, 255)
  const tone = body.tone === undefined || body.tone === null ? null : boundedText(body.tone, 64)
  const translation = body.translation === undefined || body.translation === null ? null : boundedText(body.translation, 10_000)
  const explanation = body.explanation === undefined || body.explanation === null ? null : boundedText(body.explanation, 20_000)
  const contentType = parseContentType(body.contentType) || 'CONCEPT'
  const requiresAudio = body.requiresAudio === true
  const requiresSpeaking = body.requiresSpeaking === true
  const sortOrder = nonNegativeInteger(body.sortOrder)
  const examples = body.examples === undefined || body.examples === null ? undefined : jsonValue(body.examples)
  const audioId = optionalIdentifier(body.audioId)
  if (!externalId || !lessonId || !stageId || !stepId || !title || !text || sortOrder === null
    || (body.contentType !== undefined && !parseContentType(body.contentType))
    || (requiresSpeaking && !requiresAudio)
    || ((requiresAudio || requiresSpeaking) && (!displayText?.trim() || displayText.length > 4000))
    || (body.displayText !== undefined && body.displayText !== null && displayText === null)
    || (body.jyutping !== undefined && body.jyutping !== null && jyutping === null)
    || (body.tone !== undefined && body.tone !== null && tone === null)
    || (body.translation !== undefined && body.translation !== null && translation === null)
    || (body.explanation !== undefined && body.explanation !== null && explanation === null)
    || (body.examples !== undefined && body.examples !== null && examples === null)
    || (body.audioId !== undefined && body.audioId !== null && body.audioId !== '' && !audioId)) return null
  return {
    externalId, lessonId, stageId, stepId, title, body: text, displayText, jyutping, tone,
    ...(examples === undefined || examples === null ? {} : { examples }), audioId, contentType, translation, explanation, sortOrder,
    requiresAudio, requiresSpeaking,
  }
}

export function parseQuestionCreate(value: unknown): {
  externalId: string
  lessonId: string
  stageId: string
  questionType: string
  prompt: string
  options: Prisma.InputJsonValue
  correctAnswer: Prisma.InputJsonValue
  explanation: string
  prerequisiteContentIds: Prisma.InputJsonValue
  audioId: string | null
  speakingReferenceId: string | null
  lyricPrescriptionId: string | null
  sortOrder: number
} | null {
  const body = record(value)
  if (!body) return null
  const externalId = safeReviewIdentifier(body.externalId)
  const lessonId = boundedText(body.lessonId, 32, true)
  const stageId = boundedText(body.stageId, 64, true)
  const questionType = isCantoneseQuestionType(body.questionType) ? body.questionType : null
  const prompt = boundedText(body.prompt, 20_000, true)
  const explanation = boundedText(body.explanation, 20_000, true)
  const options = Array.isArray(body.options) ? jsonValue(body.options) : null
  const correctAnswer = jsonValue(body.correctAnswer)
  const prerequisiteContentIds = identifierArray(body.prerequisiteContentIds)
  const prereqJson = prerequisiteContentIds ? jsonValue(prerequisiteContentIds) : null
  const audioId = optionalIdentifier(body.audioId)
  const speakingReferenceId = optionalIdentifier(body.speakingReferenceId)
  const lyricPrescriptionId = optionalIdentifier(body.lyricPrescriptionId)
  const sortOrder = nonNegativeInteger(body.sortOrder)
  if (questionType === 'MULTI_SELECT' && (!Array.isArray(body.correctAnswer) || body.correctAnswer.length < 2 || !body.correctAnswer.every((answer: unknown) => typeof answer === 'string'))) return null
  if (!externalId || !lessonId || !stageId || !questionType || !prompt || !explanation
    || options === null || correctAnswer === null || prereqJson === null || sortOrder === null) return null
  return { externalId, lessonId, stageId, questionType, prompt, options, correctAnswer,
    explanation, prerequisiteContentIds: prereqJson, audioId, speakingReferenceId, lyricPrescriptionId, sortOrder }
}

export function parseAudioCreate(value: unknown): {
  externalId: string
  text: string
  jyutping: string | null
  lessonId: string | null
  contentId: string | null
  audioVersion: string
  voiceProfile: string
  speed: number | null
  sampleRate: number
  codec: 'mp3'
  notes: string | null
} | null {
  const body = record(value)
  if (!body) return null
  const externalId = safeReviewIdentifier(body.externalId)
  const text = boundedText(body.text, 4000, true)
  const jyutping = body.jyutping === undefined || body.jyutping === null ? null : boundedText(body.jyutping, 255)
  const lessonId = body.lessonId === undefined || body.lessonId === null || body.lessonId === '' ? null : boundedText(body.lessonId, 32, true)
  const contentId = optionalIdentifier(body.contentId)
  const audioVersion = boundedText(body.audioVersion ?? 'v1', 32, true)
  const voiceProfile = boundedText(body.voiceProfile ?? '101019', 64, true)
  const speedRaw = body.speed === undefined || body.speed === null || body.speed === '' ? null : Number(body.speed)
  const speed = speedRaw === null ? null : Number.isFinite(speedRaw) && speedRaw >= -2 && speedRaw <= 6 ? speedRaw : NaN
  const sampleRate = Number(body.sampleRate ?? 16000)
  const codec = String(body.codec ?? 'mp3').toLowerCase()
  const notes = body.notes === undefined || body.notes === null ? null : boundedText(body.notes, 10_000)
  if (!externalId || !text || audioVersion === null || voiceProfile === null || speed !== speed
    || !Number.isInteger(sampleRate) || ![8000, 16000].includes(sampleRate) || codec !== 'mp3'
    || (body.jyutping !== undefined && body.jyutping !== null && jyutping === null)
    || (body.lessonId !== undefined && body.lessonId !== null && body.lessonId !== '' && lessonId === null)
    || (body.notes !== undefined && body.notes !== null && notes === null)) return null
  return { externalId, text, jyutping, lessonId, contentId, audioVersion, voiceProfile, speed,
    sampleRate, codec: 'mp3', notes }
}

export function publicAudioAsset<T extends { cosKey: string | null; audioKey?: string | null }>(asset: T) {
  const safeAsset = { ...asset }
  delete (safeAsset as { cosKey?: string | null; audioKey?: string | null }).cosKey
  delete (safeAsset as { cosKey?: string | null; audioKey?: string | null }).audioKey
  return { ...safeAsset, serverSupported: Boolean(asset.cosKey) }
}
