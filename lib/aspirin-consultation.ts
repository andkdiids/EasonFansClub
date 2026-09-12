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

function isPunctuationOrSymbol(value: string) {
  return /^[\p{P}\p{S}\s]+$/u.test(value)
}

function splitGraphemes(value: string) {
  try {
    const Segmenter = (Intl as typeof Intl & {
      Segmenter?: new (locales?: string | string[], options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> }
    }).Segmenter
    if (Segmenter) return Array.from(new Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value), (item) => item.segment)
  } catch { /* Array.from below is a safe fallback for older runtimes. */ }
  return Array.from(value)
}

/** The normalized text used by both the length and anti-repeat checks. */
export function normalizeAspirinConsultationText(value: unknown) {
  return removeInvisibleAndWhitespace(extractVisibleClinicText(value))
}

/** Punctuation is ignored for repetition so repeated punctuation cannot mask a low-value answer. */
export function normalizeAspirinRepeatText(value: unknown) {
  const normalized = normalizeAspirinConsultationText(value).toLocaleLowerCase('en-US')
  return splitGraphemes(normalized).filter((grapheme) => !isPunctuationOrSymbol(grapheme)).join('')
}

export function calculateAspirinRepeatRate(value: unknown) {
  const normalized = normalizeAspirinRepeatText(value)
  if (!normalized) return 1
  const counts = new Map<string, number>()
  const graphemes = splitGraphemes(normalized)
  for (const grapheme of graphemes) counts.set(grapheme, (counts.get(grapheme) || 0) + 1)
  const mostCommon = Math.max(...counts.values())
  return mostCommon / graphemes.length
}

export function isValidAspirinConsultation(fact: AspirinConsultationFact, userId: string, config: AspirinRuleConfig) {
  // The Aspirin badge counts the current user's valid clinic consultations.
  // Whether the case was opened by the same user is not a badge qualification
  // condition; keep the relation available for clinic business logic, but do
  // not exclude the consultation from progress or streak qualification.
  if (fact.authorId !== userId) return false
  if (fact.record.category !== 'ASK_DOCTORS') return false
  if (fact.status !== 'ACTIVE' || fact.record.status !== 'ACTIVE') return false
  if (fact.deletedAt || fact.record.deletedAt) return false
  const text = normalizeAspirinConsultationText(fact.content)
  if (countGraphemes(text) < config.minLength) return false
  return calculateAspirinRepeatRate(text) < config.maxRepeatRate
}

export function getAspirinQualifiedDateKey(value: Date | string) {
  return getShanghaiDateKey(value instanceof Date ? value : new Date(value))
}

export function getAspirinDailyQualifiedCaseIds(facts: readonly AspirinConsultationFact[], userId: string, dateKey: string, config: AspirinRuleConfig) {
  return new Set(
    facts
      .filter((fact) => getAspirinQualifiedDateKey(fact.createdAt) === dateKey && isValidAspirinConsultation(fact, userId, config))
      .map((fact) => fact.recordId),
  )
}

export function getAspirinDailyProgress(facts: readonly AspirinConsultationFact[], userId: string, dateKey: string, config: AspirinRuleConfig, dailyTarget: number) {
  const caseIds = getAspirinDailyQualifiedCaseIds(facts, userId, dateKey, config)
  return { current: caseIds.size, target: dailyTarget, caseIds }
}

export function getAspirinQualifiedDateKeys(facts: readonly AspirinConsultationFact[], userId: string, config: AspirinRuleConfig, dailyTarget: number) {
  const caseIdsByDate = new Map<string, Set<string>>()
  for (const fact of facts) {
    if (!isValidAspirinConsultation(fact, userId, config)) continue
    const dateKey = getAspirinQualifiedDateKey(fact.createdAt)
    const caseIds = caseIdsByDate.get(dateKey) || new Set<string>()
    caseIds.add(fact.recordId)
    caseIdsByDate.set(dateKey, caseIds)
  }
  return new Set([...caseIdsByDate.entries()]
    .filter(([, caseIds]) => caseIds.size >= dailyTarget)
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
  const today = getAspirinDailyQualifiedCaseIds(facts, userId, dateKey, config).size >= dailyTarget
  return { dateKeys: dates, streakDays: calculateAspirinCurrentStreak(dates, dateKey), qualifiedToday: today }
}
