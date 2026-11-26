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

/**
 * The single source of truth for "this consultation row qualifies".
 *
 * Both the badge resolver AND the clinic consultation leaderboard call this, so
 * deleting a row changes every surface identically. Deliberately excludes the
 * viewer dimension: the caller decides whose consultation it is.
 */
export function qualifiesForAspirinConsultation(fact: AspirinConsultationFact, minLength: number) {
  if (fact.record.category !== 'ASK_DOCTORS') return false
  if (fact.status !== 'ACTIVE' || fact.record.status !== 'ACTIVE') return false
  if (fact.deletedAt || fact.record.deletedAt) return false
  // A consultation on your own case never counts as "other user's case".
  if (fact.record.authorId === fact.authorId) return false
  if (getAspirinConsultationLength(fact.content) < minLength) return false
  return true
}

export function isValidAspirinConsultation(fact: AspirinConsultationFact, userId: string, config: AspirinRuleConfig) {
  // The consultation must belong to the current user, but a case published by
  // that same user is not an eligible "other user" case for this badge.
  if (fact.authorId !== userId) return false
  return qualifiesForAspirinConsultation(fact, config.minLength)
}

export function getAspirinQualifiedDateKey(value: Date | string) {
  return getShanghaiDateKey(value instanceof Date ? value : new Date(value))
}

/** The daily unit is the user who published the clinic case, not a reply row. */
export function getAspirinProgressKey(fact: AspirinConsultationFact) {
  return fact.record.authorId
}

export type AspirinPeriodAggregate = {
  userId: string
  /** Distinct case authors this user consulted within the period. */
  count: number
  earliestAt: Date
  latestAt: Date
}

/**
 * Aggregate one period's consultations into per-user, per-case-author-deduped
 * counts — the exact rule the badge uses, so the leaderboard can never drift.
 *
 * Deleting one of several rows against the SAME case author leaves the count
 * unchanged (the distinct key set still contains that author); deleting the only
 * qualifying row drops it by one. This is why a plain `count - 1` is wrong.
 */
export function aggregateAspirinConsultationsForPeriod(
  facts: ReadonlyArray<AspirinConsultationFact>,
  minLength: number,
): Map<string, AspirinPeriodAggregate> {
  const buckets = new Map<string, { keys: Set<string>; earliestAt: Date; latestAt: Date }>()
  for (const fact of facts) {
    if (!qualifiesForAspirinConsultation(fact, minLength)) continue
    const at = fact.createdAt instanceof Date ? fact.createdAt : new Date(fact.createdAt)
    if (Number.isNaN(at.getTime())) continue
    const key = getAspirinProgressKey(fact)
    const bucket = buckets.get(fact.authorId)
    if (bucket) {
      bucket.keys.add(key)
      if (at < bucket.earliestAt) bucket.earliestAt = at
      if (at > bucket.latestAt) bucket.latestAt = at
    } else {
      buckets.set(fact.authorId, { keys: new Set([key]), earliestAt: at, latestAt: at })
    }
  }
  return new Map([...buckets].map(([userId, bucket]) => [
    userId,
    { userId, count: bucket.keys.size, earliestAt: bucket.earliestAt, latestAt: bucket.latestAt },
  ]))
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
