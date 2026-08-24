import { Prisma, type CheckInType } from '@prisma/client'
import { calculateCheckinStreaks, getShanghaiDateKey, parseBeijingDate, shiftShanghaiDateKey } from '@/lib/checkin'
import { getStreakBonus } from '@/lib/daily'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { createUUID } from '@/lib/utils/uuid'

export const CHECK_IN_MAKEUP_COST = 74
export const CHECK_IN_MAKEUP_PLAYBACK_SECONDS = 10
export const USER_MAKEUP_TYPES: CheckInType[] = ['MAKEUP_FREE_QUIZ', 'MAKEUP_PAID']

export type UserMakeupAvailableDate = {
  dateKey: string
  weekStartKey: string
  weekEndKey: string
  freeChallengeAvailable: boolean
}

export class CheckInMakeupError extends Error {
  constructor(message: string, public status = 400, public code = 'MAKEUP_INVALID') {
    super(message)
    this.name = 'CheckInMakeupError'
  }
}

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+08:00`).getUTCDay()
}

export function getShanghaiWeekStart(dateKey: string) {
  const day = weekday(dateKey)
  return shiftShanghaiDateKey(dateKey, -(day === 0 ? 6 : day - 1))
}

export function getMakeupWeek(dateKey: string) {
  const startKey = getShanghaiWeekStart(dateKey)
  return { startKey, endKey: shiftShanghaiDateKey(startKey, 7) }
}

export function getMakeupEligibility(targetDateKey: string, now = new Date()) {
  const targetDate = parseBeijingDate(targetDateKey)
  if (!targetDate) return { eligible: false as const, code: 'INVALID_DATE', message: '补签日期无效' }
  const todayKey = getShanghaiDateKey(now)
  if (targetDateKey >= todayKey) {
    return targetDateKey === todayKey
      ? { eligible: false as const, code: 'TODAY_NOT_ALLOWED', message: '今天请使用正常挂号' }
      : { eligible: false as const, code: 'FUTURE_NOT_ALLOWED', message: '不能补签未来日期' }
  }
  const currentWeekStart = getShanghaiWeekStart(todayKey)
  const mondaySundayException = weekday(todayKey) === 1 && targetDateKey === shiftShanghaiDateKey(todayKey, -1)
  if (targetDateKey < currentWeekStart && !mondaySundayException) {
    return { eligible: false as const, code: 'OUTSIDE_MAKEUP_WINDOW', message: '只能补签本周已过去的漏签日期' }
  }
  const week = getMakeupWeek(targetDateKey)
  return { eligible: true as const, targetDate, targetDateKey, todayKey, week, mondaySundayException }
}

export function getShanghaiMonthKey(now = new Date()) {
  return getShanghaiDateKey(now).slice(0, 7)
}

export function buildUserMakeupAvailableDates(input: {
  candidateStartKey: string
  todayKey: string
  checkedInDateKeys: Iterable<string>
  makeupDateKeys: Iterable<string>
  monthlyChallengeStatus?: string | null
  monthlyChallengeTargetDate?: string | null
  now?: Date
}): UserMakeupAvailableDate[] {
  const checkedInDateKeys = new Set(input.checkedInDateKeys)
  const makeupDateKeys = new Set(input.makeupDateKeys)
  const now = input.now || new Date()
  const available: UserMakeupAvailableDate[] = []

  for (let dateKey = input.candidateStartKey; dateKey < input.todayKey; dateKey = shiftShanghaiDateKey(dateKey, 1)) {
    const eligibility = getMakeupEligibility(dateKey, now)
    if (!eligibility.eligible || checkedInDateKeys.has(dateKey)) continue
    const weekUsed = [...makeupDateKeys].some((makeupDateKey) => makeupDateKey >= eligibility.week.startKey && makeupDateKey < eligibility.week.endKey)
    if (weekUsed) continue
    available.push({
      dateKey,
      weekStartKey: eligibility.week.startKey,
      weekEndKey: eligibility.week.endKey,
      freeChallengeAvailable: !input.monthlyChallengeStatus
        || (input.monthlyChallengeStatus === 'PENDING' && input.monthlyChallengeTargetDate === dateKey),
    })
  }

  return available
}

export async function assertUserMakeupAvailable(
  tx: Prisma.TransactionClient,
  userId: string,
  targetDateKey: string,
  now = new Date(),
) {
  const eligibility = getMakeupEligibility(targetDateKey, now)
  if (!eligibility.eligible) throw new CheckInMakeupError(eligibility.message, 409, eligibility.code)
  const existing = await tx.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId, checkinDateKey: targetDateKey } },
    select: { id: true, type: true },
  })
  if (existing) throw new CheckInMakeupError('该日期已经挂号', 409, 'ALREADY_CHECKED_IN')
  const used = await tx.checkIn.findFirst({
    where: {
      userId,
      type: { in: USER_MAKEUP_TYPES },
      checkinDateKey: { gte: eligibility.week.startKey, lt: eligibility.week.endKey },
    },
    select: { id: true },
  })
  if (used) throw new CheckInMakeupError('该自然周的补签机会已使用', 409, 'WEEKLY_LIMIT_USED')
  return eligibility
}

type StreakReconcileResult = { currentStreak: number; longestStreak: number; totalDays: number; rewardTriggered: boolean; rewardAmount: number }

/** Recompute the existing CheckIn streak snapshots and issue only missing, existing long-term-patient rewards. */
export async function reconcileCheckInStreakAndLongTermReward(
  tx: Prisma.TransactionClient,
  userId: string,
  insertedDateKey: string,
  now = new Date(),
): Promise<StreakReconcileResult> {
  const records = await tx.checkIn.findMany({
    where: { userId },
    orderBy: [{ checkinDateKey: 'asc' }, { id: 'asc' }],
    select: { id: true, checkinDateKey: true, streakDay: true },
  })
  let running = 0
  let previous: string | null = null
  const computed = records.map((record) => {
    running = previous && shiftShanghaiDateKey(previous, 1) === record.checkinDateKey ? running + 1 : 1
    previous = record.checkinDateKey
    return { ...record, nextStreakDay: running }
  })
  for (const record of computed) {
    if (record.streakDay !== record.nextStreakDay) {
      await tx.checkIn.update({ where: { id: record.id }, data: { streakDay: record.nextStreakDay } })
    }
  }

  const insertedIndex = computed.findIndex((record) => record.checkinDateKey === insertedDateKey)
  let segmentEnd = insertedIndex
  while (segmentEnd + 1 < computed.length
    && shiftShanghaiDateKey(computed[segmentEnd].checkinDateKey, 1) === computed[segmentEnd + 1].checkinDateKey) segmentEnd += 1

  let rewardAmount = 0
  for (const record of computed.slice(Math.max(0, insertedIndex), segmentEnd + 1)) {
    const bonus = getStreakBonus(record.nextStreakDay)
    if (!bonus) continue
    const award = await awardRegistrationFee(tx, {
      userId,
      requestedAmount: bonus.points,
      action: 'CONTINUOUS_CHECK_IN_BONUS',
      reason: bonus.label,
      businessKey: `checkin-streak:${record.id}`,
      checkInId: record.id,
      now,
    })
    rewardAmount += award.awardedAmount
  }

  const streaks = calculateCheckinStreaks(computed.map((record) => record.checkinDateKey), now)
  const latest = computed.at(-1)?.checkinDateKey
  await tx.user.update({
    where: { id: userId },
    data: {
      consecutiveDays: streaks.currentStreak,
      lastCheckInDate: latest ? parseBeijingDate(latest) : null,
    },
  })
  return { ...streaks, rewardTriggered: rewardAmount > 0, rewardAmount }
}

export async function createMakeupCheckIn(
  tx: Prisma.TransactionClient,
  input: { userId: string; targetDateKey: string; type: Exclude<CheckInType, 'NORMAL'>; cost: number; challengeId?: string; now?: Date },
) {
  const now = input.now || new Date()
  const targetDate = parseBeijingDate(input.targetDateKey)
  if (!targetDate) throw new CheckInMakeupError('补签日期无效')
  const checkIn = await tx.checkIn.create({
    data: {
      userId: input.userId,
      checkDate: targetDate,
      checkinDateKey: input.targetDateKey,
      createdAt: now,
      isMakeUp: true,
      type: input.type,
      madeUpAt: now,
      makeupCost: input.cost,
      challengeId: input.challengeId,
      points: 0,
      exp: 0,
      streakDay: 1,
    },
  })
  const streak = await reconcileCheckInStreakAndLongTermReward(tx, input.userId, input.targetDateKey, now)
  return { checkIn, streak }
}

export function createChallengeOptions(question: { correctAnswer: string; wrongOption1: string; wrongOption2: string; wrongOption3: string }) {
  const correctOptionId = createUUID()
  const options = [
    { id: correctOptionId, label: question.correctAnswer },
    { id: createUUID(), label: question.wrongOption1 },
    { id: createUUID(), label: question.wrongOption2 },
    { id: createUUID(), label: question.wrongOption3 },
  ]
  for (let index = options.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[options[index], options[swap]] = [options[swap], options[index]]
  }
  return { options, correctOptionId }
}

export function parseChallengeOptions(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return []
  return value.flatMap((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return []
    const item = option as Record<string, unknown>
    return typeof item.id === 'string' && typeof item.label === 'string' ? [{ id: item.id, label: item.label }] : []
  })
}

export function serializePendingChallenge(challenge: { id: string; targetDateKey: string; status: string; options: Prisma.JsonValue; playbackSeconds: number }) {
  return {
    challengeId: challenge.id,
    targetDate: challenge.targetDateKey,
    status: challenge.status,
    options: parseChallengeOptions(challenge.options),
    audio: { url: `/api/checkin/makeup/challenge/${challenge.id}/audio`, durationSeconds: challenge.playbackSeconds },
  }
}
