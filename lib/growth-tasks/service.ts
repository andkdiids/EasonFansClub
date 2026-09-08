import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { getShanghaiDateKey, getShanghaiDayRange, parseBeijingDate, shiftShanghaiDateKey } from '@/lib/checkin'
import { COMMUNITY_REWARD_LIMITS, COMMUNITY_REWARD_POINTS, getShanghaiWeekKey } from '@/lib/community-rewards'
import { awardRegistrationFee, reverseRegistrationFee } from '@/lib/registration-fee'
import {
  TASK_SYSTEM_LAUNCH_AT,
  WEEKLY_MILESTONES,
  getActiveActionTasks,
  getCoreActiveTasks,
  getEconomyReport,
  getGrowthTask,
  getRewardRuleGroups,
  getTasksByKind,
  resolveGrowthTaskDestination,
  type GrowthTaskCode,
} from './registry'
import { getCompletedCoreDayKeys, resolveTodayTaskProgress } from './progress'
import { isQualifiedPublishedPost } from '@/lib/post-moderation'
import { isProfileGenderComplete } from '@/lib/gender'

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

/**
 * Every formally settled entertainment mode records the same daily fact.
 * The daily task owns a separate fixed registration-fee reward; the game
 * settlement code keeps its own score/reward rules. The completion table and
 * PointLog business key make repeated settlement calls idempotent across HTTP
 * retries and websocket fallbacks.
 */
export async function recordEntertainmentGameCompletion(
  tx: GrowthTransaction,
  input: { userId: string; gameCode: string; gameId: string; now?: Date },
) {
  const now = input.now || new Date()
  return grantGrowthReward(tx, {
    userId: input.userId,
    taskCode: 'DAILY_GAME',
    sourceEventId: `${input.gameCode}:${input.gameId}`,
    reason: '在娱乐天空完成任意一局游戏',
    now,
  })
}

type GrowthRewardWindow = { start: Date; end: Date; limit: number }

function capWindows(task: NonNullable<ReturnType<typeof getGrowthTask>>, now: Date): GrowthRewardWindow[] {
  const windows: GrowthRewardWindow[] = []
  if (task.dailyCap !== undefined) {
    const range = getShanghaiDayRange(now)
    windows.push({ start: range.start, end: range.end, limit: task.dailyCap })
  }
  if (task.weeklyCap !== undefined) {
    const range = weekRange(getShanghaiWeekKey(now))
    windows.push({ ...range, limit: task.weeklyCap })
  }
  if (windows.length > 0) return windows

  if (task.frequency === 'daily') {
    const range = getShanghaiDayRange(now)
    return [{ start: range.start, end: range.end, limit: Number.MAX_SAFE_INTEGER }]
  }
  const range = weekRange(getShanghaiWeekKey(now))
  return [{ ...range, limit: Number.MAX_SAFE_INTEGER }]
}

/** Pure cap calculation shared by reward tests and the transactional grant. */
export function calculateGrowthRewardAmount(
  task: NonNullable<ReturnType<typeof getGrowthTask>>,
  input: { dailyUsed?: number; weeklyUsed?: number } = {},
) {
  const remainingCaps = [
    task.dailyCap === undefined ? Number.MAX_SAFE_INTEGER : task.dailyCap - (input.dailyUsed || 0),
    task.weeklyCap === undefined ? Number.MAX_SAFE_INTEGER : task.weeklyCap - (input.weeklyUsed || 0),
  ]
  const remaining = Math.max(0, Math.min(...remainingCaps))
  if (remaining <= 0) return 0
  return task.capUnit === 'events' ? task.reward : Math.min(task.reward, remaining)
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
    businessKey?: string
  },
) {
  const task = getGrowthTask(input.taskCode)
  const isActiveAction = task?.kind === 'active' && task.surface === 'action'
  const isDailyGame = task?.code === 'DAILY_GAME'
  if (!task || (task.kind !== 'passive' && !isActiveAction && !isDailyGame)) throw new Error('GROWTH_REWARD_TASK_NOT_REWARDABLE')
  const now = input.now || new Date()
  const sourceEventId = normalizeSource(input.sourceEventId)
  const periodKey = task.frequency === 'daily' ? getShanghaiDateKey(now) : getShanghaiWeekKey(now)
  const completion = await completeTask(tx, { userId: input.userId, taskCode: input.taskCode, periodKey, sourceEventId, now })
  if (!completion.eligible || !completion.completion) return { awardedAmount: 0, capped: true, duplicate: false }

  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`
  const businessKey = input.businessKey || stableBusinessKey([input.taskCode, input.userId, periodKey, sourceEventId])
  const original = await tx.pointLog.findUnique({ where: { businessKey }, select: { id: true } })
  if (original) return { awardedAmount: 0, capped: false, duplicate: true }

  const [window, ...additionalWindows] = capWindows(task, now)
  const getUsed = async (scopedWindow: GrowthRewardWindow) => {
    const where = {
      userId: input.userId,
      growthTaskCode: input.taskCode,
      points: { gt: 0 },
      createdAt: { gte: scopedWindow.start, lt: scopedWindow.end },
    } as const
    const [sum, count] = await Promise.all([
      tx.pointLog.aggregate({ where, _sum: { points: true } }),
      tx.pointLog.count({ where }),
    ])
    return task.capUnit === 'events' ? count : (sum._sum.points || 0)
  }
  if (!window) throw new Error('GROWTH_REWARD_WINDOW_MISSING')
  const used = await getUsed(window)
  const remaining = Math.max(0, window.limit - used)
  const additionalRemaining = await Promise.all(additionalWindows.map(async (scopedWindow) => {
    const scopedUsed = await getUsed(scopedWindow)
    return Math.max(0, scopedWindow.limit - scopedUsed)
  }))
  const effectiveRemaining = Math.max(0, Math.min(remaining, ...additionalRemaining))
  if (effectiveRemaining <= 0) {
    await tx.growthTaskCompletion.update({ where: { id: completion.completion.id }, data: { rewardAmount: 0 } })
    return { awardedAmount: 0, capped: true, duplicate: false }
  }
  const amount = task.capUnit === 'events' ? task.reward : Math.min(task.reward, effectiveRemaining)
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

/**
 * A public, approved post is one shared business fact for both post-growth
 * surfaces. The two tasks still keep separate completion and reward ledgers.
 */
export async function recordQualifiedPublishedPostGrowth(
  tx: GrowthTransaction,
  input: {
    userId: string
    postId: string
    post: { status: unknown; moderationStatus: unknown; isDeleted: unknown }
    now?: Date
  },
) {
  if (!isQualifiedPublishedPost(input.post)) {
    return { qualified: false, newLife: null, publishReward: null }
  }
  const now = input.now || new Date()
  const newLife = await completeTask(tx, {
    userId: input.userId,
    taskCode: 'FIRST_POST',
    periodKey: 'ALL',
    sourceEventId: input.postId,
    now,
  })
  const publishReward = await grantGrowthReward(tx, {
    userId: input.userId,
    taskCode: 'PUBLISH_POST_ACTIVE',
    sourceEventId: `post:${input.postId}`,
    businessKey: stableBusinessKey(['published-post', input.userId, input.postId]),
    reason: '发布帖子',
    postId: input.postId,
    now,
  })
  return { qualified: true, newLife, publishReward }
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
        customGender: true,
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
      isProfileGenderComplete(user) &&
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

async function completedActiveDays(tx: GrowthTransaction, userId: string, weekKey: string, now = new Date()) {
  const coreCodes = getCoreActiveTasks().map((task) => task.code)
  const weekDateKeys = dayKeysForWeek(weekKey)
  const [rows, checkIns, prescriptions, commentRewards] = await Promise.all([
    tx.growthTaskCompletion.findMany({ where: { userId, taskCode: { in: coreCodes }, periodKey: { in: weekDateKeys } }, select: { taskCode: true, periodKey: true } }),
    tx.checkIn.findMany({ where: { userId, checkinDateKey: { in: weekDateKeys } }, select: { checkinDateKey: true } }),
    tx.entertainmentDailyDraw.findMany({ where: { userId, dateKey: { in: weekDateKeys } }, select: { dateKey: true } }),
    tx.pointLog.findMany({ where: { userId, action: 'COMMENT_POST', points: { gt: 0 }, createdAt: { gte: weekRange(weekKey).start, lt: weekRange(weekKey).end } }, select: { dateKey: true, createdAt: true } }),
  ])
  const commentRewardCountsByDate = new Map<string, number>(weekDateKeys.map((dateKey) => [dateKey, 0]))
  for (const row of commentRewards) {
    const rewardDateKey = row.dateKey || getShanghaiDateKey(row.createdAt)
    commentRewardCountsByDate.set(rewardDateKey, (commentRewardCountsByDate.get(rewardDateKey) || 0) + 1)
  }
  return getCompletedCoreDayKeys(weekKey, rows, now, {
    checkinDateKeys: checkIns.map((row) => row.checkinDateKey),
    prescriptionDateKeys: prescriptions.map((row) => row.dateKey),
    commentRewardCountsByDate,
  }).size
}

export async function claimWeeklyMilestone(userId: string, milestone: number, now = new Date()) {
  const definition = WEEKLY_MILESTONES.find((item) => item.days === milestone)
  if (!definition) throw new Error('INVALID_WEEKLY_MILESTONE')
  const weekKey = getShanghaiWeekKey(now)
  return prismaTransaction(async (tx) => {
    const days = await completedActiveDays(tx, userId, weekKey, now)
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
  const weekDateKeys = dayKeysForWeek(weekKey)
  const [completions, newLifeCompletions, pointLogs, checkIns, prescriptions, communityRewardLogs, duelCount] = await Promise.all([
    prisma.growthTaskCompletion.findMany({ where: { userId, periodKey: { in: [dateKey, weekKey, ...weekDateKeys] } }, orderBy: { completedAt: 'asc' } }),
    prisma.growthTaskCompletion.findMany({ where: { userId, taskCode: { in: getTasksByKind('newLife').map((task) => task.code) }, oneTimeKey: { not: null } }, orderBy: { completedAt: 'asc' } }),
    prisma.pointLog.findMany({ where: { userId, growthTaskCode: { not: null }, createdAt: { gte: weekRange(weekKey).start, lt: weekRange(weekKey).end } }, select: { growthTaskCode: true, points: true, createdAt: true } }),
    prisma.checkIn.findMany({ where: { userId, checkinDateKey: { in: weekDateKeys } }, select: { checkinDateKey: true } }),
    prisma.entertainmentDailyDraw.findMany({ where: { userId, dateKey: { in: weekDateKeys } }, select: { dateKey: true } }),
    prisma.pointLog.findMany({ where: { userId, action: { in: ['COMMENT_POST', 'POST_COMMENT_RECEIVED'] }, createdAt: { gte: weekRange(weekKey).start, lt: weekRange(weekKey).end } }, select: { action: true, points: true, dateKey: true, createdAt: true } }),
    prisma.guessSongDuelMatch.count({ where: { status: 'FINISHED', finishedAt: { gte: weekRange(weekKey).start, lt: weekRange(weekKey).end }, GuessSongDuelPlayer: { some: { userId } } } }),
  ])
  const commentRewardCountsByDate = new Map<string, number>(weekDateKeys.map((dateKey) => [dateKey, 0]))
  const receivedCommentCountsByDate = new Map<string, number>()
  for (const row of communityRewardLogs) {
    if (row.points <= 0) continue
    const rewardDateKey = row.dateKey || getShanghaiDateKey(row.createdAt)
    const target = row.action === 'COMMENT_POST' ? commentRewardCountsByDate : receivedCommentCountsByDate
    target.set(rewardDateKey, (target.get(rewardDateKey) || 0) + 1)
  }
  const gameCompletionCountsByDate = new Map<string, number>()
  for (const row of completions) {
    if (row.taskCode !== 'DAILY_GAME' || !weekDateKeys.includes(row.periodKey)) continue
    gameCompletionCountsByDate.set(row.periodKey, (gameCompletionCountsByDate.get(row.periodKey) || 0) + 1)
  }
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
    DAILY_GAME: pointLogs
      .filter((row) => row.growthTaskCode === 'DAILY_GAME' && row.points > 0 && row.createdAt >= todayRange.start && row.createdAt < todayRange.end)
      .reduce((sum, row) => sum + row.points, 0),
    DAILY_COMMENT: communityRewardLogs
      .filter((row) => row.action === 'COMMENT_POST' && row.points > 0 && (row.dateKey || getShanghaiDateKey(row.createdAt)) === dateKey)
      .reduce((sum, row) => sum + row.points, 0),
  }
  const active = getCoreActiveTasks()
  const activeActions = getActiveActionTasks()
  const passive = getTasksByKind('passive')
  const activeActionItems = activeActions.map((task) => {
    const positiveRows = pointLogs.filter((row) => row.growthTaskCode === task.code && row.points > 0 && row.createdAt >= todayRange.start && row.createdAt < todayRange.end)
    const completionRows = completions.filter((row) => row.taskCode === task.code && row.periodKey === dateKey)
    const earned = positiveRows.reduce((sum, row) => sum + row.points, 0)
    const cap = task.dailyCap || 0
    // Publish completions are recorded for every valid public post, including
    // posts that arrive after today's reward cap is exhausted. The daily row
    // is still a 0/1 task, while the ledger independently decides whether the
    // event earned money.
    const progress = task.code === 'PUBLISH_POST_ACTIVE'
      ? Math.min(cap, completionRows.length)
      : Math.min(cap, positiveRows.length)
    return {
      ...task,
      progress,
      earned,
      cap,
      completed: cap > 0 && progress >= cap,
      todayReward: earned,
    }
  })
  const businessFacts = {
    checkinDateKeys: checkIns.map((row) => row.checkinDateKey),
    prescriptionDateKeys: prescriptions.map((row) => row.dateKey),
    commentRewardCountsByDate,
    gameCompletionCountsByDate,
  }
  const todayProgress = resolveTodayTaskProgress({
    dateKey,
    completionRows: completions,
    businessFacts,
    actionProgress: activeActionItems.map((item) => ({ taskCode: item.code, progress: item.progress, earned: item.earned, cap: item.cap })),
  })
  const statusByCode = new Map(todayProgress.tasks.map((item) => [item.code, item]))
  const todayItems = [...active, ...activeActions].map((task) => {
    const status = statusByCode.get(task.code)
    const isAction = task.surface === 'action'
    return {
      ...task,
      actionHref: resolveGrowthTaskDestination(task.code) || undefined,
      reward: task.reward,
      completed: Boolean(status?.completed),
      ...(status?.cap !== undefined ? {
        progress: status?.progress || 0,
        earned: status?.earned || 0,
        cap: status.cap,
      } : {}),
      todayReward: isAction ? status?.earned || 0 : activeRewardByCode[task.code] || 0,
    }
  })
  const activeDays = getCompletedCoreDayKeys(weekKey, completions, now, businessFacts).size
  const passiveItems = passive.map((task) => {
    if (task.code === 'POST_COMMENT_RECEIVED') {
      const progress = Math.min(COMMUNITY_REWARD_LIMITS.postCommentReceivedDaily, task.dailyCap || 0, receivedCommentCountsByDate.get(dateKey) || 0)
      const earned = progress * COMMUNITY_REWARD_POINTS.postCommentReceived
      return {
        ...task,
        actionHref: resolveGrowthTaskDestination(task.code) || undefined,
        earned,
        progress,
        positiveEvents: progress,
        reversals: 0,
        cap: task.dailyCap,
        completed: progress >= (task.completionThreshold || task.dailyCap || 1),
      }
    }
    if (task.code === 'LISTEN_DUEL_BRANCH') {
      return {
        ...task,
        actionHref: resolveGrowthTaskDestination(task.code) || undefined,
        earned: 0,
        progress: duelCount,
        positiveEvents: duelCount,
        reversals: 0,
        cap: undefined,
        completed: duelCount >= (task.completionThreshold || 1),
      }
    }
    const start = task.frequency === 'daily' ? getShanghaiDayRange(now).start : weekRange(weekKey).start
    const end = task.frequency === 'daily' ? getShanghaiDayRange(now).end : weekRange(weekKey).end
    const scoped = pointLogs.filter((row) => row.growthTaskCode === task.code && row.createdAt >= start && row.createdAt < end)
    const positiveRows = scoped.filter((row) => row.points > 0)
    const negativeRows = scoped.filter((row) => row.points < 0)
    const earned = scoped.reduce((sum, row) => sum + row.points, 0)
    const cap = task.frequency === 'daily' ? task.dailyCap : task.weeklyCap
    const progress = task.capUnit === 'events' ? positiveRows.length : earned
    return { ...task, actionHref: resolveGrowthTaskDestination(task.code) || undefined, earned, progress, positiveEvents: positiveRows.length, reversals: negativeRows.length, cap, completed: cap !== undefined && progress >= cap }
  })
  const newLifeItems = getTasksByKind('newLife').map((task) => {
    const completion = newLifeCompletions.find((row) => row.taskCode === task.code)
    return { ...task, actionHref: resolveGrowthTaskDestination(task.code) || undefined, completed: Boolean(completion), claimed: Boolean(completion?.claimedAt), claimedAt: completion?.claimedAt?.toISOString() || null }
  })
  const milestones = await prisma.growthWeeklyMilestoneClaim.findMany({ where: { userId, weekKey }, select: { milestone: true, claimedAt: true } })
  const milestoneDays = activeDays
  const rewardRules = getRewardRuleGroups().map((group) => group.key === 'weekly'
    ? {
        ...group,
        items: group.items.map((rule) => {
          const milestone = rule.milestoneDays === undefined
            ? null
            : milestones.find((claim) => claim.milestone === rule.milestoneDays)
          return milestone
            ? { ...rule, claimable: milestoneDays >= (rule.milestoneDays || 0), claimed: Boolean(milestone.claimedAt) }
            : rule
        }),
      }
    : group)
  return {
    timezone: 'Asia/Shanghai',
    taskSystemLaunchAt: TASK_SYSTEM_LAUNCH_AT.toISOString(),
    today: {
      dateKey,
      // Bonus actions remain visible in the same list but never change the
      // core daily-completion denominator used by the weekly milestones.
      total: todayProgress.coreTotal,
      completed: todayProgress.coreCompleted,
      coreTotal: todayProgress.coreTotal,
      coreCompleted: todayProgress.coreCompleted,
      bonusTotal: todayProgress.bonusTotal,
      bonusCompleted: todayProgress.bonusCompleted,
      listTotal: todayProgress.total,
      listCompleted: todayProgress.completed,
      items: todayItems,
      complete: todayProgress.coreCompleted === todayProgress.coreTotal,
    },
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
    rewardRules,
    economy: getEconomyReport(),
  }
}
