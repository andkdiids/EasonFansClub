import { createHash } from 'node:crypto'
import { Prisma, type Activity, type TopicActivityRewardGrant } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { processBadgeGrantEffects } from '@/lib/badge-phase3'
import { grantTopicActivityPointsInTransaction } from '@/lib/topic-activity-points'
import { allocatePostCommentFloor } from '@/lib/post-comment-floor'
import { resolveTopicActivityCommentEligibilityInTransaction } from '@/lib/topic-activity'
import { resolveTopicActivityCommentPolicy } from '@/lib/topic-activity-comment-policy'
import { topicActivityTestDirty } from '@/lib/topic-activity-test-presentation'
import { isTopicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'
import { assertTopicLotterySourceRules, lockTopicLotteryRulesForSubmission, syncTopicLotteryEligibilityInTransaction } from '@/lib/topic-activity-v2-lottery'
import { topicRewardReleaseDue } from '@/lib/topic-activity-reward-timing'
import {
  createDefaultTopicActivityV2Program, normalizeTopicActivityV2Program,
  publicTopicActivityV2Program, readTopicActivityV2Program,
  type TopicActivityV2Program, type TopicRewardEntryConfig,
} from '@/lib/topic-activity-v2-config'

export { normalizeTopicActivityV2Program }
export type { TopicActivityV2Program } from '@/lib/topic-activity-v2-config'

export class TopicActivityV2Error extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message)
    this.name = 'TopicActivityV2Error'
  }
}
function fail(code: string, message: string, status = 409): never { throw new TopicActivityV2Error(code, message, status) }
function json(value: unknown) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const badgeEffects = new WeakMap<Prisma.TransactionClient, Array<{ userId: string; grants: Array<{ badgeId: string; recordId: string }> }>>()
export async function withTopicV2Transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      let effects: Array<{ userId: string; grants: Array<{ badgeId: string; recordId: string }> }> = []
      const result = await prisma.$transaction(async (tx) => {
        effects = []
        badgeEffects.set(tx, effects)
        try { return await operation(tx) } finally { badgeEffects.delete(tx) }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 })
      // Presentation/series effects only run after the parent transaction commits.
      for (const effect of effects) {
        try { await processBadgeGrantEffects(effect) }
        catch { console.error('[topic-v2.badge-effects] deferred effect failed', { userId: effect.userId }) }
      }
      return result
    }
    catch (error) {
      const code = record(error).code
      // MySQL deadlocks from a raw FOR UPDATE query surface as P2010,
      // rather than Prisma's model-query P2034. Retry only known transient
      // engine codes after the failed callback transaction has rolled back.
      const mysqlCode = record(record(error).meta).code
      const rawLockConflict = code === 'P2010' && ['1213', '1205'].includes(String(mysqlCode))
      if (attempt >= 2 || (code !== 'P2034' && code !== 'P2002' && !rawLockConflict)) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
    }
  }
}
export async function lockTopicV2Activity(tx: Prisma.TransactionClient, activityId: string) {
  await tx.$queryRawUnsafe('SELECT id FROM Activity WHERE id = ? FOR UPDATE', activityId)
  const activity = await tx.activity.findUnique({ where: { id: activityId } })
  if (!activity || activity.type !== 'TOPIC_ACTIVITY') fail('TOPIC_V2_ACTIVITY_NOT_FOUND', '话题活动不存在', 404)
  return activity
}
async function lockTopicV2RewardGrant(tx: Prisma.TransactionClient, rewardId: string) {
  await tx.$queryRawUnsafe('SELECT id FROM TopicActivityRewardGrant WHERE id = ? FOR UPDATE', rewardId)
}
export function requireTopicV2Program(activity: Pick<Activity, 'topicProgram'>) {
  const program = readTopicActivityV2Program(activity.topicProgram)
  if (!program?.enabled) fail('TOPIC_V2_DISABLED', '活动模块尚未开放')
  return program
}
export function requireTopicV2Active(activity: Pick<Activity, 'status' | 'startsAt' | 'endsAt'>, now: Date) {
  if (activity.status !== 'PUBLISHED') fail('ACTIVITY_CLOSED', '活动当前未开放')
  if (activity.startsAt && now < activity.startsAt) fail('ACTIVITY_NOT_STARTED', '活动尚未开始')
  if (activity.endsAt && now > activity.endsAt) fail('ACTIVITY_ENDED', '活动已结束')
}
function withinActivity(activity: Pick<Activity, 'startsAt' | 'endsAt'>, effectiveAt: Date) {
  return (!activity.startsAt || effectiveAt >= activity.startsAt) && (!activity.endsAt || effectiveAt <= activity.endsAt)
}
function requireReviewWindow(activity: Activity, effectiveAt: Date) {
  if (activity.status !== 'PUBLISHED') fail('ACTIVITY_CLOSED', '已关闭或撤下的活动不能发奖')
  if (!withinActivity(activity, effectiveAt)) fail('TOPIC_V2_INVALID_PARTICIPATION_TIME', '提交不在活动有效时间内')
}
function requireWindow(startsAt: string | null, endsAt: string | null, now: Date) {
  if ((startsAt && now < new Date(startsAt)) || (endsAt && now > new Date(endsAt))) fail('TOPIC_V2_WINDOW_CLOSED', '当前不在领取或提交时间内')
}
async function requireActiveUser(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, isDeleted: true, Profile: { select: { id: true } } } })
  if (!user || user.status !== 'ACTIVE' || user.isDeleted || !user.Profile) fail('TOPIC_V2_USER_UNAVAILABLE', '账号当前不可参与活动', 403)
}
function entryFromSnapshot(value: unknown): TopicRewardEntryConfig {
  const input = record(value)
  const entry = input.entry && typeof input.entry === 'object' ? input.entry : input
  const normalized = normalizeTopicActivityV2Program({ ...createDefaultTopicActivityV2Program(), entries: [entry] })
  if (!normalized.valid || !normalized.value.entries[0]) fail('TOPIC_V2_SNAPSHOT_INVALID', '任务历史配置不完整，请管理员核查')
  return normalized.value.entries[0]
}
function platformKey(value: unknown) {
  const data = record(value)
  const entry = record(data.entry || data)
  return typeof entry.platformKey === 'string' ? entry.platformKey : null
}
export function topicV2EntryGrantKey(activityId: string, rewardEntryId: string, userId: string) {
  return 'topic-v2:entry:' + createHash('sha256').update(JSON.stringify([activityId, rewardEntryId, userId])).digest('hex')
}
function fixedKey(activityId: string, userId: string) { return 'topic-activity:' + activityId + ':' + userId + ':points' }
function medalKey(activityId: string, userId: string, badgeId: string) { return 'topic-activity:' + activityId + ':' + userId + ':badge:' + badgeId }
function rewardReleaseDue(activity: Pick<Activity, 'rewardGrantMode' | 'rewardGrantAt'>, now: Date) {
  return topicRewardReleaseDue(activity, now)
}
function snapshotDate(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}
function snapshotApprovalStatus(value: unknown) {
  return record(value).approvalStatus === 'APPROVED' ? 'APPROVED' : record(value).approvalStatus === 'REJECTED' ? 'REJECTED' : 'PENDING'
}
function snapshotWithApproval(value: unknown, data: Record<string, unknown>) {
  return { ...record(value), ...data }
}
async function syncParticipation(tx: Prisma.TransactionClient, activityId: string, userId: string, now: Date) {
  const approved = await tx.topicActivitySubmission.findMany({
    where: { activityId, userId, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { isDeleted: false, parentId: null } } },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], select: { id: true },
  })
  return tx.topicActivityParticipation.upsert({
    where: { activityId_userId: { activityId, userId } },
    create: { activityId, userId, approvedSubmissionCount: approved.length, firstApprovedSubmissionId: approved[0]?.id || null, firstApprovedAt: approved.length ? now : null },
    update: { approvedSubmissionCount: approved.length },
  })
}
async function refreshParticipation(tx: Prisma.TransactionClient, participationId: string, now: Date) {
  const grants = await tx.topicActivityRewardGrant.findMany({ where: { participationId }, select: { status: true } })
  const granted = grants.filter((item) => item.status === 'GRANTED').length
  const pending = grants.some((item) => ['PENDING', 'PROCESSING', 'FAILED'].includes(item.status))
  return tx.topicActivityParticipation.update({ where: { id: participationId }, data: {
    rewardStatus: granted ? (pending ? 'PARTIAL' : 'GRANTED') : pending ? 'PENDING' : 'NOT_ELIGIBLE',
    ...(granted ? { rewardGrantedAt: now } : {}),
  } })
}
async function createGrant(tx: Prisma.TransactionClient, input: {
  participationId: string; activityId: string; userId: string; origin: string; grantKey: string;
  points?: number; badgeId?: string; rewardEntryId?: string; snapshot: unknown;
}) {
  const existing = await tx.topicActivityRewardGrant.findUnique({ where: { grantKey: input.grantKey } })
  if (existing) return existing
  return tx.topicActivityRewardGrant.create({ data: {
    participationId: input.participationId, activityId: input.activityId, userId: input.userId,
    origin: input.origin, grantKey: input.grantKey, rewardEntryId: input.rewardEntryId || null,
    rewardSnapshot: json(input.snapshot), kind: input.badgeId ? 'BADGE' : 'POINTS',
    points: input.points ?? null, badgeId: input.badgeId || null, status: 'PENDING',
  } })
}
async function grantPoints(tx: Prisma.TransactionClient, activity: Pick<Activity, 'id' | 'title'>, grant: TopicActivityRewardGrant, now: Date) {
  if (grant.status === 'GRANTED' || grant.status === 'CANCELLED') return grant
  if (!grant.points || grant.points <= 0) fail('TOPIC_V2_REWARD_INVALID', '奖励金额无效')
  await grantTopicActivityPointsInTransaction(tx, {
    userId: grant.userId, activityId: activity.id, points: grant.points, businessKey: grant.grantKey,
    reason: '话题活动「' + activity.title + '」奖励', sourceEventId: grant.id, now,
  })
  return tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: { status: 'GRANTED', grantedAt: now, errorMessage: null } })
}

async function grantBadgeForGrant(tx: Prisma.TransactionClient, activity: Pick<Activity, 'id' | 'title' | 'startsAt' | 'endsAt'>, grant: TopicActivityRewardGrant, now: Date) {
  if (grant.status === 'GRANTED' || grant.status === 'CANCELLED') return grant
  const snapshot = record(grant.rewardSnapshot)
  const badgeId = typeof snapshot.badgeId === 'string' ? snapshot.badgeId : grant.badgeId
  const effectiveAt = snapshotDate(snapshot.effectiveAt) || now
  if (!badgeId) fail('TOPIC_V2_BADGE_INVALID', '活动勋章快照不完整')
  const badge = await grantBadgeWithTransaction(tx, {
    userId: grant.userId, badgeId, sourceType: 'TOPIC_ACTIVITY_REWARD', sourceId: activity.id,
    grantKey: grant.grantKey, obtainedAt: effectiveAt,
    availabilityMode: 'HISTORICAL_WINDOW',
    historicalWindow: { from: activity.startsAt || effectiveAt, until: activity.endsAt || effectiveAt },
    grantReason: '话题活动「' + activity.title + '」限定勋章', deferPhase3Effects: true,
  })
  if (badge.skipped) fail('TOPIC_V2_BADGE_UNAVAILABLE', '活动勋章当前不可发放，请管理员核查')
  const effects = [...(badge.created ? [{ badgeId: badge.badgeId, recordId: badge.recordId }] : []), ...(badge.derivedGrants || [])]
  if (effects.length) badgeEffects.get(tx)?.push({ userId: grant.userId, grants: effects })
  return tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: { status: 'GRANTED', grantedAt: now, errorMessage: null } })
}

export async function grantTopicActivityV2MedalForEventInTransaction(
  tx: Prisma.TransactionClient, activity: Activity,
  input: { userId: string; event: 'PLATFORM' | 'APPROVED_COMMENT' | 'POLL' | 'TEST'; effectiveAt: Date; now: Date; rewardEntryId?: string | null; submissionId?: string | null },
) {
  const program = requireTopicV2Program(activity)
  const medal = program.medal
  if (!medal.enabled || !medal.badgeId || !medal.triggers.includes(input.event)) return null
  requireReviewWindow(activity, input.effectiveAt)
  if (!medal.allowLateReview && activity.endsAt && input.now > activity.endsAt) return null
  const previousMedal = await tx.topicActivityRewardGrant.findFirst({ where: { activityId: activity.id, userId: input.userId, kind: 'BADGE', status: 'GRANTED' } })
  if (previousMedal) return previousMedal
  const participation = await syncParticipation(tx, activity.id, input.userId, input.now)
  const grant = await createGrant(tx, {
    participationId: participation.id, activityId: activity.id, userId: input.userId,
    badgeId: medal.badgeId, origin: 'BADGE', grantKey: medalKey(activity.id, input.userId, medal.badgeId),
    snapshot: {
      ...medal, event: input.event, effectiveAt: input.effectiveAt.toISOString(), approvalStatus: 'APPROVED', approvedAt: input.now.toISOString(),
      ...(input.event === 'PLATFORM' ? { rewardEntryId: input.rewardEntryId || null } : {}),
      ...(input.event === 'APPROVED_COMMENT' ? { submissionId: input.submissionId || null } : {}),
      ...(input.event === 'POLL' ? { pollId: program.poll.id } : {}),
      ...(input.event === 'TEST' ? { testId: program.test.id, configVersion: program.test.version } : {}),
    },
  })
  const activeGrant = grant.status === 'GRANTED'
    ? grant
    : await tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: { status: 'PENDING', errorMessage: null } })
  if (activeGrant.status === 'GRANTED') return activeGrant
  if (!rewardReleaseDue(activity, input.now)) {
    await refreshParticipation(tx, participation.id, input.now)
    return activeGrant
  }
  const awarded = await grantBadgeForGrant(tx, activity, activeGrant, input.now)
  await refreshParticipation(tx, participation.id, input.now)
  return awarded
}

export async function saveTopicActivityV2Program(activityId: string, actorId: string, value: unknown) {
  const normalized = normalizeTopicActivityV2Program(value)
  if (!normalized.valid) fail('TOPIC_V2_CONFIG_INVALID', normalized.message, 400)
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, activityId)
    const program = normalized.value
    await assertTopicLotterySourceRules(tx, activity, program)
    if (program.enabled && program.platformRewards.enabled) {
      if (!activity.allowImageAttachments && program.entries.some((entry) => entry.enabled && entry.maxImages > 0)) fail('TOPIC_V2_IMAGES_DISABLED', '请先在活动基础设置开启图片附件')
      if (resolveTopicActivityCommentPolicy(activity.formSchema).commentLimit === 'SINGLE' && (program.entries.filter((entry) => entry.enabled).length > 1 || program.entries.some((entry) => entry.allowResubmit))) {
        fail('TOPIC_V2_COMMENT_POLICY_CONFLICT', '多入口或重交任务需要将参与评论次数设为多次')
      }
    }
    if (program.medal.enabled && program.medal.badgeId) {
      const badge = await tx.badge.findUnique({ where: { id: program.medal.badgeId }, select: { isActive: true, isEnabled: true } })
      if (!badge?.isActive || !badge.isEnabled) fail('TOPIC_V2_BADGE_UNAVAILABLE', '绑定的勋章不存在或已停用', 400)
    }
    const previous = readTopicActivityV2Program(activity.topicProgram)
    if (previous) {
      const ballots = await tx.topicActivityPollVote.count({ where: { activityId, pollId: previous.poll.id } })
      if (ballots && program.poll.id === previous.poll.id && JSON.stringify(program.poll) !== JSON.stringify(previous.poll)) fail('TOPIC_V2_POLL_VERSION_LOCKED', '已有投票记录，请使用新的投票 ID 保留历史')
      const attempts = await tx.topicActivityTestAttempt.count({ where: { activityId, testId: previous.test.id } })
      if (attempts && program.test.id === previous.test.id) {
        const testContentChanged = topicActivityTestDirty(previous.test, program.test).TEST_STRUCTURE_DIRTY
        if (testContentChanged) program.test.version = Math.max(program.test.version, previous.test.version + 1)
        else if (program.test.version < previous.test.version) program.test.version = previous.test.version
      }
    }
    const oldEntries = await tx.topicActivityRewardEntry.findMany({ where: { activityId } })
    for (const entry of program.entries) {
      const row = await tx.topicActivityRewardEntry.findUnique({ where: { id: entry.id } })
      if (row && row.activityId !== activityId) fail('TOPIC_V2_ENTRY_RELATION_INVALID', '奖励入口 ID 已被其他活动使用', 400)
      if (row && row.platformKey !== entry.platformKey) {
        const references = await tx.topicActivitySubmission.count({ where: { rewardEntryId: row.id } }) + await tx.topicActivityRewardGrant.count({ where: { rewardEntryId: row.id } })
        if (references) fail('TOPIC_V2_PLATFORM_ID_IMMUTABLE', '有历史记录的入口不能更换平台，请新增入口')
      }
      await tx.topicActivityRewardEntry.upsert({ where: { id: entry.id },
        create: { id: entry.id, activityId, platformKey: entry.platformKey, config: json(entry), enabled: entry.enabled, sortOrder: entry.sortOrder },
        update: { platformKey: entry.platformKey, config: json(entry), enabled: entry.enabled, sortOrder: entry.sortOrder },
      })
    }
    for (const old of oldEntries.filter((entry) => !program.entries.some((item) => item.id === entry.id))) {
      const archived = { ...entryFromSnapshot(old.config), enabled: false }
      program.entries.push(archived)
      await tx.topicActivityRewardEntry.update({ where: { id: old.id }, data: { enabled: false, config: json(archived) } })
    }
    await tx.activity.update({ where: { id: activityId }, data: { topicProgram: json(program), updatedById: actorId } })
    await tx.adminActionLog.create({ data: { adminId: actorId, targetUserId: actorId, action: 'TOPIC_ACTIVITY_V2_CONFIG_UPDATED', detail: json({ activityId, version: 2, entryIds: program.entries.map((entry) => entry.id) }) } })
    return program
  })
}

export async function submitTopicActivityV2Task(input: { activityId: string; userId: string; rewardEntryId: string; assetIds?: readonly string[]; remark?: string | null; now?: Date }) {
  const now = input.now || new Date()
  const ids = [...(input.assetIds || [])]
  if (new Set(ids).size !== ids.length) fail('TOPIC_V2_DUPLICATE_ASSET', '不能重复使用同一张截图', 400)
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, input.activityId)
    requireTopicV2Active(activity, now)
    const program = requireTopicV2Program(activity)
    if (!program.platformRewards.enabled) fail('TOPIC_V2_PLATFORM_DISABLED', '平台奖励未开放')
    if (!activity.activityPostId) fail('TOPIC_V2_POST_UNAVAILABLE', '活动主帖尚未创建')
    const row = await tx.topicActivityRewardEntry.findFirst({ where: { id: input.rewardEntryId, activityId: activity.id, enabled: true } })
    if (!row) fail('TOPIC_V2_ENTRY_NOT_FOUND', '奖励入口未开放', 404)
    const entry = entryFromSnapshot(row.config)
    requireWindow(entry.startsAt, entry.endsAt, now)
    if (ids.length < entry.minImages || ids.length > entry.maxImages) fail('TOPIC_V2_SCREENSHOT_COUNT_INVALID', '截图数量不符合任务要求', 400)
    if (ids.length && !activity.allowImageAttachments) fail('TOPIC_V2_IMAGES_DISABLED', '活动未启用图片附件', 403)
    // A user's explicit withdrawal retires that attempt but preserves its audit
    // history. It must not make a first submission impossible when the entry
    // does not allow resubmission after an administrator rejection.
    const prior = await tx.topicActivitySubmission.findMany({ where: { activityId: activity.id, rewardEntryId: row.id, userId: input.userId, status: { not: 'WITHDRAWN' } }, select: { status: true } })
    if (prior.length && (!entry.allowResubmit || prior.some((submission) => submission.status === 'PENDING'))) fail('TOPIC_V2_RESUBMISSION_NOT_ALLOWED', '该任务已提交，当前不能重新提交')
    const eligible = await resolveTopicActivityCommentEligibilityInTransaction(tx, { activity, userId: input.userId, now })
    if (!eligible.canComment) fail(eligible.blockReason || 'TOPIC_V2_COMMENT_BLOCKED', '请先完成活动参与条件')
    await tx.$queryRawUnsafe('SELECT id FROM Post WHERE id = ? FOR UPDATE', activity.activityPostId)
    const post = await tx.post.findFirst({ where: { id: activity.activityPostId, isDeleted: false, isLocked: false, status: 'PUBLISHED', Board: { isActive: true } }, select: { id: true, authorId: true } })
    if (!post) fail('TOPIC_V2_POST_UNAVAILABLE', '活动主帖当前不可回复')
    await requireActiveUser(tx, input.userId)
    const assets = ids.length ? await tx.topicActivityImageAsset.findMany({ where: {
      id: { in: ids }, activityId: activity.id, uploadedByUserId: input.userId, purpose: 'FORM_ANSWER',
      taskSubmissionId: null, formSubmissionId: null, replyId: null,
    }, select: { id: true, storageKey: true } }) : []
    if (assets.length !== ids.length || assets.some((asset) => !isTopicActivityOriginalObjectKey(asset.storageKey, activity.id, 'FORM_ANSWER'))) fail('TOPIC_V2_ASSET_NOT_AUTHORIZED', '截图已绑定、无权访问或不存在', 403)
    const floorNumber = await allocatePostCommentFloor(tx, post.id)
    const remark = input.remark?.trim().slice(0, 2000) || ''
    const comment = await tx.reply.create({ data: { postId: post.id, authorId: input.userId, parentId: null, floorNumber,
      content: '【平台任务】' + entry.platformName + ' · ' + entry.title + (remark ? '\n' + remark : '') } })
    const submission = await tx.topicActivitySubmission.create({ data: {
      activityId: activity.id, userId: input.userId, commentId: comment.id, rewardEntryId: entry.id,
      submittedAt: now, rewardSnapshot: json({ ...entry, version: 2, submittedAt: now.toISOString() }),
    } })
    if (ids.length) {
      const bound = await tx.topicActivityImageAsset.updateMany({ where: { id: { in: ids }, uploadedByUserId: input.userId, taskSubmissionId: null, formSubmissionId: null, replyId: null }, data: { taskSubmissionId: submission.id } })
      if (bound.count !== ids.length) fail('TOPIC_V2_ASSET_NOT_AUTHORIZED', '截图已被其他提交绑定', 409)
    }
    await lockTopicLotteryRulesForSubmission(tx, activity, input.userId, now)
    await tx.post.update({ where: { id: post.id }, data: { replyCount: { increment: 1 } } })
    return { submission, commentId: comment.id, replyId: comment.id, postAuthorId: post.authorId }
  })
}

/**
 * Retire only the caller's pending platform-task submission. Activity is the
 * serialization point shared with submit/review, and the conditional update is
 * a second compare-and-set guard against any writer that does not use that
 * lock. The original submission, comment, review history and private assets
 * are deliberately retained; withdrawal never touches reward grants.
 */
export async function withdrawTopicActivityV2Submission(input: { activityId: string; submissionId: string; userId: string; now?: Date }) {
  const now = input.now || new Date()
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, input.activityId)
    const submission = await tx.topicActivitySubmission.findFirst({
      where: { id: input.submissionId, activityId: activity.id, userId: input.userId },
      select: { id: true, activityId: true, userId: true, commentId: true, rewardEntryId: true, status: true, commentDeletedAt: true,
        Comment: { select: { postId: true, parentId: true, isDeleted: true } } },
    })
    if (!submission) fail('TOPIC_V2_SUBMISSION_NOT_FOUND', '提交记录不存在', 404)
    if (!submission.rewardEntryId) fail('TOPIC_V2_DISCUSSION_NOT_REVIEWABLE', '普通活动讨论不能撤回平台截图', 409)
    if (submission.status !== 'PENDING') fail('TOPIC_V2_SUBMISSION_NOT_PENDING', '只有待审核的截图可以撤回', 409)
    if (submission.commentDeletedAt || !submission.Comment || submission.Comment.isDeleted || submission.Comment.parentId || submission.Comment.postId !== activity.activityPostId) {
      fail('TOPIC_V2_SUBMISSION_UNAVAILABLE', '提交记录当前不可撤回', 409)
    }

    const changed = await tx.topicActivitySubmission.updateMany({
      where: { id: submission.id, activityId: activity.id, userId: input.userId, rewardEntryId: { not: null }, status: 'PENDING' },
      data: { status: 'WITHDRAWN', reviewedAt: now, reviewedById: null, rejectReason: null },
    })
    if (changed.count !== 1) fail('TOPIC_V2_SUBMISSION_NOT_PENDING', '提交状态已变化，请刷新后重试', 409)
    await tx.topicActivityReviewLog.create({ data: {
      submissionId: submission.id, activityId: activity.id, userId: input.userId, commentId: submission.commentId,
      fromStatus: 'PENDING', toStatus: 'WITHDRAWN', reviewedById: null, reviewedAt: now,
      reason: '提交者撤回待审核的平台截图',
    } })
    return { ok: true as const, submissionId: submission.id, status: 'WITHDRAWN' as const }
  })
}

export async function reviewTopicActivityV2Submission(input: { activityId?: string; submissionId: string; reviewerId: string; status: 'APPROVED' | 'REJECTED'; rejectReason?: string | null; now?: Date }) {
  const now = input.now || new Date()
  // Resolve the lock target without a Serializable shared row lock. Taking
  // Submission first in concurrent reviews caused an Activity/Submission
  // lock cycle. The authoritative submission is read again after Activity.
  const identity = await prisma.topicActivitySubmission.findUnique({ where: { id: input.submissionId }, select: { activityId: true } })
  if (!identity || (input.activityId && input.activityId !== identity.activityId)) fail('TOPIC_V2_SUBMISSION_NOT_FOUND', '提交记录不存在', 404)
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, identity.activityId)
    const program = requireTopicV2Program(activity)
    const submission = await tx.topicActivitySubmission.findUnique({ where: { id: input.submissionId }, include: { Comment: { select: { postId: true, parentId: true, isDeleted: true } } } })
    if (!submission || !submission.Comment || submission.Comment.isDeleted || submission.commentDeletedAt || submission.Comment.parentId || submission.Comment.postId !== activity.activityPostId) fail('TOPIC_V2_SUBMISSION_UNAVAILABLE', '评论已删除、撤回或关联无效')
    if (!submission.rewardEntryId) fail('TOPIC_V2_DISCUSSION_NOT_REVIEWABLE', '普通活动讨论不支持审核操作')
    requireReviewWindow(activity, submission.submittedAt)
    if (submission.status === 'WITHDRAWN') fail('TOPIC_V2_SUBMISSION_WITHDRAWN', '评论已撤回')
    const current = await tx.topicActivityParticipation.findUnique({ where: { activityId_userId: { activityId: activity.id, userId: submission.userId } } })
    if (submission.status === input.status) return { submission, participation: current, changed: false, firstParticipationCreated: false, rewardIds: [] as string[] }
    let entry: TopicRewardEntryConfig | null = null
    if (submission.rewardEntryId) entry = entryFromSnapshot(submission.rewardSnapshot)
    let entryGrant: TopicActivityRewardGrant | null = null
    if (entry) entryGrant = await tx.topicActivityRewardGrant.findUnique({ where: { grantKey: topicV2EntryGrantKey(activity.id, entry.id, submission.userId) } })
    if (entry && input.status === 'APPROVED') {
      if (entryGrant?.status !== 'GRANTED') {
        const paid = await tx.topicActivityRewardGrant.findMany({ where: { activityId: activity.id, userId: submission.userId, rewardEntryId: { not: null }, status: { not: 'CANCELLED' } }, select: { rewardEntryId: true, rewardSnapshot: true } })
        const entries = new Set(paid.map((grant) => grant.rewardEntryId))
        const platforms = new Set(paid.map((grant) => platformKey(grant.rewardSnapshot)).filter((key): key is string => Boolean(key)))
        if (program.platformRewards.maxEntries !== null && !entries.has(entry.id) && entries.size >= program.platformRewards.maxEntries) fail('TOPIC_V2_MAX_ENTRIES_REACHED', '已达到可领奖任务数量上限')
        const limit = program.platformRewards.allowStacking ? program.platformRewards.maxPlatforms : 1
        if (limit !== null && !platforms.has(entry.platformKey) && platforms.size >= limit) fail('TOPIC_V2_MAX_PLATFORMS_REACHED', '已达到可领奖平台数量上限')
      }
    }
    if (input.status === 'APPROVED' && (activity.participationMode === 'FORM' || activity.participationMode === 'BOTH')) {
      const form = await tx.topicActivityFormSubmission.findFirst({ where: { activityId: activity.id, userId: submission.userId }, select: { id: true } })
      if (!form) fail('FORM_REQUIRED_BEFORE_APPROVAL', '请先完成活动表单')
    }
    const reason = input.status === 'REJECTED' ? input.rejectReason?.trim().slice(0, 2000) || null : null
    const reviewChanged = await tx.topicActivitySubmission.updateMany({
      where: { id: submission.id, status: submission.status },
      data: { status: input.status, reviewedById: input.reviewerId, reviewedAt: now, rejectReason: reason },
    })
    if (reviewChanged.count !== 1) fail('TOPIC_V2_SUBMISSION_STATE_CHANGED', '提交状态已变化，请刷新后重试', 409)
    const updated = { ...submission, status: input.status, reviewedById: input.reviewerId, reviewedAt: now, rejectReason: reason }
    await tx.topicActivityReviewLog.create({ data: { submissionId: submission.id, activityId: activity.id, userId: submission.userId, commentId: submission.commentId,
      fromStatus: submission.status, toStatus: input.status, reviewedById: input.reviewerId, reviewedAt: now, reason } })
    await tx.adminActionLog.create({ data: { adminId: input.reviewerId, targetUserId: submission.userId, action: 'TOPIC_ACTIVITY_V2_SUBMISSION_REVIEWED',
      detail: json({ activityId: activity.id, submissionId: submission.id, fromStatus: submission.status, toStatus: input.status, reason }) } })
    let participation = await syncParticipation(tx, activity.id, submission.userId, now)
    if (entry && input.status === 'APPROVED') {
      entryGrant = entryGrant || await createGrant(tx, { participationId: participation.id, activityId: activity.id, userId: submission.userId,
        rewardEntryId: entry.id, points: entry.points, origin: 'PLATFORM', grantKey: topicV2EntryGrantKey(activity.id, entry.id, submission.userId), snapshot: submission.rewardSnapshot })
      if (entryGrant.status !== 'GRANTED') entryGrant = await tx.topicActivityRewardGrant.update({ where: { id: entryGrant.id }, data: { status: 'PENDING', errorMessage: null } })
      const approvedSnapshot = snapshotWithApproval(entryGrant.rewardSnapshot, { approvalStatus: 'APPROVED', approvedAt: now.toISOString(), approvedById: input.reviewerId })
      entryGrant = await tx.topicActivityRewardGrant.update({ where: { id: entryGrant.id }, data: { rewardSnapshot: json(approvedSnapshot) } })
      if (rewardReleaseDue(activity, now)) entryGrant = await grantPoints(tx, activity, entryGrant, now)
    } else if (entry && input.status === 'REJECTED') {
      const anotherApprovedSubmission = await hasApprovedSubmission(tx, activity, submission.userId, entry.id, submission.id)
      if (!anotherApprovedSubmission && entryGrant && entryGrant.status !== 'GRANTED' && entryGrant.status !== 'CANCELLED') {
        entryGrant = await tx.topicActivityRewardGrant.update({ where: { id: entryGrant.id }, data: { status: 'CANCELLED', errorMessage: '平台任务审核未通过' } })
      }
      const badgeGrants = await tx.topicActivityRewardGrant.findMany({ where: { activityId: activity.id, userId: submission.userId, origin: 'BADGE', status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } } })
      for (const badgeGrant of badgeGrants) {
        const snapshot = record(badgeGrant.rewardSnapshot)
        if (snapshot.event !== 'PLATFORM') continue
        if (!await hasApprovedSubmission(tx, activity, submission.userId, null, submission.id, true)) {
          await tx.topicActivityRewardGrant.update({ where: { id: badgeGrant.id }, data: { status: 'CANCELLED', errorMessage: '对应平台任务审核未通过' } })
        }
      }
    } else if (!entry && input.status === 'REJECTED') {
      const badgeGrants = await tx.topicActivityRewardGrant.findMany({ where: { activityId: activity.id, userId: submission.userId, origin: 'BADGE', status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } } })
      for (const badgeGrant of badgeGrants) {
        const snapshot = record(badgeGrant.rewardSnapshot)
        if (snapshot.event === 'APPROVED_COMMENT' && !await hasApprovedSubmission(tx, activity, submission.userId, null, submission.id)) {
          await tx.topicActivityRewardGrant.update({ where: { id: badgeGrant.id }, data: { status: 'CANCELLED', errorMessage: '对应评论审核未通过' } })
        }
      }
    }
    if (input.status === 'APPROVED') await grantTopicActivityV2MedalForEventInTransaction(tx, activity, {
      userId: submission.userId, event: entry ? 'PLATFORM' : 'APPROVED_COMMENT', effectiveAt: submission.submittedAt, now,
      ...(entry ? { rewardEntryId: entry.id } : { submissionId: submission.id }),
    })
    participation = await refreshParticipation(tx, participation.id, now)
    await syncTopicLotteryEligibilityInTransaction(tx, activity, submission.userId, now)
    return { submission: updated, participation, changed: true, firstParticipationCreated: input.status === 'APPROVED' && !current?.approvedSubmissionCount, rewardIds: [] as string[] }
  })
}

async function fixedEvidence(tx: Prisma.TransactionClient, activity: Activity, program: TopicActivityV2Program, userId: string, now: Date) {
  const condition = program.fixedReward.condition
  if (condition === 'ADMIN_REVIEW') return now
  if (condition === 'APPROVED_COMMENT') {
    const item = await tx.topicActivitySubmission.findFirst({ where: { activityId: activity.id, userId, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { isDeleted: false, parentId: null } } }, orderBy: { submittedAt: 'asc' }, select: { submittedAt: true } })
    return item?.submittedAt || null
  }
  if (condition === 'POLL' && program.poll.enabled) {
    const vote = await tx.topicActivityPollVote.findUnique({ where: { activityId_pollId_userId: { activityId: activity.id, pollId: program.poll.id, userId } }, select: { createdAt: true } })
    return vote?.createdAt || null
  }
  if (condition === 'TEST' && program.test.enabled) {
    const attempt = await tx.topicActivityTestAttempt.findFirst({ where: { activityId: activity.id, testId: program.test.id, configVersion: program.test.version, userId }, orderBy: { completedAt: 'asc' }, select: { completedAt: true } })
    return attempt?.completedAt || null
  }
  return null
}

export async function claimTopicActivityV2FixedReward(input: { activityId: string; userId: string; reviewerId?: string; decision?: 'APPROVED' | 'REJECTED'; now?: Date }) {
  const now = input.now || new Date()
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, input.activityId)
    const program = requireTopicV2Program(activity)
    const key = fixedKey(activity.id, input.userId)
    let grant = await tx.topicActivityRewardGrant.findUnique({ where: { grantKey: key } })
    if (grant?.status === 'GRANTED') return { grant, changed: false, pendingReview: false }
    if (input.decision) {
      if (!input.reviewerId || !grant || grant.origin !== 'FIXED') fail('TOPIC_V2_CLAIM_NOT_FOUND', '待审核固定奖励申请不存在', 404)
      if (grant.status === 'CANCELLED') return { grant, changed: false, pendingReview: false }
      const snapshot = record(grant.rewardSnapshot)
      const priorApprovalStatus = snapshotApprovalStatus(snapshot)
      if ((input.decision === 'APPROVED' && priorApprovalStatus === 'APPROVED') || (input.decision === 'REJECTED' && priorApprovalStatus === 'REJECTED')) {
        return { grant, changed: false, pendingReview: false }
      }
      const claimedAt = new Date(String(snapshot.claimedAt))
      if (!Number.isFinite(claimedAt.getTime())) fail('TOPIC_V2_SNAPSHOT_INVALID', '领取快照不完整')
      requireReviewWindow(activity, new Date(String(snapshot.effectiveAt || snapshot.claimedAt)))
      await tx.adminActionLog.create({ data: { adminId: input.reviewerId, targetUserId: input.userId, action: 'TOPIC_ACTIVITY_V2_FIXED_REWARD_' + input.decision, detail: json({ activityId: activity.id, grantId: grant.id }) } })
      if (input.decision === 'REJECTED') {
        grant = await tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: {
          status: 'CANCELLED', errorMessage: '固定奖励申请未通过',
          rewardSnapshot: json(snapshotWithApproval(snapshot, { approvalStatus: 'REJECTED', rejectedAt: now.toISOString(), rejectedById: input.reviewerId })),
        } })
      } else {
        grant = await tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: {
          status: 'PENDING', errorMessage: null,
          rewardSnapshot: json(snapshotWithApproval(snapshot, { approvalStatus: 'APPROVED', approvedAt: now.toISOString(), approvedById: input.reviewerId })),
        } })
        if (rewardReleaseDue(activity, now)) grant = await grantPoints(tx, activity, grant, now)
      }
      await refreshParticipation(tx, grant.participationId, now)
      return { grant, changed: true, pendingReview: false }
    }
    if (grant) return { grant, changed: false, pendingReview: grant.status !== 'CANCELLED' && snapshotApprovalStatus(grant.rewardSnapshot) !== 'APPROVED' }
    if (!program.fixedReward.enabled) fail('TOPIC_V2_FIXED_REWARD_DISABLED', '固定奖励未启用')
    if (activity.status !== 'PUBLISHED') fail('ACTIVITY_CLOSED', '活动当前未开放')
    requireWindow(program.fixedReward.startsAt || activity.startsAt?.toISOString() || null, program.fixedReward.endsAt || activity.endsAt?.toISOString() || null, now)
    await requireActiveUser(tx, input.userId)
    const evidence = await fixedEvidence(tx, activity, program, input.userId, now)
    if (!evidence || !withinActivity(activity, evidence)) fail('TOPIC_V2_FIXED_REWARD_NOT_ELIGIBLE', '尚未完成指定的站内参与行为')
    const participation = await syncParticipation(tx, activity.id, input.userId, now)
    const pendingReview = program.fixedReward.requiresReview || program.fixedReward.condition === 'ADMIN_REVIEW'
    const evidenceSnapshot = program.fixedReward.condition === 'POLL'
      ? { pollId: program.poll.id }
      : program.fixedReward.condition === 'TEST'
        ? { testId: program.test.id, configVersion: program.test.version }
        : {}
    grant = await createGrant(tx, { participationId: participation.id, activityId: activity.id, userId: input.userId,
      points: program.fixedReward.points, origin: 'FIXED', grantKey: key,
      snapshot: { ...program.fixedReward, ...evidenceSnapshot, claimedAt: now.toISOString(), effectiveAt: evidence.toISOString(), approvalStatus: pendingReview ? 'PENDING' : 'APPROVED', ...(pendingReview ? {} : { approvedAt: now.toISOString() }) } })
    if (!pendingReview && rewardReleaseDue(activity, now)) grant = await grantPoints(tx, activity, grant, now)
    await refreshParticipation(tx, participation.id, now)
    return { grant, changed: true, pendingReview }
  })
}

async function hasApprovedSubmission(
  tx: Prisma.TransactionClient,
  activity: Pick<Activity, 'id' | 'activityPostId'>,
  userId: string,
  rewardEntryId?: string | null,
  excludeSubmissionId?: string,
  platformOnly = false,
) {
  if (!activity.activityPostId) return false
  return Boolean(await tx.topicActivitySubmission.findFirst({ where: {
    activityId: activity.id, userId,
    ...(platformOnly ? { rewardEntryId: { not: null } } : rewardEntryId ? { rewardEntryId } : {}),
    ...(excludeSubmissionId ? { id: { not: excludeSubmissionId } } : {}), status: 'APPROVED', commentDeletedAt: null,
    Comment: { is: { postId: activity.activityPostId, isDeleted: false, parentId: null } },
  }, select: { id: true } }))
}

async function fixedGrantEvidenceStillValid(tx: Prisma.TransactionClient, activity: Activity, grant: TopicActivityRewardGrant) {
  const snapshot = record(grant.rewardSnapshot)
  if (snapshotApprovalStatus(snapshot) !== 'APPROVED') return null
  const condition = snapshot.condition
  if (condition === 'ADMIN_REVIEW') return snapshot
  if (condition === 'APPROVED_COMMENT') return await hasApprovedSubmission(tx, activity, grant.userId) ? snapshot : null
  if (condition === 'POLL' && typeof snapshot.pollId === 'string') {
    const vote = await tx.topicActivityPollVote.findUnique({ where: { activityId_pollId_userId: { activityId: activity.id, pollId: snapshot.pollId, userId: grant.userId } }, select: { id: true } })
    return vote ? snapshot : null
  }
  if (condition === 'TEST' && typeof snapshot.testId === 'string' && typeof snapshot.configVersion === 'number') {
    const attempt = await tx.topicActivityTestAttempt.findFirst({ where: { activityId: activity.id, testId: snapshot.testId, configVersion: snapshot.configVersion, userId: grant.userId }, select: { id: true } })
    return attempt ? snapshot : null
  }
  return null
}

async function badgeGrantEvidenceStillValid(tx: Prisma.TransactionClient, activity: Activity, grant: TopicActivityRewardGrant) {
  const snapshot = record(grant.rewardSnapshot)
  const event = snapshot.event
  if (event === 'PLATFORM') return await hasApprovedSubmission(tx, activity, grant.userId, null, undefined, true)
  if (event === 'APPROVED_COMMENT') {
    if (typeof snapshot.submissionId === 'string') {
      const current = activity.activityPostId ? await tx.topicActivitySubmission.findFirst({ where: { id: snapshot.submissionId, activityId: activity.id, userId: grant.userId, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { postId: activity.activityPostId, isDeleted: false, parentId: null } } }, select: { id: true } }) : null
      if (current) return true
    }
    return await hasApprovedSubmission(tx, activity, grant.userId)
  }
  if (event === 'POLL' && typeof snapshot.pollId === 'string') {
    return Boolean(await tx.topicActivityPollVote.findUnique({ where: { activityId_pollId_userId: { activityId: activity.id, pollId: snapshot.pollId, userId: grant.userId } }, select: { id: true } }))
  }
  if (event === 'TEST' && typeof snapshot.testId === 'string' && typeof snapshot.configVersion === 'number') {
    return Boolean(await tx.topicActivityTestAttempt.findFirst({ where: { activityId: activity.id, testId: snapshot.testId, configVersion: snapshot.configVersion, userId: grant.userId }, select: { id: true } }))
  }
  return false
}

async function processTopicActivityV2RewardGrant(rewardId: string, now: Date) {
  return withTopicV2Transaction(async (tx) => {
    const identity = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId }, select: { activityId: true } })
    if (!identity) return 'MISSING' as const
    const activity = await lockTopicV2Activity(tx, identity.activityId)
    await lockTopicV2RewardGrant(tx, rewardId)
    const grant = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId } })
    if (!grant || grant.status === 'GRANTED' || grant.status === 'CANCELLED') return grant?.status || 'MISSING'
    if (activity.status === 'CANCELLED') {
      await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'CANCELLED', errorMessage: '活动已取消' } })
      await refreshParticipation(tx, grant.participationId, now)
      return 'CANCELLED' as const
    }
    if (!rewardReleaseDue(activity, now)) return 'PENDING' as const
    await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'PROCESSING', errorMessage: null } })
    let current = grant
    if (grant.origin === 'PLATFORM') {
      if (!(await hasApprovedSubmission(tx, activity, grant.userId, grant.rewardEntryId))) {
        current = await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'CANCELLED', errorMessage: '活动参与资格已取消' } })
        await refreshParticipation(tx, grant.participationId, now)
        return current.status
      }
      current = await grantPoints(tx, activity, { ...grant, status: 'PROCESSING' }, now)
    } else if (grant.origin === 'FIXED') {
      const snapshot = await fixedGrantEvidenceStillValid(tx, activity, grant)
      if (snapshotApprovalStatus(grant.rewardSnapshot) !== 'APPROVED') {
        await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'PENDING', errorMessage: null } })
        return 'PENDING' as const
      }
      if (!snapshot) {
        current = await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'CANCELLED', errorMessage: '固定奖励参与条件已失效' } })
        await refreshParticipation(tx, grant.participationId, now)
        return current.status
      }
      current = await grantPoints(tx, activity, { ...grant, status: 'PROCESSING' }, now)
    } else if (grant.origin === 'BADGE') {
      if (!(await badgeGrantEvidenceStillValid(tx, activity, grant))) {
        current = await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'CANCELLED', errorMessage: '勋章对应参与资格已取消' } })
        await refreshParticipation(tx, grant.participationId, now)
        return current.status
      }
      current = await grantBadgeForGrant(tx, activity, { ...grant, status: 'PROCESSING' }, now)
    } else {
      current = await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'CANCELLED', errorMessage: '未知话题奖励来源' } })
      await refreshParticipation(tx, grant.participationId, now)
      return current.status
    }
    await refreshParticipation(tx, grant.participationId, now)
    return current.status
  })
}

async function markTopicActivityV2RewardFailed(rewardId: string, now: Date, error: unknown) {
  const message = (error instanceof Error ? error.message : '奖励发放失败').slice(0, 500)
  try {
    await withTopicV2Transaction(async (tx) => {
      const identity = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId }, select: { activityId: true } })
      if (!identity) return
      await lockTopicV2Activity(tx, identity.activityId)
      await lockTopicV2RewardGrant(tx, rewardId)
      const row = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId } })
      if (!row || row.status === 'GRANTED' || row.status === 'CANCELLED') return
      await tx.topicActivityRewardGrant.update({ where: { id: rewardId }, data: { status: 'FAILED', errorMessage: message } })
      await refreshParticipation(tx, row.participationId, now)
    })
  } catch (markError) {
    console.error('[topic-v2.reward.failed-mark]', { rewardId, error: markError instanceof Error ? markError.message : String(markError) })
  }
}

export async function dispatchDueTopicActivityV2Rewards(input: { now?: Date; batchSize?: number } = {}) {
  const now = input.now || new Date()
  const batchSize = Math.min(Math.max(Math.trunc(input.batchSize || 100), 1), 500)
  const rows = await prisma.topicActivityRewardGrant.findMany({
    where: {
      origin: { in: ['PLATFORM', 'FIXED', 'BADGE'] }, status: { in: ['PENDING', 'FAILED'] },
      Activity: { status: { not: 'CANCELLED' }, OR: [
        { rewardGrantMode: 'IMMEDIATE' },
        { rewardGrantMode: 'SCHEDULED', rewardGrantAt: { lte: now } },
      ] },
      OR: [
        { origin: { in: ['PLATFORM', 'BADGE'] } },
        { origin: 'FIXED', rewardSnapshot: { path: '$.approvalStatus', equals: 'APPROVED' } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: batchSize, select: { id: true },
  })
  let processed = 0
  let failed = 0
  for (const row of rows) {
    try {
      await processTopicActivityV2RewardGrant(row.id, now)
      processed++
    } catch (error) {
      failed++
      await markTopicActivityV2RewardFailed(row.id, now, error)
      console.error('[topic-v2.reward.failed]', { rewardId: row.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { processed, failed }
}

export async function getTopicActivityV2View(activityId: string, userId?: string | null, isAdmin = false) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, type: true, status: true, startsAt: true, endsAt: true, allowImageAttachments: true, activityPostId: true, topicProgram: true, ActivityPost: { select: { authorId: true } } } })
  if (!activity || activity.type !== 'TOPIC_ACTIVITY' || (!isAdmin && !['PUBLISHED', 'CANCELLED'].includes(activity.status))) fail('TOPIC_V2_ACTIVITY_NOT_FOUND', '活动不存在', 404)
  const program = readTopicActivityV2Program(activity.topicProgram)
  const visible = isAdmin ? program || createDefaultTopicActivityV2Program() : program?.enabled ? program : null
  const entries = visible?.entries.filter((entry) => isAdmin || (visible.platformRewards.enabled && entry.enabled)).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)) || []
  let myProgress: Record<string, unknown> | null = null
  if (userId && visible) {
    const [submissions, grants, votes, attempts, submittedCount, approvedCount] = await Promise.all([
      prisma.topicActivitySubmission.findMany({ where: { activityId, userId }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 100, select: { id: true, rewardEntryId: true, rewardSnapshot: true, commentId: true, status: true, rejectReason: true, submittedAt: true, reviewedAt: true } }),
      prisma.topicActivityRewardGrant.findMany({ where: { activityId, userId }, select: { id: true, rewardEntryId: true, rewardSnapshot: true, origin: true, kind: true, points: true, badgeId: true, status: true, grantedAt: true } }),
      prisma.topicActivityPollVote.findMany({ where: { activityId, userId }, select: { pollId: true, choices: true, configVersion: true } }),
      prisma.topicActivityTestAttempt.findMany({ where: { activityId, userId }, orderBy: { completedAt: 'desc' }, take: 20, select: { id: true, testId: true, configVersion: true, resultId: true, resultSnapshot: true, completedAt: true } }),
      prisma.topicActivitySubmission.count({ where: { activityId, userId } }),
      prisma.topicActivitySubmission.count({ where: { activityId, userId, status: 'APPROVED' } }),
    ])
    const paid = grants.filter((grant) => grant.status === 'GRANTED')
    const platforms = [...new Set(paid.filter((grant) => grant.rewardEntryId).map((grant) => platformKey(grant.rewardSnapshot)).filter(Boolean))]
    const platformPoints = paid.filter((grant) => grant.rewardEntryId && grant.kind === 'POINTS').reduce((total, grant) => total + (grant.points || 0), 0)
    const fixedPoints = paid.filter((grant) => !grant.rewardEntryId && grant.kind === 'POINTS').reduce((total, grant) => total + (grant.points || 0), 0)
    const limit = visible.platformRewards.allowStacking ? visible.platformRewards.maxPlatforms : 1
    myProgress = { submissions, grants, pollVotes: votes, testAttempts: attempts, completedPlatforms: platforms,
      fixedRewardGranted: fixedPoints > 0, platformGrantedPoints: platformPoints, fixedGrantedPoints: fixedPoints, totalGrantedPoints: platformPoints + fixedPoints,
      submittedCount, approvedCount,
      medal: paid.find((grant) => grant.kind === 'BADGE' && (!visible.medal.badgeId || grant.badgeId === visible.medal.badgeId)) || null,
      remainingPlatformCount: limit === null ? null : Math.max(0, limit - platforms.length),
      remainingPlatforms: [...new Set(entries.map((entry) => entry.platformKey))].filter((key) => !platforms.includes(key)),
    }
  }
  return { activity: { id: activity.id, title: activity.title, status: activity.status, startsAt: activity.startsAt, endsAt: activity.endsAt,
    allowImageAttachments: activity.allowImageAttachments, activityPostId: activity.activityPostId, postAuthorId: activity.ActivityPost?.authorId || null },
    program: visible ? isAdmin ? visible : publicTopicActivityV2Program(visible) : null, entries, myProgress, canReview: isAdmin }
}

export async function getTopicActivityV2Statistics(activityId: string) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { topicProgram: true } })
  const program = activity ? readTopicActivityV2Program(activity.topicProgram) : null
  const [submissions, grants, votes, attempts] = await Promise.all([
    prisma.topicActivitySubmission.findMany({ where: { activityId }, select: { userId: true, rewardEntryId: true, rewardSnapshot: true, status: true } }),
    prisma.topicActivityRewardGrant.findMany({ where: { activityId, status: 'GRANTED' }, select: { userId: true, rewardEntryId: true, rewardSnapshot: true, kind: true, points: true, badgeId: true } }),
    prisma.topicActivityPollVote.findMany({ where: { activityId }, select: { userId: true, pollId: true, choices: true } }),
    prisma.topicActivityTestAttempt.findMany({ where: { activityId }, select: { userId: true, resultId: true } }),
  ])
  const platformKeys = [...new Set([...submissions.map((row) => platformKey(row.rewardSnapshot)), ...grants.map((row) => platformKey(row.rewardSnapshot))].filter((key): key is string => Boolean(key)))]
  const platformStats = platformKeys.map((key) => {
    const submitted = submissions.filter((row) => platformKey(row.rewardSnapshot) === key)
    const paid = grants.filter((row) => platformKey(row.rewardSnapshot) === key)
    return { platformKey: key, submittedUsers: new Set(submitted.map((row) => row.userId)).size, submittedCount: submitted.length,
      approvedUsers: new Set(submitted.filter((row) => row.status === 'APPROVED').map((row) => row.userId)).size, rewardCount: paid.length,
      points: paid.reduce((total, row) => total + (row.points || 0), 0) }
  })
  const entryStats = [...new Set(submissions.map((row) => row.rewardEntryId).filter(Boolean))].map((id) => ({ rewardEntryId: id,
    submissionCount: submissions.filter((row) => row.rewardEntryId === id).length, rewardCount: grants.filter((row) => row.rewardEntryId === id).length }))
  return { participantCount: new Set([...submissions.filter((row) => row.status === 'APPROVED').map((row) => row.userId), ...votes.map((row) => row.userId), ...attempts.map((row) => row.userId)]).size,
    submittedUsers: new Set(submissions.map((row) => row.userId)).size, submissionCount: submissions.length,
    approvedCount: submissions.filter((row) => row.status === 'APPROVED').length, rejectedCount: submissions.filter((row) => row.status === 'REJECTED').length,
    platformRewardPoints: grants.filter((row) => row.rewardEntryId).reduce((sum, row) => sum + (row.points || 0), 0),
    fixedRewardPoints: grants.filter((row) => !row.rewardEntryId && row.kind === 'POINTS').reduce((sum, row) => sum + (row.points || 0), 0),
    totalPoints: grants.reduce((sum, row) => sum + (row.points || 0), 0),
    medalUsers: new Set(grants.filter((row) => row.kind === 'BADGE').map((row) => row.userId)).size,
    pollParticipants: new Set(votes.map((row) => row.userId)).size, testParticipants: new Set(attempts.map((row) => row.userId)).size,
    pollResults: program ? program.poll.options.map((option) => {
      const current = votes.filter((vote) => vote.pollId === program.poll.id)
      const count = current.filter((vote) => Array.isArray(vote.choices) && vote.choices.includes(option.id)).length
      return { id: option.id, label: option.label, count, percentage: current.length ? Math.round(count / current.length * 1000) / 10 : 0 }
    }) : [],
    testAttempts: attempts.length, resultDistribution: [...new Set(attempts.map((row) => row.resultId))].map((id) => ({ resultId: id, count: attempts.filter((row) => row.resultId === id).length })),
    platforms: platformStats, entries: entryStats,
  }
}
