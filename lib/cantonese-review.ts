export const CANTONESE_REVIEW_STATUSES = [
  'DRAFT',
  'CONTENT_REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
] as const

export type CantoneseReviewStatus = (typeof CANTONESE_REVIEW_STATUSES)[number]
export type CantoneseReviewEntityType = 'teaching' | 'question' | 'audio'
export type CantoneseReviewAction = 'approve' | 'reject' | 'edit' | 'mark-needs-regeneration' | 'verify-jyutping' | 'revoke-jyutping'

export function parseCantoneseReviewStatus(value: string | null): CantoneseReviewStatus | 'ALL' {
  if (value === 'ALL') return 'ALL'
  return CANTONESE_REVIEW_STATUSES.find((status) => status === value) || 'CONTENT_REVIEW_REQUIRED'
}

export function parseCantoneseReviewEntityType(value: string | null): CantoneseReviewEntityType | null {
  return value === 'teaching' || value === 'question' || value === 'audio' ? value : null
}

export function parseCantoneseReviewAction(value: unknown): CantoneseReviewAction | null {
  return value === 'approve' || value === 'reject' || value === 'edit' || value === 'mark-needs-regeneration' || value === 'verify-jyutping' || value === 'revoke-jyutping'
    ? value
    : null
}

export function nextCantoneseReviewStatus(
  current: CantoneseReviewStatus,
  action: Exclude<CantoneseReviewAction, 'mark-needs-regeneration' | 'verify-jyutping' | 'revoke-jyutping'>,
): CantoneseReviewStatus {
  if (action === 'approve') return 'APPROVED'
  if (action === 'reject') return 'REJECTED'
  // Edits always require a fresh review, including edits to already approved content.
  return current === 'DRAFT' ? 'DRAFT' : 'CONTENT_REVIEW_REQUIRED'
}

export function safeReviewIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 191 || /[\u0000-\u001f]/.test(normalized)) return null
  return normalized
}

export function safeReviewReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 2000) return null
  return normalized
}

/** Increment the public cache version whenever synthesis inputs change. */
export function nextCantoneseAudioVersion(current: string) {
  const match = /^v(\d+)$/.exec(current.trim())
  if (match) return `v${Number(match[1]) + 1}`
  return `${current.trim().slice(0, 27)}-r2`
}

export const CANTONESE_QUESTION_TYPES = [
  'SINGLE_SELECT', 'MULTI_SELECT', 'LISTENING', 'TRUE_FALSE', 'MATCH', 'ORDER', 'FILL', 'SPEAKING',
  'JYUTPING', 'TONE', 'LYRIC_VOCAB', 'LYRIC_GRAMMAR',
] as const

export function isCantoneseQuestionType(value: unknown): value is (typeof CANTONESE_QUESTION_TYPES)[number] {
  return typeof value === 'string' && CANTONESE_QUESTION_TYPES.includes(value as (typeof CANTONESE_QUESTION_TYPES)[number])
}

export function lessonIdForStage(stageId: string): string | null {
  const stages = ['tone-introduction', 'six-tone-practice', 'entering-tone', 'tone-integration', 'real-language', 'graduation']
  const index = stages.indexOf(stageId)
  return index < 0 ? null : `lesson-${String(index + 1).padStart(2, '0')}`
}

export function isBatchApprovalAllowed(input: {
  type: CantoneseReviewEntityType
  questionType?: string | null
  audioId?: string | null
  lyricPrescriptionId?: string | null
  prompt?: string | null
  explanation?: string | null
}) {
  if (input.type !== 'question') return false
  const languageSensitive = /粤语|粤拼|声调|调值|入声|发音|读音|韵尾|语法|词汇|拼音|口语|jyutping|tone/i
  if (languageSensitive.test(`${input.prompt || ''} ${input.explanation || ''}`)) return false
  return (input.questionType === 'SINGLE_SELECT' || input.questionType === 'TRUE_FALSE')
    && !input.audioId
    && !input.lyricPrescriptionId
}
