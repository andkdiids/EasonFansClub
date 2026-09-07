import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { getShanghaiDateKey, getShanghaiDayRange, parseBeijingDate, shiftShanghaiDateKey } from '@/lib/checkin'
import { getShanghaiWeekKey } from '@/lib/community-rewards'
import { awardRegistrationFee, reverseRegistrationFee } from '@/lib/registration-fee'
import {
  TASK_SYSTEM_LAUNCH_AT,
  WEEKLY_MILESTONES,
  getEconomyReport,
  getGrowthTask,
  getTasksByKind,
  type GrowthTaskCode,
} from './registry'

type GrowthTransaction = Prisma.TransactionClient

function stableBusinessKey(parts: readonly string[]) {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex')
  return `growth:${digest}`
}

function normalizeSource(value: string) {
  return value.trim().slice(0, 191) || 'event'
}

function weekRange(weekKey: string) {
  const start = parseBeijingDate(weekKey)
  if (!start) throw new Error('INVALID_SHANGHAI_WEEK_KEY')
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) }
}

function dayKeysForWeek(weekKey: string) {
  return Array.from({ length: 7 }, (_, index) => shiftShanghaiDateKey(weekKey, index))
}

function isEligible(taskCode: GrowthTaskCode, now: Date) {
  const task = getGrowthTask(taskCode)
  return Boolean(task && (taskCode === 'PROFILE_COMPLETE' || now >= task.eligibleFrom))
}

export async function completeTask(
  tx: GrowthTransaction,
  input: {
    userId: string
    taskCode: GrowthTaskCode
    periodKey?: string
    sourceEventId?: string
    now?: Date
  },
) {
  const task = getGrowthTask(input.taskCode)
  if (!task) throw new Error('UNKNOWN_GROWTH_TASK_CODE')
  const now = input.now || new Date()
  if (!isEligible(input.taskCode, now)) return { eligible: false, created: false, completion: null }

  const periodKey = (input.periodKey || (task.frequency === 'daily' ? getShanghaiDateKey(now) : 'ALL')).slice(0, 32)
  const sourceEventId = normalizeSource(input.sourceEventId || (task.frequency === 'daily' ? `${input.taskCode}:${periodKey}` : input.taskCode))
  const oneTimeKey = task.frequency === 'once' ? `${input.userId}:${input.taskCode}`.slice(0, 191) : null

  const existing = oneTimeKey
    ? await tx.growthTaskCompletion.findUnique({ where: { oneTimeKey } })
    : await tx.growthTaskCompletion.findUnique({
        where: {
          userId_taskCode_periodKey_sourceEventId: {
            userId: input.userId,
            taskCode: input.taskCode,
            periodKey,
            sourceEventId,
          },
        },
      })
  if (existing) return { eligible: true, created: false, completion: existing }

  try {
    const completion = oneTimeKey
      ? await tx.growthTaskCompletion.upsert({
          where: { oneTimeKey },
          update: {},
          create: { userId: input.userId, taskCode: input.taskCode, periodKey, sourceEventId, oneTimeKey, completedAt: now },
        })
      : await tx.growthTaskCompletion.upsert({
          where: {
            userId_taskCode_periodKey_sourceEventId: {
              userId: input.userId,
              taskCode: input.taskCode,
              periodKey,
              sourceEventId,
            },
          },
          update: {},
          create: { userId: input.userId, taskCode: input.taskCode, periodKey, sourceEventId, completedAt: now },
        })
    return { eligible: true, created: !existing, completion }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
      const concurrent = oneTimeKey
        ? await tx.growthTaskCompletion.findUnique({ where: { oneTimeKey } })
        : await tx.growthTaskCompletion.findUnique({
            where: {
              userId_taskCode_periodKey_sourceEventId: {
                userId: input.userId,
                taskCode: input.taskCode,
                periodKey,
                sourceEventId,
              },
            },
          })
      if (concurrent) return { eligible: true, created: false, completion: concurrent }
    }
    throw error
  }
}

function capWindow(task: NonNullable<ReturnType<typeof getGrowthTask>>, now: Date) {
  if (task.frequency === 'daily') {
    const range = getShanghaiDayRange(now)
    return { start: range.start, end: range.end, limit: task.dailyCap || Number.MAX_SAFE_INTEGER }
  }
  const range = weekRange(getShanghaiWeekKey(now))
  return { ...range, limit: task.weeklyCap || Number.MAX_SAFE_INTEGER }
}

export async function grantGrowthReward(
  tx: GrowthTransaction,
  input: {
    userId: string
    taskCode: GrowthTaskCode
    sourceEventId: string
    reason?: string
    now?: Date
    postId?: string
    replyId?: string
    activityId?: string
    activityRegistrationId?: string
    badgeId?: string
  },
) {
  const task = getGrowthTask(input.taskCode)
  if (!task || task.kind !== 'passive') throw new Error('GROWTH_REWARD_TASK_NOT_PASSIVE')
  const now = input.now || new Date()
  const sourceEventId = normalizeSource(input.sourceEventId)
  const periodKey = task.frequency === 'daily' ? getShanghaiDateKey(now) : getShanghaiWeekKey(now)
  const completion = await completeTask(tx, { userId: input.userId, taskCode: input.taskCode, periodKey, sourceEventId, now })
  if (!completion.eligible || !completion.completion) return { awardedAmount: 0, capped: true, duplicate: false }

  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`
  const businessKey = stableBusinessKey([input.taskCode, input.userId, periodKey, sourceEventId])
  const original = await tx.pointLog.findUnique({ where: { businessKey }, select: { id: true } })
  if (original) return { awardedAmount: 0, capped: false, duplicate: true }

  const window = capWindow(task, now)
  const where = {
    userId: input.userId,
    growthTaskCode: input.taskCode,
    points: { gt: 0 },
    createdAt: { gte: window.start, lt: window.end },
  } as const
  const [sum, count] = await Promise.all([
    tx.pointLog.aggregate({ where, _sum: { points: true } }),
    tx.pointLog.count({ where }),
  ])
  const used = task.capUnit === 'events' ? count : (sum._sum.points || 0)
  const remaining = Math.max(0, window.limit - used)
  if (remaining <= 0) {
    await tx.growthTaskCompletion.update({ where: { id: completion.completion.id }, data: { rewardAmount: 0 } })
    return { awardedAmount: 0, capped: true, duplicate: false }
  }
  const amount = task.capUnit === 'events' ? task.reward : Math.min(task.reward, remaining)
  const award = await awardRegistrationFee(tx, {
    userId: input.userId,
    requestedAmount: amount,
    action: 'GROWTH_REWARD',
    reason: input.reason || task.title,
    businessKey,
    postId: input.postId,
    replyId: input.replyId,
    activityId: input.activityId,
    activityRegistrationId: input.activityRegistrationId,
    badgeId: input.badgeId,
    growthTaskCode: input.taskCode,
    sourceEventId,
    now,
  })
  await tx.growthTaskCompletion.update({ where: { id: completion.completion.id }, data: { rewardAmount: award.awardedAmount } })
  return { awardedAmount: award.awardedAmount, capped: false, duplicate: award.duplicate }
}

export async function reverseGrowthRewardForEvent(
  tx: GrowthTransaction,
  input: {
    userId: string
    taskCode: GrowthTaskCode
    sourceEventId: string
    reason?: string
    now?: Date
    postId?: string
    replyId?: string
  },
) {
  const sourceEventId = normalizeSource(input.sourceEventId)
  const original = await tx.pointLog.findFirst({
    where: { userId: input.userId, growthTaskCode: input.taskCode, sourceEventId, points: { gt: 0 } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { businessKey: true, points: true },
  })
  if (!original?.businessKey) return { reversedAmount: 0, duplicate: false }
  const now = input.now || new Date()
  const reversalKey = stableBusinessKey(['reversal', original.businessKey])
  return reverseRegistrationFee(tx, {
    userId: input.userId,
    amount: original.points,
    action: 'GROWTH_REWARD_REVERSAL',
    reason: input.reason || '成长奖励撤销',
    businessKey: reversalKey,
    postId: input.postId,
    replyId: input.replyId,
    growthTaskCode: input.taskCode,
    sourceEventId,
    reversalOfBusinessKey: original.businessKey,
    now,
  })
}

export async function refreshProfileCompletion(userId: string, now = new Date()) {
  return prismaTransaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        nickname: true,
        gender: true,
        avatarUrl: true,
        bio: true,
        birthMonth: true,
        birthDay: true,
        Profile: { select: { avatarUrl: true, bio: true, locationCountry: true, locationRegion: true } },
      },
    })
    if (!user) throw new Error('USER_NOT_FOUND')
    const profileComplete = Boolean(
      user.nickname.trim() &&
      (user.avatarUrl || user.Profile?.avatarUrl) &&
      (user.bio?.trim() || user.Profile?.bio?.trim()) &&
      user.gender &&
      (user.Profile?.locationCountry || user.Profile?.locationRegion) &&
      user.birthMonth &&
      user.birthDay,
    )
    if (!profileComplete) return { completed: false }
    const result = await completeTask(tx, { userId, taskCode: 'PROFILE_COMPLETE', periodKey: 'ALL', sourceEventId: 'PROFILE', now })
    return { completed: Boolean(result.completion), created: result.created }
  })
}

async function prismaTransaction<T>(callback: (tx: GrowthTransaction) => Promise<T>) {
  const { prisma } = await import('@/lib/prisma')
  return prisma.$transaction(callback, { timeout: 15_000, maxWait: 5_000 })
}

export async function claimGrowthTask(userId: string, taskCode: GrowthTaskCode, now = new Date()) {
  const task = getGrowthTask(taskCode)
  if (!task || task.kind !== 'newLife' || task.claimMode !== 'manual') throw new Error('GROWTH_TASK_NOT_CLAIMABLE')
  return prismaTransaction(async (tx) => {
    const completion = await tx.growthTaskCompletion.findFirst({ where: { userId, taskCode, oneTimeKey: { not: null } } })
    if (!completion) throw new Error('GROWTH_TASK_NOT_COMPLETED')
    await tx.$queryRaw`SELECT \`id\` FROM \`GrowthTaskCompletion\` WHERE \`id\` = ${completion.id} FOR UPDATE`
    const locked = await tx.growthTaskCompletion.findUniqueOrThrow({ where: { id: completion.id } })
    if (locked.claimedAt) return { claimed: false, reward: 0, alreadyClaimed: true }
    const businessKey = stableBusinessKey(['claim', locked.id])
    const award = await awardRegistrationFee(tx, {
      userId,
      requestedAmount: task.reward,
      action: 'GROWTH_REWARD',
      reason: `新生活：${task.title}`,
      businessKey,
      growthTaskCode: task.code,
      sourceEventId: locked.sourceEventId,
      now,
    })
    await tx.growthTaskCompletion.update({ where: { id: locked.id }, data: { claimedAt: now, rewardAmount: award.awardedAmount || task.reward } })
    return { claimed: true, reward: award.awardedAmount || task.reward, alreadyClaimed: false }
  })
}

async function completedActiveDays(tx: GrowthTransaction, userId: string, weekKey: string) {
  const activeCodes = getTasksByKind('active').map((task) => task.code)
  const rows = await tx.growthTaskCompletion.findMany({ where: { userId, taskCode: { in: activeCodes }, periodKey: { in: dayKeysForWeek(weekKey) } }, select: { taskCode: true, periodKey: true } })
  const byDay = new Map<string, Set<string>>()
  for (const row of rows) byDay.set(row.periodKey, (byDay.get(row.periodKey) || new Set()).add(row.taskCode))
  return dayKeysForWeek(weekKey).filter((day) => activeCodes.every((code) => byDay.get(day)?.has(code))).length
}

export async function claimWeeklyMilestone(userId: string, milestone: number, now = new Date()) {
  const definition = WEEKLY_MILESTONES.find((item) => item.days === milestone)
  if (!definition) throw new Error('INVALID_WEEKLY_MILESTONE')
  const weekKey = getShanghaiWeekKey(now)
  return prismaTransaction(async (tx) => {
    const days = await completedActiveDays(tx, userId, weekKey)
    if (days < definition.days) throw new Error('WEEKLY_MILESTONE_NOT_REACHED')
    const claim = await tx.growthWeeklyMilestoneClaim.upsert({
      where: { userId_weekKey_milestone: { userId, weekKey, milestone } },
      update: {},
      create: { userId, weekKey, milestone, rewardAmount: definition.reward },
    })
    await tx.$queryRaw`SELECT \`id\` FROM \`GrowthWeeklyMilestoneClaim\` WHERE \`id\` = ${claim.id} FOR UPDATE`
    const locked = await tx.growthWeeklyMilestoneClaim.findUniqueOrThrow({ where: { id: claim.id } })
    if (locked.claimedAt) return { claimed: false, reward: 0, alreadyClaimed: true, weekKey, days }
    const award = await awardRegistrationFee(tx, {
      userId,
      requestedAmount: definition.reward,
      action: 'GROWTH_REWARD',
      reason: `本周完成 ${definition.days} 天` ,
      businessKey: stableBusinessKey(['milestone', userId, weekKey, String(milestone)]),
      growthTaskCode: `WEEKLY_MILESTONE_${milestone}`,
      sourceEventId: weekKey,
      now,
    })
    await tx.growthWeeklyMilestoneClaim.update({ where: { id: locked.id }, data: { claimedAt: now } })
    return { claimed: true, reward: award.awardedAmount || definition.reward, alreadyClaimed: false, weekKey, days }
  })
}

export async function getGrowthOverview(userId: string, now = new Date()) {
  const { prisma } = await import('@/lib/prisma')
  const dateKey = getShanghaiDateKey(now)
  const weekKey = getShanghaiWeekKey(now)
  const todayRange = getShanghaiDayRange(now)
  const [completions, newLifeCompletions, pointLogs] = await Promise.all([
    prisma.growthTaskCompletion.findMany({ where: { userId, periodKey: { in: [dateKey, weekKey, ...dayKeysForWeek(weekKey)] } }, orderBy: { completedAt: 'asc' } }),
    prisma.growthTaskCompletion.findMany({ where: { userId, taskCode: { in: getTasksByKind('newLife').map((task) => task.code) }, oneTimeKey: { not: null } }, orderBy: { completedAt: 'asc' } }),
    prisma.pointLog.findMany({ where: { userId, growthTaskCode: { not: null }, createdAt: { gte: weekRange(weekKey).start, lt: weekRange(weekKey).end } }, select: { growthTaskCode: true, points: true, createdAt: true } }),
  ])
  const existingDailyRewards = await prisma.pointLog.findMany({
    where: {
      userId,
      action: { in: ['DAILY_CHECK_IN', 'CONTINUOUS_CHECK_IN_BONUS', 'ENTERTAINMENT_DAILY_DRAW', 'COMMENT_POST'] },
      createdAt: { gte: todayRange.start, lt: todayRange.end },
    },
    select: { action: true, points: true },
  })
  const dailyRewardTotal = (actions: readonly string[]) => existingDailyRewards
    .filter((row) => actions.includes(row.action))
    .reduce((sum, row) => sum + row.points, 0)
  const activeRewardByCode: Record<string, number> = {
    DAILY_CHECKIN: dailyRewardTotal(['DAILY_CHECK_IN', 'CONTINUOUS_CHECK_IN_BONUS']),
    DAILY_PRESCRIPTION: dailyRewardTotal(['ENTERTAINMENT_DAILY_DRAW']),
    DAILY_GAME: 0,
    DAILY_COMMENT: dailyRewardTotal(['COMMENT_POST']),
  }
  const active = getTasksByKind('active')
  const passive = getTasksByKind('passive')
  const completionRows = completions.filter((row) => row.periodKey === dateKey)
  const activeItems = active.map((task) => ({
    ...task,
    reward: task.reward,
    completed: completionRows.some((row) => row.taskCode === task.code),
    todayReward: activeRewardByCode[task.code] || 0,
  }))
  const activeCodes = new Set<string>(active.map((task) => task.code))
  const activeByDay = new Map<string, Set<string>>()
  completions.forEach((row) => {
    if (!activeCodes.has(row.taskCode) || !dayKeysForWeek(weekKey).includes(row.periodKey)) return
    activeByDay.set(row.periodKey, (activeByDay.get(row.periodKey) || new Set()).add(row.taskCode))
  })
  const activeDays = dayKeysForWeek(weekKey).filter((day) => activeCodes.size > 0 && activeCodes.size === activeByDay.get(day)?.size).length
  const passiveItems = passive.map((task) => {
    const start = task.frequency === 'daily' ? getShanghaiDayRange(now).start : weekRange(weekKey).start
    const end = task.frequency === 'daily' ? getShanghaiDayRange(now).end : weekRange(weekKey).end
    const scoped = pointLogs.filter((row) => row.growthTaskCode === task.code && row.createdAt >= start && row.createdAt < end)
    const positiveRows = scoped.filter((row) => row.points > 0)
    const negativeRows = scoped.filter((row) => row.points < 0)
    const earned = scoped.reduce((sum, row) => sum + row.points, 0)
    const cap = task.frequency === 'daily' ? task.dailyCap : task.weeklyCap
    const progress = task.capUnit === 'events' ? positiveRows.length : earned
    return { ...task, earned, progress, positiveEvents: positiveRows.length, reversals: negativeRows.length, cap }
  })
  const newLifeItems = getTasksByKind('newLife').map((task) => {
    const completion = newLifeCompletions.find((row) => row.taskCode === task.code)
    return { ...task, completed: Boolean(completion), claimed: Boolean(completion?.claimedAt), claimedAt: completion?.claimedAt?.toISOString() || null }
  })
  const milestones = await prisma.growthWeeklyMilestoneClaim.findMany({ where: { userId, weekKey }, select: { milestone: true, claimedAt: true } })
  const milestoneDays = activeDays
  return {
    timezone: 'Asia/Shanghai',
    taskSystemLaunchAt: TASK_SYSTEM_LAUNCH_AT.toISOString(),
    today: { dateKey, items: activeItems, complete: activeItems.every((item) => item.completed) },
    passive: { dateKey, weekKey, items: passiveItems },
    week: {
      weekKey,
      completedDays: milestoneDays,
      totalDays: 7,
      milestones: WEEKLY_MILESTONES.map((item) => ({ ...item, claimable: milestoneDays >= item.days, claimed: milestones.some((claim) => claim.milestone === item.days && Boolean(claim.claimedAt)) })),
    },
    newLife: {
      total: newLifeItems.length,
      completedCount: newLifeItems.filter((item) => item.completed).length,
      items: newLifeItems,
    },
    economy: getEconomyReport(),
  }
}
