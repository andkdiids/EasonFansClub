import { createHash } from 'node:crypto'
import { Prisma, type Activity, type TopicActivityLottery } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lockTopicV2Activity, requireTopicV2Program, withTopicV2Transaction } from '@/lib/topic-activity-v2'
import { isTopicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'
import { defaultTopicLotteryConfig, normalizeTopicLotteryConfig, TopicLotteryError, type TopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { sampleTopicLotteryUsers } from '@/lib/topic-activity-v2-lottery-random'
import { getTopicLotteryPiiConfigStatus } from '@/lib/topic-activity-v2-lottery-private'
import type { TopicActivityV2Program } from '@/lib/topic-activity-v2-config'

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]))
  return value
}
// MySQL JSON reorders object keys. Snapshot integrity hashes must be canonical
// on both sides of a real round trip, never depend on JS insertion order.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function fail(code: string, message: string, status = 409): never { throw new TopicLotteryError(code, message, status) }
type DB = Pick<Prisma.TransactionClient, 'topicActivitySubmission' | 'topicActivityLotteryEligibility'>
async function sources(db: DB, activity: Activity, config: TopicLotteryConfig, userId?: string) {
  if (!activity.activityPostId || !config.eligibilityDeadline || !config.sourceEntryIds.length) return []
  const rows = await db.topicActivitySubmission.findMany({ where: {
    activityId: activity.id, ...(userId ? { userId } : {}), rewardEntryId: { in: config.sourceEntryIds },
    submittedAt: { lte: new Date(config.eligibilityDeadline), ...(activity.startsAt ? { gte: activity.startsAt } : {}) },
    status: { in: ['APPROVED', 'PENDING'] }, commentDeletedAt: null,
    Comment: { is: { postId: activity.activityPostId, parentId: null, isDeleted: false } }, User: { is: { status: 'ACTIVE', isDeleted: false } },
    TaskImageAssets: { some: { purpose: 'FORM_ANSWER' } },
  }, include: { TaskImageAssets: { select: { storageKey: true, uploadedByUserId: true, purpose: true } } },
  orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], take: 50_001 })
  if (rows.length > 50_000) fail('LOTTERY_CAPACITY_REVIEW_REQUIRED', '候选规模需要专项处理，不能截断名单开奖')
  return rows.filter((row) => {
    const snapshot = record(row.rewardSnapshot), minimum = typeof snapshot.minImages === 'number' ? Math.max(1, snapshot.minImages) : 1
    return (!activity.endsAt || row.submittedAt <= activity.endsAt) && typeof snapshot.platformKey === 'string'
      && row.TaskImageAssets.length >= minimum && row.TaskImageAssets.every((asset) => asset.purpose === 'FORM_ANSWER' && asset.uploadedByUserId === row.userId
        && isTopicActivityOriginalObjectKey(asset.storageKey, activity.id, 'FORM_ANSWER'))
  })
}
function sourceSnapshot(row: Awaited<ReturnType<typeof sources>>[number]) {
  return { submissionId: row.id, userId: row.userId, rewardEntryId: row.rewardEntryId, submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() || null, reviewerId: row.reviewedById, platformKey: record(row.rewardSnapshot).platformKey }
}
export async function lockTopicLottery(tx: Prisma.TransactionClient, activityId: string) {
  const activity = await lockTopicV2Activity(tx, activityId)
  await tx.$queryRawUnsafe('SELECT id FROM TopicActivityLottery WHERE activityId = ? FOR UPDATE', activityId)
  const lottery = await tx.topicActivityLottery.findUnique({ where: { activityId } })
  if (!lottery) fail('LOTTERY_NOT_FOUND', '抽奖未开启', 404)
  return { activity, lottery, config: normalizeTopicLotteryConfig(lottery.config) }
}
async function audit(tx: Prisma.TransactionClient, lottery: TopicActivityLottery, action: string, actorId: string | null, detail?: unknown, entityId?: string) {
  await tx.topicActivityLotteryAudit.create({ data: { activityId: lottery.activityId, lotteryConfigId: lottery.id, action, actorId, entityId, ...(detail ? { detail: json(detail) } : {}) } })
}
export async function syncTopicLotteryEligibilityInTransaction(tx: Prisma.TransactionClient, activity: Activity, userId: string, now: Date) {
  const lottery = await tx.topicActivityLottery.findUnique({ where: { activityId: activity.id } })
  if (!lottery?.enabled || await tx.topicActivityLotteryDraw.findUnique({ where: { activityId: activity.id }, select: { id: true } })) return
  const config = normalizeTopicLotteryConfig(lottery.config)
  const candidates = await sources(tx, activity, config, userId)
  const approved = candidates.find((row) => row.status === 'APPROVED')
  if (candidates.length && !lottery.fairnessLockedAt) await tx.topicActivityLottery.update({ where: { id: lottery.id }, data: { fairnessLockedAt: now } })
  const key = { activityId_userId: { activityId: activity.id, userId } }
  const previous = await tx.topicActivityLotteryEligibility.findUnique({ where: key })
  if (!approved) {
    if (previous?.valid) {
      await tx.topicActivityLotteryEligibility.update({ where: key, data: { valid: false } })
      await audit(tx, lottery, 'ELIGIBILITY_REVOKED_BEFORE_FREEZE', null, { userId }, previous.id)
    }
    return
  }
  const qualified = await tx.topicActivityLotteryEligibility.upsert({ where: key,
    create: { activityId: activity.id, lotteryConfigId: lottery.id, userId, sourceSubmissionId: approved.id, sourceSnapshot: json(sourceSnapshot(approved)), qualifiedAt: now },
    update: { valid: true, sourceSubmissionId: approved.id, sourceSnapshot: json(sourceSnapshot(approved)) },
  })
  if (!previous || !previous.valid) await audit(tx, lottery, previous ? 'ELIGIBILITY_RESTORED' : 'ELIGIBILITY_GRANTED', approved.reviewedById, { userId, sourceSubmissionId: approved.id }, qualified.id)
}
export async function lockTopicLotteryRulesForSubmission(tx: Prisma.TransactionClient, activity: Activity, userId: string, now: Date) {
  // Called after screenshot binding. Uploads alone never qualify or lock rules.
  await syncTopicLotteryEligibilityInTransaction(tx, activity, userId, now)
}
export async function assertTopicLotterySourceRules(tx: Prisma.TransactionClient, activity: Activity, next: TopicActivityV2Program) {
  const lottery = await tx.topicActivityLottery.findUnique({ where: { activityId: activity.id } })
  if (!lottery?.enabled || !lottery.fairnessLockedAt || lottery.state === 'DRAWN') return
  const config = normalizeTopicLotteryConfig(lottery.config), previous = requireTopicV2Program(activity)
  const rules = (program: TopicActivityV2Program) => ({ enabled: program.enabled && program.platformRewards.enabled, sources: config.sourceEntryIds.map((entryId) => {
    const entry = program.entries.find((item) => item.id === entryId)
    return entry ? { id: entry.id, platformKey: entry.platformKey, enabled: entry.enabled, minImages: entry.minImages, maxImages: entry.maxImages, startsAt: entry.startsAt, endsAt: entry.endsAt } : null
  }) })
  if (hash(rules(previous)) !== hash(rules(next))) fail('LOTTERY_SOURCE_RULES_LOCKED', '已有截图参与，不能更改抽奖来源、截图要求或关闭资格入口')
}
// Caller holds Activity FOR UPDATE. Generic activity editing must not bypass
// the lottery rule lock by changing the time window used to qualify evidence.
export async function assertTopicLotteryActivityWindow(tx: Prisma.TransactionClient, activityId: string, next: { startsAt: Date | null; endsAt: Date | null; type: Activity['type']; participationMode?: Activity['participationMode']; formSchema?: unknown; allowImageAttachments?: boolean }) {
  const lottery = await tx.topicActivityLottery.findUnique({ where: { activityId }, select: { fairnessLockedAt: true } })
  if (!lottery || (!lottery.fairnessLockedAt && !await tx.topicActivityLotteryDraw.findUnique({ where: { activityId }, select: { id: true } }))) return
  const current = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: { startsAt: true, endsAt: true, type: true, participationMode: true, formSchema: true, allowImageAttachments: true } })
  if (current.startsAt?.getTime() !== next.startsAt?.getTime() || current.endsAt?.getTime() !== next.endsAt?.getTime() || current.type !== next.type
    || next.participationMode !== undefined && next.participationMode !== current.participationMode
    || next.formSchema !== undefined && hash(next.formSchema) !== hash(current.formSchema)
    || next.allowImageAttachments !== undefined && next.allowImageAttachments !== current.allowImageAttachments) {
    fail('LOTTERY_ACTIVITY_WINDOW_LOCKED', '已有抽奖参与或名单已冻结，不能修改活动资格时间、类型、表单或图片门槛')
  }
}
export async function saveTopicLotteryConfig(activityId: string, actorId: string, input: unknown, now = new Date()) {
  const config = normalizeTopicLotteryConfig(input)
  if (config.enabled && !getTopicLotteryPiiConfigStatus().usable) fail('LOTTERY_ADDRESS_KEY_UNAVAILABLE', '请先安全配置收件加密密钥，再开启实物抽奖', 503)
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, activityId)
    const program = requireTopicV2Program(activity)
    if (config.enabled && !program.platformRewards.enabled) fail('LOTTERY_SOURCE_MODULE_DISABLED', '请先开启平台任务，再配置抽奖资格来源', 400)
    if (activity.status === 'CANCELLED') fail('LOTTERY_ACTIVITY_CANCELLED', '活动已取消，不能修改抽奖')
    const existing = await tx.topicActivityLottery.findUnique({ where: { activityId } })
    if (existing) {
      const existingSources = await sources(tx, activity, normalizeTopicLotteryConfig(existing.config))
      const drawn = await tx.topicActivityLotteryDraw.findUnique({ where: { activityId }, select: { id: true } })
      if ((existing.fairnessLockedAt || existingSources.length || drawn) && hash(normalizeTopicLotteryConfig(existing.config)) !== hash(config)) fail('LOTTERY_RULES_LOCKED', '已有参与或名单已冻结，奖品库存和开奖规则不可修改')
      if (hash(normalizeTopicLotteryConfig(existing.config)) === hash(config)) return config
    }
    if (config.enabled && (!config.drawAt || new Date(config.drawAt) <= now || new Date(config.eligibilityDeadline!) <= now)) fail('LOTTERY_CONFIG_DEADLINE_PASSED', '首次启用须在资格截止与开奖之前')
    const entries = await tx.topicActivityRewardEntry.findMany({ where: { activityId, id: { in: config.sourceEntryIds } }, select: { id: true, config: true, enabled: true } })
    if (entries.length !== config.sourceEntryIds.length) fail('LOTTERY_SOURCE_INVALID', '资格入口不属于当前活动', 400)
    if (config.enabled && entries.some((entry) => !entry.enabled || typeof record(entry.config).maxImages !== 'number' || Number(record(entry.config).maxImages) < 1)) fail('LOTTERY_SOURCE_REQUIRES_SCREENSHOTS', '资格来源须是开放且允许提交截图的平台入口', 400)
    const foreignPrize = await tx.lotteryPrize.findFirst({ where: { id: { in: config.prizes.map((prize) => prize.id) }, ...(existing ? { lotteryId: { not: existing.lotteryId } } : {}) }, select: { id: true } })
    if (foreignPrize) fail('LOTTERY_PRIZE_SCOPE_INVALID', '奖品编号已属于其他抽奖', 400)
    const base = existing ? await tx.lottery.update({ where: { id: existing.lotteryId }, data: { title: config.title, description: config.description, drawAt: config.drawAt ? new Date(config.drawAt) : null, status: config.enabled ? 'SCHEDULED' : 'DRAFT' } })
      : await tx.lottery.create({ data: { activityId, createdById: actorId, title: config.title, description: config.description, pointsCost: 0, drawAt: config.drawAt ? new Date(config.drawAt) : null, status: config.enabled ? 'SCHEDULED' : 'DRAFT' } })
    const lottery = await tx.topicActivityLottery.upsert({ where: { activityId }, create: { activityId, lotteryId: base.id, enabled: config.enabled, config: json(config), drawAt: base.drawAt },
      update: { enabled: config.enabled, config: json(config), drawAt: base.drawAt } })
    // No participants/results exist here. No awarded slot or winner is deleted.
    await tx.topicActivityLotterySlot.deleteMany({ where: { Prize: { lotteryId: base.id } } })
    await tx.lotteryPrize.deleteMany({ where: { lotteryId: base.id } })
    for (const prize of config.prizes) {
      await tx.lotteryPrize.create({ data: { id: prize.id, lotteryId: base.id, name: prize.name, description: prize.description, imageUrl: prize.imageUrl,
        type: 'PHYSICAL', prizeType: 'PHYSICAL', quantity: prize.quantity, remaining: prize.quantity, sortOrder: prize.sortOrder } })
      await tx.topicActivityLotterySlot.createMany({ data: Array.from({ length: prize.quantity }, (_, slotNumber) => ({ prizeId: prize.id, slotNumber })) })
    }
    await audit(tx, lottery, 'CONFIG_SAVED', actorId, { beforeHash: existing ? hash(existing.config) : null, afterHash: hash(config), prizeCount: config.prizes.length, quantity: config.prizes.reduce((sum, prize) => sum + prize.quantity, 0) })
    const qualifying = await sources(tx, activity, config)
    for (const user of new Set(qualifying.map((row) => row.userId))) await syncTopicLotteryEligibilityInTransaction(tx, activity, user, now)
    return config
  })
}
function due(activity: Activity, lottery: TopicActivityLottery, config: TopicLotteryConfig, trigger: 'AUTO' | 'MANUAL', now: Date) {
  if (!lottery.enabled || !config.enabled) fail('LOTTERY_DISABLED', '抽奖未开启')
  if (activity.status !== 'PUBLISHED') fail('LOTTERY_ACTIVITY_CLOSED', '活动未开放或已取消')
  if (!config.drawAt || now < new Date(config.drawAt)) fail('LOTTERY_NOT_DUE', '尚未到开奖时间')
  if (trigger === 'AUTO' && config.mode !== 'AUTO') fail('LOTTERY_MANUAL_ONLY', '此抽奖须管理员确认开奖')
}
type FrozenCandidate = { userId: string; sourceSubmissionId: string; snapshot: unknown }
type FrozenPrize = { id: string; name: string; description: string | null; imageUrl: string | null; quantity: number; slots: string[] }
type Allocation = { userId: string; prizeId: string; slotId: string }
async function freeze(input: { activityId: string; actorId?: string; trigger: 'AUTO' | 'MANUAL'; now: Date }) {
  return withTopicV2Transaction(async (tx) => {
    const { activity, lottery, config } = await lockTopicLottery(tx, input.activityId)
    const previous = await tx.topicActivityLotteryDraw.findUnique({ where: { activityId: activity.id } })
    if (previous?.state === 'DRAWN') return previous
    due(activity, lottery, config, input.trigger, input.now)
    if (previous) return previous
    const rows = await sources(tx, activity, config)
    if (rows.some((row) => row.status === 'PENDING')) fail('LOTTERY_PENDING_SUBMISSIONS', '仍有截止前有效凭证待审核，必须处理后才能冻结开奖')
    const unique = new Map<string, typeof rows[number]>()
    for (const row of rows) if (!unique.has(row.userId)) unique.set(row.userId, row)
    const candidates: FrozenCandidate[] = [...unique.values()].map((row) => ({ userId: row.userId, sourceSubmissionId: row.id, snapshot: sourceSnapshot(row) })).sort((a, b) => a.userId.localeCompare(b.userId))
    for (const candidate of candidates) await syncTopicLotteryEligibilityInTransaction(tx, activity, candidate.userId, input.now)
    await tx.topicActivityLotteryEligibility.updateMany({ where: { lotteryConfigId: lottery.id, userId: { notIn: candidates.map((candidate) => candidate.userId) } }, data: { valid: false } })
    const prizes = await tx.lotteryPrize.findMany({ where: { lotteryId: lottery.lotteryId }, include: { TopicSlots: { orderBy: { slotNumber: 'asc' } } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
    if (prizes.some((prize) => prize.quantity !== prize.TopicSlots.length || prize.remaining !== prize.quantity)) fail('LOTTERY_STOCK_INVALID', '奖品库存需要核验，不能开奖')
    const prizeSnapshot: FrozenPrize[] = prizes.map((prize) => ({ id: prize.id, name: prize.name, description: prize.description, imageUrl: prize.imageUrl, quantity: prize.quantity, slots: prize.TopicSlots.map((slot) => slot.id) }))
    const drawn = await tx.topicActivityLotteryDraw.create({ data: { activityId: activity.id, lotteryConfigId: lottery.id, frozenAt: input.now, frozenById: input.actorId || null,
      candidateCount: candidates.length, candidateSnapshot: json(candidates), candidateHash: hash(candidates), prizeSnapshot: json(prizeSnapshot) } })
    await tx.topicActivityLottery.update({ where: { id: lottery.id }, data: { state: 'FROZEN', fairnessLockedAt: lottery.fairnessLockedAt || input.now } })
    await audit(tx, lottery, 'CANDIDATES_FROZEN', input.actorId || null, { candidateCount: candidates.length, candidateHash: drawn.candidateHash, quantity: prizes.reduce((sum, prize) => sum + prize.quantity, 0) }, drawn.id)
    return drawn
  })
}
export async function drawTopicLottery(input: { activityId: string; actorId?: string; trigger: 'AUTO' | 'MANUAL'; now?: Date }) {
  const now = input.now || new Date()
  await freeze({ ...input, now })
  // Cache an uncommitted plan across deadlock retries; a committed plan is
  // always read from the database. Never resample a persisted allocation.
  let cachedPlan: Allocation[] | null = null
  try {
    await withTopicV2Transaction(async (tx) => {
      const { activity, lottery, config } = await lockTopicLottery(tx, input.activityId)
      const batch = await tx.topicActivityLotteryDraw.findUniqueOrThrow({ where: { activityId: activity.id } })
      if (batch.state === 'DRAWN' || batch.allocation !== null) return
      due(activity, lottery, config, input.trigger, now)
      const candidates = batch.candidateSnapshot as unknown as FrozenCandidate[], prizes = batch.prizeSnapshot as unknown as FrozenPrize[]
      if (!Array.isArray(candidates) || hash(candidates) !== batch.candidateHash || !Array.isArray(prizes)) fail('LOTTERY_SNAPSHOT_INVALID', '冻结快照不一致，禁止开奖')
      if (!cachedPlan) {
        const slots = prizes.flatMap((prize) => prize.slots.map((slotId) => ({ slotId, prizeId: prize.id })))
        const selected = sampleTopicLotteryUsers(candidates.map((candidate) => candidate.userId), slots.length)
        cachedPlan = selected.map((userId, index) => ({ userId, ...slots[index] }))
      }
      await tx.topicActivityLotteryDraw.update({ where: { id: batch.id }, data: { allocation: json(cachedPlan), allocationHash: hash(cachedPlan), state: 'DRAWING', startedAt: now, errorCode: null } })
      await tx.topicActivityLottery.update({ where: { id: lottery.id }, data: { state: 'DRAWING' } })
      await audit(tx, lottery, 'ALLOCATION_PERSISTED', input.actorId || null, { allocationHash: hash(cachedPlan), count: cachedPlan.length }, batch.id)
    })
    return await withTopicV2Transaction(async (tx) => {
      const { activity, lottery, config } = await lockTopicLottery(tx, input.activityId)
      const batch = await tx.topicActivityLotteryDraw.findUniqueOrThrow({ where: { activityId: activity.id } })
      if (batch.state === 'DRAWN') return { changed: false, drawId: batch.id, winnerCount: batch.winnerCount }
      due(activity, lottery, config, input.trigger, now)
      const plan = batch.allocation as unknown as Allocation[], candidates = batch.candidateSnapshot as unknown as FrozenCandidate[], prizes = batch.prizeSnapshot as unknown as FrozenPrize[]
      if (!Array.isArray(plan) || hash(plan) !== batch.allocationHash || hash(candidates) !== batch.candidateHash
        || new Set(plan.map((winner) => winner.userId)).size !== plan.length || new Set(plan.map((winner) => winner.slotId)).size !== plan.length
        || plan.some((winner) => !candidates.some((candidate) => candidate.userId === winner.userId) || !prizes.some((prize) => prize.id === winner.prizeId && prize.slots.includes(winner.slotId)))) fail('LOTTERY_ALLOCATION_INVALID', '持久化分配记录不一致，禁止重抽')
      for (const prize of prizes) {
        const count = plan.filter((winner) => winner.prizeId === prize.id).length
        if (count > prize.quantity) fail('LOTTERY_STOCK_INVALID', '奖品库存不一致')
        if (count) {
          const deducted = await tx.lotteryPrize.updateMany({ where: { id: prize.id, lotteryId: lottery.lotteryId, remaining: { gte: count } }, data: { remaining: { decrement: count } } })
          if (deducted.count !== 1) fail('LOTTERY_STOCK_INVALID', '奖品库存不足，禁止重抽')
        }
      }
      const addressDeadline = new Date(config.addressDeadline!), retainUntil = new Date(addressDeadline.getTime() + config.retentionDays * 86_400_000)
      for (const selected of plan) {
        const winner = await tx.lotteryEntry.create({ data: { lotteryId: lottery.lotteryId, userId: selected.userId, prizeId: selected.prizeId,
          topicSlotId: selected.slotId, wonAt: now, fulfillmentStatus: 'PENDING' } })
        await tx.topicActivityLotteryShipping.create({ data: { winnerId: winner.id, addressDeadline, retainUntil } })
        await tx.topicActivityLotteryNotice.create({ data: { winnerId: winner.id } })
      }
      await tx.lottery.update({ where: { id: lottery.lotteryId }, data: { status: 'DRAWN', eligibleCount: batch.candidateCount, winnerCount: plan.length, drawnAt: now, algorithmVersion: 'TOPIC_FROZEN_SECURE_SHUFFLE_V1' } })
      await tx.topicActivityLotteryDraw.update({ where: { id: batch.id }, data: { state: 'DRAWN', drawnAt: now, winnerCount: plan.length, errorCode: null } })
      await tx.topicActivityLottery.update({ where: { id: lottery.id }, data: { state: 'DRAWN' } })
      await audit(tx, lottery, 'DRAW_COMPLETED', input.actorId || null, { winnerCount: plan.length, candidateCount: batch.candidateCount, allocationHash: batch.allocationHash }, batch.id)
      return { changed: true, drawId: batch.id, winnerCount: plan.length }
    })
  } catch {
    // A committed allocation survives failure. No raw SQL/error text or PII.
    await withTopicV2Transaction(async (tx) => {
      const { lottery } = await lockTopicLottery(tx, input.activityId)
      const batch = await tx.topicActivityLotteryDraw.findUnique({ where: { activityId: input.activityId } })
      if (batch && batch.state !== 'DRAWN') {
        await tx.topicActivityLotteryDraw.update({ where: { id: batch.id }, data: { state: 'FAILED', errorCode: 'DRAW_FINALIZATION_FAILED' } })
        await tx.topicActivityLottery.update({ where: { id: lottery.id }, data: { state: 'FAILED' } })
        await audit(tx, lottery, 'DRAW_FAILED_RECOVERABLE', input.actorId || null, { allocationRetained: batch.allocation !== null }, batch.id)
      }
    })
    fail('LOTTERY_DRAW_FAILED', '开奖尚未完成，已保留冻结名单及分配记录，可安全重试', 503)
  }
}
async function viewData(activityId: string, now: Date) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } })
  if (!activity || activity.type !== 'TOPIC_ACTIVITY') fail('LOTTERY_ACTIVITY_NOT_FOUND', '活动不存在', 404)
  const lottery = await prisma.topicActivityLottery.findUnique({ where: { activityId } })
  if (!lottery) return { activity, lottery: null, config: defaultTopicLotteryConfig(), state: 'DISABLED', candidateCount: 0, pendingSubmissionCount: 0, rows: [], batch: null }
  const config = normalizeTopicLotteryConfig(lottery.config), batch = await prisma.topicActivityLotteryDraw.findUnique({ where: { activityId } })
  const rows = batch ? [] : await sources(prisma, activity, config)
  const pendingSubmissionCount = rows.filter((row) => row.status === 'PENDING').length
  const candidateCount = batch?.candidateCount ?? new Set(rows.filter((row) => row.status === 'APPROVED').map((row) => row.userId)).size
  const state = !lottery.enabled ? 'DISABLED' : batch?.state === 'DRAWN' ? 'DRAWN' : activity.status === 'CANCELLED' ? 'CANCELLED'
    : batch ? batch.state : activity.startsAt && now < activity.startsAt ? 'NOT_STARTED'
      : now < new Date(config.eligibilityDeadline!) ? 'COLLECTING' : pendingSubmissionCount ? 'WAITING_REVIEW'
        : now < new Date(config.drawAt!) ? 'WAITING_DRAW' : 'READY_TO_DRAW'
  return { activity, lottery, config, state, candidateCount, pendingSubmissionCount, rows, batch }
}
function shippingState(shipping: { shippingStatus: string; addressDeadline: Date; addressCiphertext: string | null } | null, now: Date) {
  return shipping && !shipping.addressCiphertext && now > shipping.addressDeadline && shipping.shippingStatus === 'WAITING_ADDRESS' ? 'EXPIRED' : shipping?.shippingStatus || 'WAITING_ADDRESS'
}
export async function getTopicLotteryView(activityId: string, viewerId?: string | null, now = new Date()) {
  const value = await viewData(activityId, now)
  if (!['PUBLISHED', 'CANCELLED'].includes(value.activity.status)) fail('LOTTERY_ACTIVITY_NOT_FOUND', '活动不存在', 404)
  if (!value.lottery?.enabled) return { enabled: false, config: value.config, state: 'DISABLED', candidateCount: 0, myStatus: 'NOT_ENABLED', myEligibility: null, myWinner: null, winners: [] }
  const ownWinner = viewerId ? await prisma.lotteryEntry.findUnique({ where: { lotteryId_userId: { lotteryId: value.lottery.lotteryId, userId: viewerId } }, include: { LotteryPrize: true, TopicShipping: true } }) : null
  const ownSources = value.rows.filter((row) => row.userId === viewerId)
  const frozen = value.batch?.candidateSnapshot as unknown as FrozenCandidate[] | undefined
  const eligible = value.batch ? frozen?.some((candidate) => candidate.userId === viewerId) : ownSources.some((row) => row.status === 'APPROVED')
  const myStatus = !viewerId ? 'LOGIN_REQUIRED' : ownWinner ? 'WON' : value.state === 'DRAWN' ? 'NOT_WON' : eligible ? 'ELIGIBLE'
    : ownSources.some((row) => row.status === 'PENDING') ? 'SUBMITTED_PENDING' : now > new Date(value.config.eligibilityDeadline!) ? 'MISSED_DEADLINE' : 'NOT_ELIGIBLE'
  const publicWinners = value.config.publishWinners && value.state === 'DRAWN' ? await prisma.lotteryEntry.findMany({ where: { lotteryId: value.lottery.lotteryId },
    select: { User: { select: { nickname: true, uid: true } }, LotteryPrize: { select: { name: true } } }, take: 1000 }) : []
  return { enabled: true, config: value.config, state: value.state, candidateCount: value.candidateCount, myStatus,
    myEligibility: eligible ? { count: 1 } : null, myWinner: ownWinner ? { id: ownWinner.id, prize: { name: ownWinner.LotteryPrize?.name || '活动奖品', imageUrl: ownWinner.LotteryPrize?.imageUrl, description: ownWinner.LotteryPrize?.description },
      wonAt: ownWinner.wonAt, addressDeadline: ownWinner.TopicShipping?.addressDeadline, shippingStatus: shippingState(ownWinner.TopicShipping, now), addressSaved: Boolean(ownWinner.TopicShipping?.addressCiphertext),
      claimUrl: '/activities/' + encodeURIComponent(activityId) + '/lottery/claims/' + encodeURIComponent(ownWinner.id) } : null,
    winners: publicWinners.map((winner) => ({ nickname: winner.User.nickname, uid: winner.User.uid, prizeName: winner.LotteryPrize?.name || '活动奖品' })) }
}
export async function getAdminTopicLotteryView(activityId: string, now = new Date()) {
  const value = await viewData(activityId, now)
  const winners = value.lottery ? await prisma.lotteryEntry.findMany({ where: { lotteryId: value.lottery.lotteryId }, include: { User: { select: { nickname: true, uid: true } }, LotteryPrize: { select: { name: true } },
    TopicShipping: { select: { shippingStatus: true, addressDeadline: true, shippedAt: true, addressCiphertext: true } } }, take: 1000, orderBy: { id: 'asc' } }) : []
  return { config: value.config, addressEncryptionReady: getTopicLotteryPiiConfigStatus().usable, configLocked: Boolean(value.lottery?.fairnessLockedAt || value.rows.length || value.batch), state: value.state,
    candidateCount: value.candidateCount, pendingSubmissionCount: value.pendingSubmissionCount,
    draw: value.batch ? { id: value.batch.id, frozenAt: value.batch.frozenAt, candidateCount: value.batch.candidateCount, winnerCount: value.batch.winnerCount, failedReason: value.batch.errorCode } : null,
    winners: winners.map((winner) => ({ id: winner.id, nickname: winner.User.nickname, uid: winner.User.uid, prizeName: winner.LotteryPrize?.name || '活动奖品', wonAt: winner.wonAt,
      addressDeadline: winner.TopicShipping?.addressDeadline, addressSaved: Boolean(winner.TopicShipping?.addressCiphertext), shippingStatus: shippingState(winner.TopicShipping, now), shippedAt: winner.TopicShipping?.shippedAt })) }
}
export async function drawDueTopicLotteries(options: { activityId?: string; batchSize?: number; now?: Date } = {}) {
  const now = options.now || new Date()
  const dueRows = await prisma.topicActivityLottery.findMany({ where: { ...(options.activityId ? { activityId: options.activityId } : {}), enabled: true, config: { path: '$.mode', equals: 'AUTO' }, drawAt: { lte: now }, state: { in: ['COLLECTING', 'FROZEN', 'DRAWING', 'FAILED'] }, Activity: { status: 'PUBLISHED' } },
    orderBy: [{ drawAt: 'asc' }, { id: 'asc' }], take: Math.min(200, Math.max(1, options.batchSize || 50)) })
  let drawn = 0, blocked = 0, failed = 0
  for (const row of dueRows) {
    if (normalizeTopicLotteryConfig(row.config).mode !== 'AUTO') continue
    try { const result = await drawTopicLottery({ activityId: row.activityId, trigger: 'AUTO', now }); if (result.changed) drawn++ }
    catch (error) { if (error instanceof TopicLotteryError && error.code === 'LOTTERY_PENDING_SUBMISSIONS') blocked++; else failed++ }
  }
  return { scanned: dueRows.length, drawn, blocked, failed }
}
