import { createHash, randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { getShanghaiWeekKey } from './community-rewards'
import { completedGrowthTaskDates } from './growth-tasks/service'
import { getTodayTasks } from './growth-tasks/registry'
import { createNotificationWithDb } from './notification-write'
import { parsePostShareSnapshot, POST_SHARE_MESSAGE_TYPE } from './post-share-types'
import { shunDay } from './shun-master-rules'
import { shunItemsFeatureEnabled, validateShunItemDraft } from './shun-item-config'
import { drawShunItem, SHUN_COMMUNITY_DROP_RULES, SHUN_WEEKLY_MILESTONES } from './shun-item-rules'
import { lockShunItemUsers, postShunItemMovement } from './shun-item-inventory'
import { shunTransaction } from './shun-master'

const BATCH = 25
/** 社区互动当日有效判定总数计数器（复用 ShunItemDailyCounter，不新增字段）。 */
export const SHUN_COMMUNITY_TOTAL_COUNTER = 'COMMUNITY_TOTAL'
export const SHUN_COMMUNITY_GUARANTEE_MARK = 'GUARANTEE'

type RewardRules = NonNullable<ReturnType<typeof validateShunItemDraft>>['rules']

/** 每日社区互动有效判定总额度，随配置动态计算（当前为 1+1+5+3+10=20）。 */
export function communityCheckBudget(rules: RewardRules): number {
  return Object.values(rules.drops).reduce((total, drop) => total + drop.dailyChecks, 0)
}
const taskKinds: Readonly<Record<string, keyof typeof SHUN_COMMUNITY_DROP_RULES>> = {
  DAILY_CHECKIN: 'CHECK_IN',
  DAILY_PRESCRIPTION: 'PRESCRIPTION',
  DAILY_COMMENT: 'COMMENT',
  POST_LIKE_ACTIVE: 'LIKE',
}

type Source = { id: string; userId: string; occurredAt: Date; kind: string; sourceEventId: string }
type Share = { id: string; userId: string; occurredAt: Date; metadata: unknown }

async function enqueueCommittedFacts(configVersion: number, from: Date, commentMinChars: number) {
  const taskCodes = getTodayTasks().map(({ code }) => code)
  const [tasks, shares] = await Promise.all([
    prisma.$queryRaw<Source[]>`
      SELECT g.id, g.userId, g.completedAt AS occurredAt, g.taskCode AS kind, g.sourceEventId
      FROM GrowthTaskCompletion g
      LEFT JOIN ShunItemRewardEvent e ON e.sourceType = 'TASK' AND e.sourceId = g.id
      WHERE g.createdAt >= ${from} AND g.completedAt >= ${from}
        AND g.taskCode IN (${Prisma.join(taskCodes)}) AND e.sourceId IS NULL
      ORDER BY g.createdAt, g.id LIMIT ${BATCH}`,
    prisma.$queryRaw<Share[]>`
      SELECT m.id, m.senderId AS userId, m.createdAt AS occurredAt, m.metadata
      FROM DirectMessage m
      LEFT JOIN ShunItemRewardEvent e ON e.sourceType = 'SHARE' AND e.sourceId = m.id
      WHERE m.type = ${POST_SHARE_MESSAGE_TYPE} AND m.createdAt >= ${from} AND e.sourceId IS NULL
      ORDER BY m.createdAt, m.id LIMIT ${BATCH}`,
  ])

  const entries: Prisma.ShunItemRewardEventCreateManyInput[] = []
  const rolls = () => ({
    dropRoll: randomInt(100), itemRoll: randomInt(100), mainRoll: randomInt(100),
    weeklyRolls: SHUN_WEEKLY_MILESTONES.map(() => randomInt(100)),
  })

  for (const task of tasks) {
    const day = shunDay(task.occurredAt)
    const kind = taskKinds[task.kind] ?? 'TASK'
    let occurrenceKey: string | null = null
    if (kind === 'CHECK_IN' || kind === 'PRESCRIPTION') occurrenceKey = day
    if (kind === 'LIKE') occurrenceKey = /^post:([^:]+):date:/.exec(task.sourceEventId)?.[1] ?? null
    if (kind === 'COMMENT') {
      const reply = await prisma.reply.findUnique({ where: { id: task.sourceEventId }, select: {
        content: true, stickerId: true, moderationStatus: true, authorId: true, postId: true, Post: { select: { authorId: true } },
      } })
      const content = reply?.content.normalize('NFKC').replace(/\s/gu, '') ?? ''
      if (reply && reply.authorId === task.userId && reply.authorId !== reply.Post.authorId
        && !reply.stickerId && reply.moderationStatus === 'NORMAL' && Array.from(content).length >= commentMinChars) {
        occurrenceKey = createHash('sha256').update(JSON.stringify([reply.postId, content])).digest('hex')
      }
    }
    entries.push({ sourceType: 'TASK', sourceId: task.id, userId: task.userId, occurredAt: task.occurredAt,
      day, kind, occurrenceKey, configVersion, ...rolls() })
  }

  for (const share of shares) {
    const snapshot = parsePostShareSnapshot(share.metadata)
    entries.push({ sourceType: 'SHARE', sourceId: share.id, userId: share.userId, occurredAt: share.occurredAt,
      day: shunDay(share.occurredAt), kind: 'SHARE', occurrenceKey: snapshot?.postId ?? null, configVersion, ...rolls() })
  }
  if (entries.length) await prisma.shunItemRewardEvent.createMany({ data: entries, skipDuplicates: true })
}

/**
 * 累加当日社区互动有效判定总数并返回累加后的值。
 *
 * 首次写入时以各行为已有的真实计数之和作为起点：新版上线当天用户已用掉的
 * 判定机会不会被清零，保底进度因此可以从真实记录继续。
 */
async function bumpCommunityCheckTotal(
  tx: Prisma.TransactionClient, userId: string, day: string, rules: RewardRules,
): Promise<number> {
  const counter = { userId_day_counter: { userId, day, counter: SHUN_COMMUNITY_TOTAL_COUNTER } }
  const row = await tx.shunItemDailyCounter.findUnique({ where: counter })
  if (row) {
    const next = await tx.shunItemDailyCounter.update({ where: counter, data: { count: { increment: 1 } } })
    return next.count
  }
  const perKind = await tx.shunItemDailyCounter.findMany({
    where: { userId, day, counter: { in: Object.keys(rules.drops) } }, select: { count: true },
  })
  // 调用点已在上面为本条事件累加过对应类型的计数，这里不再 +1。
  const base = perKind.reduce((sum, item) => sum + item.count, 0)
  const created = await tx.shunItemDailyCounter.create({
    data: { userId, day, counter: SHUN_COMMUNITY_TOTAL_COUNTER, count: base },
  })
  return created.count
}

async function processRewardEvent(sourceType: string, sourceId: string, userId: string, enabledFrom: Date) {
  await shunTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (user) await lockShunItemUsers(tx, [userId])
    const whereEvent = { sourceType_sourceId: { sourceType, sourceId } }
    const event = await tx.shunItemRewardEvent.findUnique({ where: whereEvent })
    if (!event || event.processedAt) return
    const configVersion = event.configVersion
    const version = await tx.shunItemConfigVersion.findUnique({ where: { version: configVersion }, include: { definitions: true } })
    const draft = validateShunItemDraft(version)
    const eligible = user && await tx.user.findFirst({ where: { id: userId, status: 'ACTIVE', isDeleted: false, permanentlyOptedOutAt: null }, select: { id: true } })
    if (!draft?.enabled || !eligible || event.occurredAt < enabledFrom) {
      await tx.shunItemRewardEvent.update({ where: whereEvent, data: { processedAt: new Date() } })
      return
    }

    const { rules } = draft
    const pool = draft.definitions.filter((item) => item.enabled).map(({ code, weight }) => [code, weight] as const)
    const { day } = event
    const where = { userId_day: { userId, day } }
    const daily = await tx.shunItemDaily.upsert({ where, create: { userId, day }, update: {} })
    const grant = async (type: 'DAILY_MAIN' | 'WEEKLY_REWARD' | 'COMMUNITY_DROP', requestKey: string, roll: number) => {
      const code = drawShunItem(pool, () => roll)
      const { entry } = await postShunItemMovement(tx, { userId, code, type, requestKey, day, configVersion })
      const name = draft.definitions.find((item) => item.code === code)?.name
      if (type !== 'COMMUNITY_DROP') await createNotificationWithDb(tx, { data: {
        type: 'SYSTEM', recipientId: userId, title: type === 'DAILY_MAIN' ? '顺大师每日主线奖励' : '顺大师每周累计奖励',
        content: `获得顺大师道具 · ${name}`, link: '/shun-master?items=1', key: `shun:item:${entry.id}`,
      } })
      return entry
    }

    if (event.sourceType === 'TASK') {
      const weekStart = getShanghaiWeekKey(event.occurredAt)
      const dates = await completedGrowthTaskDates(tx, userId, weekStart, event.occurredAt)
      const firstDay = shunDay(enabledFrom)
      if (dates.has(firstDay)) {
        const preLaunch = await completedGrowthTaskDates(tx, userId, weekStart, enabledFrom, enabledFrom)
        if (preLaunch.has(firstDay)) dates.delete(firstDay)
      }
      const completed = [...dates].filter((date) => date >= firstDay && date <= day)
      if (rules.dailyMain && !daily.mainGranted && completed.includes(day)) {
        await grant('DAILY_MAIN', day, event.mainRoll)
        await tx.shunItemDaily.update({ where, data: { mainGranted: true } })
      }
      const weeklyRolls = event.weeklyRolls
      if (Array.isArray(weeklyRolls)) {
        for (const [index, milestone] of SHUN_WEEKLY_MILESTONES.entries()) {
          if (!rules.weekly[milestone] || completed.length < milestone) continue
          const key = { userId_weekStart_milestone: { userId, weekStart, milestone } }
          if (await tx.shunItemWeeklyGrant.findUnique({ where: key })) continue
          const roll = weeklyRolls[index]
          if (typeof roll !== 'number') throw new Error('INVALID_SHUN_WEEKLY_ROLL')
          const entry = await grant('WEEKLY_REWARD', `${weekStart}:${milestone}`, roll)
          await tx.shunItemWeeklyGrant.create({ data: { userId, weekStart, milestone, entryId: entry.id } })
        }
      }
    }

    if (rules.community && (rules.dailyMax >= 2 || !rules.dailyMain) && !daily.behaviorGranted && event.occurrenceKey
      && Object.hasOwn(rules.drops, event.kind)) {
      const drop = rules.drops[event.kind as keyof typeof rules.drops]
      const prior = await tx.shunItemRewardEvent.findFirst({ where: {
        userId, kind: event.kind, occurrenceKey: event.occurrenceKey, processedAt: { not: null },
      }, select: { sourceId: true } })
      const counter = { userId_day_counter: { userId, day, counter: event.kind } }
      const count = await tx.shunItemDailyCounter.findUnique({ where: counter })
      if (!prior && (count?.count ?? 0) < drop.dailyChecks) {
        await tx.shunItemDailyCounter.upsert({
          where: counter, create: { userId, day, counter: event.kind, count: 1 }, update: { count: { increment: 1 } },
        })
        // 隐藏保底：当日全部有效判定用尽仍无掉落时，最后一次必定发一个。
        // 阈值来自配置（各行为 dailyChecks 之和），不硬编码。
        const budget = communityCheckBudget(rules)
        const used = await bumpCommunityCheckTotal(tx, userId, day, rules)
        const hit = event.dropRoll < drop.chance
        const guarantee = !hit && budget > 0 && used >= budget
        if (hit || guarantee) {
          // 保底与概率掉落共用同一七种道具池与同一次已落库的 itemRoll，
          // 不重新抽取，也不提高珍藏/隐藏概率；仅在 requestKey 上留内部标记。
          await grant('COMMUNITY_DROP', guarantee
            ? `${day}:${event.kind}:${SHUN_COMMUNITY_GUARANTEE_MARK}`
            : `${day}:${event.kind}`, event.itemRoll)
          await tx.shunItemDaily.update({ where, data: { behaviorGranted: true } })
        }
      }
    }
    await tx.shunItemRewardEvent.update({ where: whereEvent, data: { processedAt: new Date() } })
  })
}

/**
 * 保底兜底：当天已用完全部有效判定但仍未获得社区互动道具的用户，补发一次保底。
 *
 * 只处理北京时间当天，永不追溯历史日期；幂等由
 * (userId, COMMUNITY_DROP, `${day}:${kind}:GUARANTEE`) 的唯一约束保证，
 * 重复执行不会多发。来源行为取该用户当天最后一条已处理事件，
 * 因此用户端看到的仍是「社区互动 · 具体行为」，不暴露保底。
 */
export async function reconcileShunCommunityGuarantee(now = new Date()) {
  if (!shunItemsFeatureEnabled()) return
  const active = await prisma.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, include: { definitions: true } })
  const draft = validateShunItemDraft(active)
  if (!active || !draft?.enabled) return
  const { rules } = draft
  const budget = communityCheckBudget(rules)
  if (!rules.community || !(rules.dailyMax >= 2 || !rules.dailyMain) || budget <= 0) return
  const day = shunDay(now)
  const counters = await prisma.shunItemDailyCounter.groupBy({
    by: ['userId'], where: { day, counter: { in: Object.keys(rules.drops) } }, _sum: { count: true },
  })
  const reached = counters.filter((row) => (row._sum.count ?? 0) >= budget).map((row) => row.userId)
  if (!reached.length) return
  const granted = await prisma.shunItemEntry.findMany({
    where: { userId: { in: reached }, day, type: 'COMMUNITY_DROP' }, select: { userId: true },
  })
  const done = new Set(granted.map((row) => row.userId))
  const pool = draft.definitions.filter((item) => item.enabled).map(({ code, weight }) => [code, weight] as const)
  for (const userId of reached) {
    if (done.has(userId)) continue
    const last = await prisma.shunItemRewardEvent.findFirst({
      where: { userId, day, processedAt: { not: null } }, orderBy: [{ occurredAt: 'desc' }], select: { kind: true },
    })
    if (!last) continue
    try {
      await shunTransaction(async (tx) => {
        await lockShunItemUsers(tx, [userId])
        const daily = await tx.shunItemDaily.upsert({ where: { userId_day: { userId, day } }, create: { userId, day }, update: {} })
        if (daily.behaviorGranted) return
        const code = drawShunItem(pool)
        await postShunItemMovement(tx, {
          userId, code, type: 'COMMUNITY_DROP', day, configVersion: active.version,
          requestKey: `${day}:${last.kind}:${SHUN_COMMUNITY_GUARANTEE_MARK}`,
        })
        await tx.shunItemDaily.update({ where: { userId_day: { userId, day } }, data: { behaviorGranted: true } })
      })
    } catch (error) {
      console.error('[shun-item.guarantee.reconcile-failed]', { name: error instanceof Error ? error.name : 'UNKNOWN' })
    }
  }
}

let sweeping = false

export async function runShunItemRewardSweep() {
  if (sweeping || !shunItemsFeatureEnabled()) return
  sweeping = true
  try {
    const active = await prisma.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, include: { definitions: true } })
    const draft = validateShunItemDraft(active)
    if (!active || !draft?.enabled) return
    const disabled = await prisma.shunItemConfigVersion.findFirst({
      where: { version: { lt: active.version }, enabled: false }, orderBy: { version: 'desc' },
    })
    const firstEnabled = await prisma.shunItemConfigVersion.findFirst({
      where: { enabled: true, version: { gt: disabled?.version ?? 0 } }, orderBy: { version: 'asc' },
    })
    if (!firstEnabled) return
    await enqueueCommittedFacts(active.version, firstEnabled.createdAt, draft.rules.commentMinChars)
    const due = await prisma.shunItemRewardEvent.findMany({
      where: { processedAt: null, retryAt: { lte: new Date() } },
      orderBy: [{ occurredAt: 'asc' }, { sourceId: 'asc' }], take: BATCH * 2,
    })
    for (const event of due) {
      try {
        await processRewardEvent(event.sourceType, event.sourceId, event.userId, firstEnabled.createdAt)
      } catch (error) {
        const delay = Math.min(60 * 60_000, 15_000 * 2 ** Math.min(event.attempts, 8))
        await prisma.shunItemRewardEvent.updateMany({
          where: { sourceType: event.sourceType, sourceId: event.sourceId, processedAt: null },
          data: { retryAt: new Date(Date.now() + delay), attempts: { increment: 1 } },
        })
        console.error('[shun-item.worker.event-failed]', { sourceType: event.sourceType, sourceId: event.sourceId, name: error instanceof Error ? error.name : 'UNKNOWN' })
      }
    }
    // 保底兜底放在事件处理之后，且自身失败不得影响主扫描。
    try { await reconcileShunCommunityGuarantee() } catch (error) {
      console.error('[shun-item.guarantee.reconcile-skipped]', { name: error instanceof Error ? error.name : 'UNKNOWN' })
    }
  } finally {
    sweeping = false
  }
}
