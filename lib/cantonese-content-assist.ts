import { createHash } from 'node:crypto'
import { lessonIdForStage } from '@/lib/cantonese-review'

export const CANTONESE_STAGES = [
  'tone-introduction', 'six-tone-practice', 'entering-tone',
  'tone-integration', 'real-language', 'graduation',
] as const

export type ApprovedMatch = {
  externalId: string
  displayText: string | null
  body: string
  jyutping: string | null
  contentType: string
  lessonId: string
  stageId: string
  requiresAudio: boolean
  requiresSpeaking: boolean
}

export function suggestedContentType(text: string) {
  if (/[^\n]+[:：][^\n]+(?:\n|$)/u.test(text) && text.includes('\n')) return 'DIALOGUE'
  if (/^(今日|聽日|琴日)/u.test(text) || /咗.+未[？?]?$/u.test(text)) return 'SENTENCE'
  if (/[。！？!?]/u.test(text) || text.length > 12) return 'SENTENCE'
  if ([...text].length === 1) return 'CHARACTER'
  return 'WORD'
}

export function exactApprovedMatch(text: string, matches: ApprovedMatch[]) {
  return matches.find((item) => item.displayText?.trim() === text || item.body.trim() === text) ?? null
}

export function reliableJyutping(text: string, matches: ApprovedMatch[]) {
  const values = [...new Set(matches
    .filter((item) => item.displayText?.trim() === text || item.body.trim() === text)
    .map((item) => item.jyutping?.trim())
    .filter((value): value is string => Boolean(value)))]
  return values.length === 1 ? values[0] : null
}

export function suggestedStage(type: string, match: ApprovedMatch | null, requestedStage?: string | null) {
  if (requestedStage && CANTONESE_STAGES.includes(requestedStage as (typeof CANTONESE_STAGES)[number])) return requestedStage
  if (match && CANTONESE_STAGES.includes(match.stageId as (typeof CANTONESE_STAGES)[number])) return match.stageId
  return type === 'DIALOGUE' || type === 'SENTENCE' ? 'real-language' : 'tone-introduction'
}

export function contentIdBase(text: string, stageId: string) {
  const hash = createHash('sha256').update(`${stageId}\u0000${text}`).digest('hex').slice(0, 16)
  return `assist-${hash}`
}

export function freeContentId(base: string, usedIds: Set<string>) {
  for (let suffix = 0; suffix < 10000; suffix++) {
    const id = suffix === 0 ? base : `${base}-${suffix + 1}`
    if (!usedIds.has(id) && !usedIds.has(`${id}.audio`)) return id
  }
  return null
}

export function assistSuggestion(input: {
  text: string
  title?: string | null
  stageId?: string | null
  matches: ApprovedMatch[]
  usedIds: Set<string>
  nextSortOrder: number
}) {
  const match = exactApprovedMatch(input.text, input.matches)
  const contentType = match?.contentType || suggestedContentType(input.text)
  const stageId = suggestedStage(contentType, match, input.stageId)
  const lessonId = lessonIdForStage(stageId)!
  const externalId = freeContentId(contentIdBase(input.text, stageId), input.usedIds)
  if (!externalId) return null
  const requiresSpeaking = match?.requiresSpeaking === true || ['SENTENCE', 'DIALOGUE', 'SPEAKING_PRACTICE'].includes(contentType)
  const requiresAudio = requiresSpeaking || match?.requiresAudio === true || ['CHARACTER', 'WORD', 'SENTENCE', 'DIALOGUE'].includes(contentType)
  const jyutping = reliableJyutping(input.text, input.matches)
  return {
    externalId,
    stepId: externalId,
    lessonId,
    stageId,
    sectionId: stageId,
    title: input.title?.trim() || match?.body.trim().slice(0, 100) || input.text.slice(0, 100),
    body: input.text,
    displayText: input.text,
    jyutping,
    jyutpingNeedsConfirmation: jyutping === null,
    contentType,
    sortOrder: input.nextSortOrder,
    audioId: requiresAudio ? `${externalId}.audio` : null,
    requiresAudio,
    requiresSpeaking,
    source: match ? { kind: 'EXACT_APPROVED', contentId: match.externalId } : { kind: 'LOCAL_RULE' },
    status: 'CONTENT_REVIEW_REQUIRED' as const,
  }
}
