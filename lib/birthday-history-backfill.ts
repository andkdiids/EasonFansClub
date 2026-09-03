import { getBeijingDateKey } from '@/lib/beijing-time'
import { getBadgeAvailability } from '@/lib/badge-phase2'
import { grantBadge } from '@/lib/badge-service'
import { processBadgeGrantEffects } from '@/lib/badge-phase3'
import { prisma } from '@/lib/prisma'
import { getZodiacFromRuleConfig } from '@/lib/badge-rules'
import { BIRTHDAY_BADGE_SLUG } from '@/lib/birthday'
import { getCurrentZodiacSign, getZodiacSignFromBirthday, type ZodiacSign } from '@/lib/zodiac'

export const BIRTHDAY_HISTORY_BACKFILL_SOURCE = 'BIRTHDAY_HISTORY_BACKFILL'
export const BIRTHDAY_HISTORY_BACKFILL_TIMEZONE = 'Asia/Shanghai'
export const BIRTHDAY_HISTORY_BACKFILL_BATCH_SIZE = 200

export type BirthdayHistoryBackfillInput = {
  startDate: string
  endDate: string
  includeBirthday: boolean
  includeZodiac: boolean
}

export type BirthdayHistoryBackfillCategory = {
  eligible: number
  alreadyOwned: number
  pending: number
  granted: number
  noRule: number
  failed: number
}

export type BirthdayHistoryBackfillFailure = {
  userId: string
  badgeId: string
  badgeName: string
  ruleType: BirthdayBadgeRuleType
  eligibleDate: string
  reason: string
}

export type BirthdayHistoryBackfillSummary = {
  startDate: string
  endDate: string
  timezone: typeof BIRTHDAY_HISTORY_BACKFILL_TIMEZONE
  includeBirthday: boolean
  includeZodiac: boolean
  candidateUserCount: number
  matchedUserCount: number
  invalidBirthdayUserCount: number
  birthday: BirthdayHistoryBackfillCategory
  zodiac: BirthdayHistoryBackfillCategory
  totalExpected: number
  totalAlreadyOwned: number
  totalPending: number
  totalGranted: number
  totalNoRule: number
  totalFailed: number
  totalSkipped: number
  failures: BirthdayHistoryBackfillFailure[]
  executedAt: string | null
}

type BirthdayBadgeRuleType = 'BIRTHDAY_TODAY' | 'BIRTHDAY_ZODIAC'

type BirthdayHistoryWindow = BirthdayHistoryBackfillInput & {
  from: Date
  until: Date
}

type CandidateUser = {
  id: string
  createdAt: Date
  birthMonth: number | null
  birthDay: number | null
}

export type HistoricalBirthdayUser = Pick<CandidateUser, 'createdAt' | 'birthMonth' | 'birthDay'>

export type HistoricalBirthdayEligibility = {
  birthdayDate: string | null
  zodiac: ZodiacSign | null
  zodiacDate: string | null
}

type HistoryBadgeTarget = {
  id: string
  name: string
  slug: string
  ruleId: string
  ruleType: BirthdayBadgeRuleType
  zodiac: ZodiacSign | null
}

type HistoryGrantPlan = {
  userId: string
  badgeId: string
  badgeName: string
  ruleId: string
  ruleType: BirthdayBadgeRuleType
  zodiac: ZodiacSign | null
  eligibleDate: string
}

type DateIndex = {
  birthdayDates: Map<string, string[]>
  zodiacDates: Map<ZodiacSign, string[]>
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

function emptyCategory(): BirthdayHistoryBackfillCategory {
  return { eligible: 0, alreadyOwned: 0, pending: 0, granted: 0, noRule: 0, failed: 0 }
}

function parseCalendarDateKey(value: unknown, label: string): { key: string; date: Date } | { error: string } {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) return { error: `${label}必须是有效的日期` }
  const [, yearText, monthText, dayText] = value.match(CALENDAR_DATE_PATTERN)!
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return { error: `${label}必须是有效的日期` }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return { error: `${label}必须是有效的日期` }
  return { key: value, date }
}

function localDateTime(key: string, time: 'start' | 'end') {
  return new Date(`${key}T${time === 'start' ? '00:00:00.000' : '23:59:59.999'}+08:00`)
}

export function parseBirthdayHistoryBackfillInput(value: unknown): { input: BirthdayHistoryBackfillInput } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '请求参数无效' }
  const body = value as Record<string, unknown>
  const start = parseCalendarDateKey(body.startDate, '开始日期')
  if ('error' in start) return start
  const end = parseCalendarDateKey(body.endDate, '结束日期')
  if ('error' in end) return end
  if (start.key > end.key) return { error: '开始日期不能晚于结束日期' }

  const includeBirthday = body.includeBirthday === undefined ? true : body.includeBirthday
  const includeZodiac = body.includeZodiac === undefined ? true : body.includeZodiac
  if (typeof includeBirthday !== 'boolean' || typeof includeZodiac !== 'boolean') return { error: '请明确选择补发范围' }
  if (!includeBirthday && !includeZodiac) return { error: '至少选择一项补发范围' }

  return { input: { startDate: start.key, endDate: end.key, includeBirthday, includeZodiac } }
}

function withWindow(input: BirthdayHistoryBackfillInput): BirthdayHistoryWindow {
  return { ...input, from: localDateTime(input.startDate, 'start'), until: localDateTime(input.endDate, 'end') }
}

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function dateAtShanghaiNoon(key: string) {
  return new Date(`${key}T12:00:00.000+08:00`)
}

/** Build date indexes once per operation; users are never multiplied by days. */
function buildDateIndex(input: BirthdayHistoryBackfillInput): DateIndex {
  const start = parseCalendarDateKey(input.startDate, '开始日期')
  const end = parseCalendarDateKey(input.endDate, '结束日期')
  if ('error' in start || 'error' in end) throw new Error('历史补发日期范围无效')

  const birthdayDates = new Map<string, string[]>()
  const zodiacDates = new Map<ZodiacSign, string[]>()
  for (let date = start.date; date.getTime() <= end.date.getTime(); date = new Date(date.getTime() + DAY_MS)) {
    const key = dateKeyFromUtcDate(date)
    const monthDay = key.slice(5)
    const birthdayValues = birthdayDates.get(monthDay) || []
    birthdayValues.push(key)
    birthdayDates.set(monthDay, birthdayValues)
    const zodiac = getCurrentZodiacSign(dateAtShanghaiNoon(key), BIRTHDAY_HISTORY_BACKFILL_TIMEZONE)
    if (zodiac) {
      const zodiacValues = zodiacDates.get(zodiac) || []
      zodiacValues.push(key)
      zodiacDates.set(zodiac, zodiacValues)
    }
  }
  return { birthdayDates, zodiacDates }
}

function firstDateOnOrAfter(dates: readonly string[] | undefined, minimum: string) {
  if (!dates?.length) return null
  let low = 0
  let high = dates.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (dates[middle] < minimum) low = middle + 1
    else high = middle
  }
  return dates[low] || null
}

function birthdayEligibleDate(user: CandidateUser, index: DateIndex) {
  if (user.birthMonth == null || user.birthDay == null) return null
  const monthDay = `${String(user.birthMonth).padStart(2, '0')}-${String(user.birthDay).padStart(2, '0')}`
  return firstDateOnOrAfter(index.birthdayDates.get(monthDay), getBeijingDateKey(user.createdAt))
}

function zodiacEligibleDate(user: CandidateUser, index: DateIndex) {
  if (user.birthMonth == null || user.birthDay == null) return { zodiac: null, eligibleDate: null }
  const zodiac = getZodiacSignFromBirthday({ month: user.birthMonth, day: user.birthDay })
  if (!zodiac) return { zodiac: null, eligibleDate: null }
  return { zodiac, eligibleDate: firstDateOnOrAfter(index.zodiacDates.get(zodiac), getBeijingDateKey(user.createdAt)) }
}

function normalizeInput(input: BirthdayHistoryBackfillInput) {
  const parsed = parseBirthdayHistoryBackfillInput(input)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.input
}

/** Pure historical as-of evaluation used by the batch scanner and regression tests. */
export function getHistoricalBirthdayEligibility(user: HistoricalBirthdayUser, input: BirthdayHistoryBackfillInput): HistoricalBirthdayEligibility {
  const normalizedInput = normalizeInput(input)
  const index = buildDateIndex(normalizedInput)
  const birthdayDate = birthdayEligibleDate({ ...user, id: '' }, index)
  const zodiacResult = zodiacEligibleDate({ ...user, id: '' }, index)
  return { birthdayDate, zodiac: zodiacResult.zodiac, zodiacDate: zodiacResult.eligibleDate }
}

async function loadTargetBadges(now: Date): Promise<HistoryBadgeTarget[]> {
  const badges = await prisma.badge.findMany({
    where: {
      grantType: 'AUTO',
      isEnabled: true,
      isActive: true,
      OR: [
        { BadgeRule: { isEnabled: true, ruleType: { in: ['BIRTHDAY_TODAY', 'BIRTHDAY_ZODIAC'] } } },
        { slug: BIRTHDAY_BADGE_SLUG },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      availableFrom: true,
      availableUntil: true,
      BadgeRule: { select: { id: true, ruleType: true, configJson: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return badges.flatMap((badge) => {
    const rule = badge.BadgeRule
    const isLegacyBirthdayBadge = !rule && badge.slug === BIRTHDAY_BADGE_SLUG
    if (!isLegacyBirthdayBadge && (!rule || (rule.ruleType !== 'BIRTHDAY_TODAY' && rule.ruleType !== 'BIRTHDAY_ZODIAC'))) return []
    // An upcoming badge cannot be historically granted. Ended badges are
    // intentionally retained because grantBadge accepts an explicit window.
    if (getBadgeAvailability(badge, now) === 'UPCOMING') return []
    const ruleType: BirthdayBadgeRuleType = isLegacyBirthdayBadge ? 'BIRTHDAY_TODAY' : rule!.ruleType as BirthdayBadgeRuleType
    const zodiac = ruleType === 'BIRTHDAY_ZODIAC' ? getZodiacFromRuleConfig(rule!.configJson) : null
    return [{ id: badge.id, name: badge.name, slug: badge.slug, ruleId: rule?.id || BIRTHDAY_BADGE_SLUG, ruleType, zodiac }]
  })
}

function createSummary(window: BirthdayHistoryWindow, executedAt: Date | null): BirthdayHistoryBackfillSummary {
  return {
    startDate: window.startDate,
    endDate: window.endDate,
    timezone: BIRTHDAY_HISTORY_BACKFILL_TIMEZONE,
    includeBirthday: window.includeBirthday,
    includeZodiac: window.includeZodiac,
    candidateUserCount: 0,
    matchedUserCount: 0,
    invalidBirthdayUserCount: 0,
    birthday: emptyCategory(),
    zodiac: emptyCategory(),
    totalExpected: 0,
    totalAlreadyOwned: 0,
    totalPending: 0,
    totalGranted: 0,
    totalNoRule: 0,
    totalFailed: 0,
    totalSkipped: 0,
    failures: [],
    executedAt: executedAt?.toISOString() || null,
  }
}

function targetForPlan(targets: readonly HistoryBadgeTarget[], type: BirthdayBadgeRuleType, zodiac: ZodiacSign | null) {
  return targets.filter((target) => target.ruleType === type && (type !== 'BIRTHDAY_ZODIAC' || target.zodiac === zodiac))
}

function buildPlans(
  users: readonly CandidateUser[],
  input: BirthdayHistoryBackfillInput,
  index: DateIndex,
  targets: readonly HistoryBadgeTarget[],
  summary: BirthdayHistoryBackfillSummary,
) {
  const plans: HistoryGrantPlan[] = []
  for (const user of users) {
    const birth = user.birthMonth != null && user.birthDay != null ? { month: user.birthMonth, day: user.birthDay } : null
    const resolvedZodiac = birth ? getZodiacSignFromBirthday(birth) : null
    const hasBirthdayPart = user.birthMonth != null || user.birthDay != null
    if (hasBirthdayPart && (!birth || !resolvedZodiac)) summary.invalidBirthdayUserCount += 1

    let matched = false
    if (input.includeBirthday) {
      const eligibleDate = birthdayEligibleDate(user, index)
      if (eligibleDate) {
        matched = true
        const birthdayTargets = targetForPlan(targets, 'BIRTHDAY_TODAY', null)
        if (!birthdayTargets.length) summary.birthday.noRule += 1
        for (const target of birthdayTargets) plans.push({ userId: user.id, badgeId: target.id, badgeName: target.name, ruleId: target.ruleId, ruleType: target.ruleType, zodiac: null, eligibleDate })
      }
    }

    if (input.includeZodiac) {
      const zodiacResult = zodiacEligibleDate(user, index)
      if (zodiacResult.zodiac && zodiacResult.eligibleDate) {
        matched = true
        const zodiacTargets = targetForPlan(targets, 'BIRTHDAY_ZODIAC', zodiacResult.zodiac)
        if (!zodiacTargets.length) summary.zodiac.noRule += 1
        for (const target of zodiacTargets) plans.push({ userId: user.id, badgeId: target.id, badgeName: target.name, ruleId: target.ruleId, ruleType: target.ruleType, zodiac: zodiacResult.zodiac, eligibleDate: zodiacResult.eligibleDate })
      }
    }
    if (matched) summary.matchedUserCount += 1
  }
  return plans
}

async function loadUsers(cursor?: string): Promise<CandidateUser[]> {
  return prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      // Include partial legacy values so the preview can report them as
      // invalid instead of silently hiding them from the candidate count.
      OR: [{ birthMonth: { not: null } }, { birthDay: { not: null } }],
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: BIRTHDAY_HISTORY_BACKFILL_BATCH_SIZE,
    select: { id: true, createdAt: true, birthMonth: true, birthDay: true },
  })
}

function planKey(plan: Pick<HistoryGrantPlan, 'userId' | 'badgeId'>) {
  return `${plan.userId}:${plan.badgeId}`
}

function categoryForPlan(summary: BirthdayHistoryBackfillSummary, plan: HistoryGrantPlan) {
  return plan.ruleType === 'BIRTHDAY_TODAY' ? summary.birthday : summary.zodiac
}

async function loadOwnedKeys(plans: readonly HistoryGrantPlan[]) {
  const userIds = [...new Set(plans.map((plan) => plan.userId))]
  const badgeIds = [...new Set(plans.map((plan) => plan.badgeId))]
  if (!userIds.length || !badgeIds.length) return new Set<string>()
  const owned = await prisma.userBadge.findMany({
    where: { userId: { in: userIds }, badgeId: { in: badgeIds } },
    select: { userId: true, badgeId: true },
  })
  return new Set(owned.map(planKey))
}

async function scanHistory(
  window: BirthdayHistoryWindow,
  now: Date,
  onPlans: (plans: readonly HistoryGrantPlan[], summary: BirthdayHistoryBackfillSummary) => Promise<void>,
) {
  const summary = createSummary(window, null)
  const index = buildDateIndex(window)
  const targets = await loadTargetBadges(now)
  let cursor: string | undefined
  while (true) {
    const users = await loadUsers(cursor)
    if (!users.length) break
    summary.candidateUserCount += users.length
    const plans = buildPlans(users, window, index, targets, summary)
    await onPlans(plans, summary)
    cursor = users.at(-1)?.id
    if (users.length < BIRTHDAY_HISTORY_BACKFILL_BATCH_SIZE) break
  }
  summary.totalExpected = summary.birthday.eligible + summary.zodiac.eligible
  summary.totalAlreadyOwned = summary.birthday.alreadyOwned + summary.zodiac.alreadyOwned
  summary.totalPending = summary.birthday.pending + summary.zodiac.pending
  summary.totalGranted = summary.birthday.granted + summary.zodiac.granted
  summary.totalNoRule = summary.birthday.noRule + summary.zodiac.noRule
  summary.totalFailed = summary.birthday.failed + summary.zodiac.failed
  summary.totalSkipped = Math.max(0, summary.candidateUserCount - summary.matchedUserCount) + summary.totalAlreadyOwned + summary.totalNoRule
  return summary
}

export async function previewBirthdayHistoryBackfill(input: BirthdayHistoryBackfillInput, now = new Date()) {
  const window = withWindow(normalizeInput(input))
  return scanHistory(window, now, async (plans, summary) => {
    if (!plans.length) return
    const owned = await loadOwnedKeys(plans)
    for (const plan of plans) {
      const category = categoryForPlan(summary, plan)
      category.eligible += 1
      if (owned.has(planKey(plan))) category.alreadyOwned += 1
      else category.pending += 1
    }
  })
}

function grantReason(plan: HistoryGrantPlan) {
  return `历史生日勋章补发：${plan.ruleType}，历史资格日期 ${plan.eligibleDate}（${BIRTHDAY_HISTORY_BACKFILL_TIMEZONE}）。`
}

export async function executeBirthdayHistoryBackfill(input: BirthdayHistoryBackfillInput, now = new Date()) {
  const window = withWindow(normalizeInput(input))
  const summary = await scanHistory(window, now, async (plans, currentSummary) => {
    if (!plans.length) return
    const owned = await loadOwnedKeys(plans)
    const newlyGrantedByUser = new Map<string, Array<{ badgeId: string; recordId: string }>>()
    for (const plan of plans) {
      const category = categoryForPlan(currentSummary, plan)
      category.eligible += 1
      if (owned.has(planKey(plan))) {
        category.alreadyOwned += 1
        continue
      }
      category.pending += 1
      try {
        const result = await grantBadge({
          userId: plan.userId,
          badgeId: plan.badgeId,
          sourceType: BIRTHDAY_HISTORY_BACKFILL_SOURCE,
          sourceId: plan.eligibleDate,
          grantReason: grantReason(plan),
          obtainedAt: now,
          availabilityMode: 'HISTORICAL_WINDOW',
          historicalWindow: { from: window.from, until: window.until },
          deferPhase3Effects: true,
        })
        if (result.created) {
          category.granted += 1
          newlyGrantedByUser.set(plan.userId, [...(newlyGrantedByUser.get(plan.userId) || []), { badgeId: plan.badgeId, recordId: result.recordId }])
        } else {
          // Another execution may have won the unique user/badge row after
          // preview. Treat it as an idempotent skip, not a failure.
          category.alreadyOwned += 1
        }
      } catch (error) {
        category.failed += 1
        if (currentSummary.failures.length < 200) currentSummary.failures.push({
          userId: plan.userId,
          badgeId: plan.badgeId,
          badgeName: plan.badgeName,
          ruleType: plan.ruleType,
          eligibleDate: plan.eligibleDate,
          reason: error instanceof Error ? error.message : '发放失败',
        })
      }
    }
    // Effects are invoked only for records created in this execution. A retry
    // therefore cannot create a second badge notification for an owned row.
    for (const [userId, grants] of newlyGrantedByUser) {
      await processBadgeGrantEffects({ userId, grants }).catch((error) => {
        console.error('[badge.birthday-history-backfill.effects]', { userId, error })
      })
    }
  })
  return { ...summary, executedAt: now.toISOString() }
}

export function birthdayHistoryBackfillAuditDetail(summary: BirthdayHistoryBackfillSummary) {
  return {
    source: BIRTHDAY_HISTORY_BACKFILL_SOURCE,
    startDate: summary.startDate,
    endDate: summary.endDate,
    timezone: summary.timezone,
    includeBirthday: summary.includeBirthday,
    includeZodiac: summary.includeZodiac,
    executedAt: summary.executedAt,
    candidateUserCount: summary.candidateUserCount,
    matchedUserCount: summary.matchedUserCount,
    birthday: summary.birthday,
    zodiac: summary.zodiac,
    totalExpected: summary.totalExpected,
    totalAlreadyOwned: summary.totalAlreadyOwned,
    totalPending: summary.totalPending,
    totalGranted: summary.totalGranted,
    totalNoRule: summary.totalNoRule,
    totalSkipped: summary.totalSkipped,
    totalFailed: summary.totalFailed,
    failures: summary.failures,
  }
}

export type { BirthdayBadgeRuleType }
