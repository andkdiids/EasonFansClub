import { countGraphemes } from '@/lib/checkin-mood'
import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import type { AspirinRuleConfig } from '@/lib/aspirin-badge-config'

export type AspirinConsultationFact = {
  id: string
  recordId: string
  authorId: string
  content: unknown
  status: string | null
  deletedAt?: Date | string | null
  createdAt: Date | string
  record: {
    authorId: string
    category: string
    status: string | null
    deletedAt?: Date | string | null
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

/** Read visible text from the actual clinic text formats (plain, HTML, or TipTap JSON). */
export function extractVisibleClinicText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try { return extractVisibleClinicText(JSON.parse(trimmed)) } catch { /* plain text that happens to start with JSON punctuation */ }
    }
    return stripHtml(value)
  }
  if (Array.isArray(value)) return value.map(extractVisibleClinicText).join(' ')
  if (!value || typeof value !== 'object') return ''
  const node = value as Record<string, unknown>
  if (typeof node.text === 'string') return stripHtml(node.text)
  if (Array.isArray(node.content)) return node.content.map(extractVisibleClinicText).join(' ')
  return ''
}

function removeInvisibleAndWhitespace(value: string) {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/gu, '')
}

/** The normalized text used by the minimum-length check. */
export function normalizeAspirinConsultationText(value: unknown) {
  return removeInvisibleAndWhitespace(extractVisibleClinicText(value))
}

/** Count the meaningful characters used by both submission validation and the badge resolver. */
export function getAspirinConsultationLength(value: unknown) {
  return countGraphemes(normalizeAspirinConsultationText(value))
}

export function isValidAspirinConsultation(fact: AspirinConsultationFact, userId: string, config: AspirinRuleConfig) {
  // The consultation must belong to the current user, but a case published by
  // that same user is not an eligible "other user" case for this badge.
  if (fact.authorId !== userId) return false
  if (fact.record.category !== 'ASK_DOCTORS') return false
  if (fact.status !== 'ACTIVE' || fact.record.status !== 'ACTIVE') return false
  if (fact.deletedAt || fact.record.deletedAt) return false
  if (fact.record.authorId === userId) return false
  if (getAspirinConsultationLength(fact.content) < config.minLength) return false
  return true
}

export function getAspirinQualifiedDateKey(value: Date | string) {
  return getShanghaiDateKey(value instanceof Date ? value : new Date(value))
}

/** The daily unit is the user who published the clinic case, not a reply row. */
export function getAspirinProgressKey(fact: AspirinConsultationFact) {
  return fact.record.authorId
}

export function getAspirinDailyQualifiedAuthorIds(facts: readonly AspirinConsultationFact[], userId: string, dateKey: string, config: AspirinRuleConfig) {
  return new Set(
    facts
      .filter((fact) => getAspirinQualifiedDateKey(fact.createdAt) === dateKey && isValidAspirinConsultation(fact, userId, config))
      .map(getAspirinProgressKey),
  )
}

/** @deprecated Use getAspirinDailyQualifiedAuthorIds; retained for callers using the old name. */
export const getAspirinDailyQualifiedCaseIds = getAspirinDailyQualifiedAuthorIds

export function getAspirinDailyProgress(facts: readonly AspirinConsultationFact[], userId: string, dateKey: string, config: AspirinRuleConfig, dailyTarget: number) {
  const authorIds = getAspirinDailyQualifiedAuthorIds(facts, userId, dateKey, config)
  return { current: authorIds.size, target: dailyTarget, authorIds }
}

export function getAspirinQualifiedDateKeys(facts: readonly AspirinConsultationFact[], userId: string, config: AspirinRuleConfig, dailyTarget: number) {
  const authorIdsByDate = new Map<string, Set<string>>()
  for (const fact of facts) {
    if (!isValidAspirinConsultation(fact, userId, config)) continue
    const dateKey = getAspirinQualifiedDateKey(fact.createdAt)
    const authorIds = authorIdsByDate.get(dateKey) || new Set<string>()
    authorIds.add(getAspirinProgressKey(fact))
    authorIdsByDate.set(dateKey, authorIds)
  }
  return new Set([...authorIdsByDate.entries()]
    .filter(([, authorIds]) => authorIds.size >= dailyTarget)
    .map(([dateKey]) => dateKey))
}

/** Longest current run ending on the requested Shanghai natural day. */
export function calculateAspirinCurrentStreak(dateKeys: ReadonlySet<string>, dateKey: string) {
  let streak = 0
  let cursor = dateKey
  while (dateKeys.has(cursor)) {
    streak += 1
    cursor = shiftShanghaiDateKey(cursor, -1)
  }
  return streak
}

export function isAspirinInitialQualificationComplete(
  facts: readonly AspirinConsultationFact[],
  userId: string,
  dateKey: string,
  config: AspirinRuleConfig,
  dailyTarget: number,
) {
  const dates = getAspirinQualifiedDateKeys(facts, userId, config, dailyTarget)
  const today = getAspirinDailyQualifiedAuthorIds(facts, userId, dateKey, config).size >= dailyTarget
  return { dateKeys: dates, streakDays: calculateAspirinCurrentStreak(dates, dateKey), qualifiedToday: today }
}
