import { Prisma, type TopicActivityRewardGrantItemStatus, type TopicActivityRewardStatus, type TopicActivitySubmissionStatus } from '@prisma/client'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { formatBeijingDateTimeDisplay } from '@/lib/registration-availability'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { prisma } from '@/lib/prisma'

const ACTIVE_REWARD_ITEM_STATUSES: TopicActivityRewardGrantItemStatus[] = ['PENDING', 'FAILED']

export type TopicSubmissionResolvedStatus = 'NOT_PARTICIPATED' | 'PENDING' | 'APPROVED' | 'REJECTED'

export function resolveTopicSubmissionStatus(input: { total: number; pending: number; approved: number; rejected: number }): TopicSubmissionResolvedStatus {
  if (input.approved > 0) return 'APPROVED'
  if (input.pending > 0) return 'PENDING'
  if (input.rejected > 0) return 'REJECTED'
  return 'NOT_PARTICIPATED'
}

function badgeIds(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export function buildTopicActivityPostContent(activity: {
  title: string
  description: string
  participationRule: string | null
  startsAt: Date | null
  endsAt: Date | null
  rewardGrantMode: 'IMMEDIATE' | 'SCHEDULED'
  rewardGrantAt: Date | null
  rewardPoints: number | null
  rewardBadgeIds: Prisma.JsonValue | null
}, badgeNames: readonly string[]) {
  const rewardParts = [
    activity.rewardPoints ? `${activity.rewardPoints} 挂号费` : null,
    ...badgeNames,
  ].filter(Boolean)
  const time = activity.startsAt && activity.endsAt
    ? `${formatBeijingDateTimeDisplay(activity.startsAt)} — ${formatBeijingDateTimeDisplay(activity.endsAt)}`
    : '以活动页面时间为准'
  const grantMode = activity.rewardGrantMode === 'SCHEDULED' && activity.rewardGrantAt
    ? `统一于 ${formatBeijingDateTimeDisplay(activity.rewardGrantAt)} 发放`
    : '审核通过后发放'
  return [
    activity.description.trim(),
    activity.participationRule ? `参与方式\n${activity.participationRule.trim()}` : null,
    `活动时间\n${time}`,
    rewardParts.length ? `活动奖励\n${rewardParts.join('、')}（${grantMode}）` : null,
  ].filter(Boolean).join('\n\n')
}

export async function syncActivityPostInTransaction(tx: Prisma.TransactionClient, activityId: string, now = new Date()) {
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true, title: true, description: true, type: true, status: true, startsAt: true, endsAt: true,
      participationRule: true, rewardGrantMode: true, rewardGrantAt: true, rewardPoints: true,
      rewardBadgeIds: true, pinToPlaza: true, activityPostId: true, createdById: true,
    },
  })
  if (!activity) throw new Error('TOPIC_ACTIVITY_NOT_FOUND')
  const shouldHavePost = activity.type === 'TOPIC_ACTIVITY' || activity.pinToPlaza || Boolean(activity.activityPostId)
  const shouldPublishPost = activity.status === 'PUBLISHED'
  const pinned = shouldPublishPost && activity.pinToPlaza && (!activity.endsAt || activity.endsAt >= now)
  const ids = badgeIds(activity.rewardBadgeIds)
  const badges = ids.length ? await tx.badge.findMany({ where: { id: { in: ids } }, select: { name: true } }) : []
  const content = buildTopicActivityPostContent(activity, badges.map((badge) => badge.name))

  if (!activity.activityPostId) {
    if (!shouldHavePost || !shouldPublishPost) return null
    const board = await tx.board.findUnique({ where: { slug: 'daily-chat' }, select: { id: true } })
    if (!board) throw new Error('TOPIC_ACTIVITY_BOARD_NOT_FOUND')
    const postAuthorId = activity.createdById || (await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id
    if (!postAuthorId) throw new Error('TOPIC_ACTIVITY_POST_AUTHOR_NOT_FOUND')
    const post = await tx.post.create({
      data: {
        title: activity.title,
        content,
        authorId: postAuthorId,
        boardId: board.id,
        status: 'PUBLISHED',
        moderationStatus: 'APPROVED',
        activityPinned: pinned,
        isPinned: false,
      },
      select: { id: true },
    })
    await tx.activity.update({ where: { id: activity.id }, data: { activityPostId: post.id } })
    return post.id
  }

  if (activity.status === 'CANCELLED' && activity.type === 'TOPIC_ACTIVITY') {
    await tx.post.updateMany({
      where: {
        id: activity.activityPostId,
        OR: [{ isDeleted: false }, { deletedAt: null }, { activityPinned: true }, { isLocked: false }],
      },
      data: { isDeleted: true, deletedAt: now, activityPinned: false, isLocked: true },
    })
    return activity.activityPostId
  }

  await tx.post.update({
    where: { id: activity.activityPostId },
    data: {
      title: activity.title,
      content,
      activityPinned: pinned,
      isLocked: activity.status === 'CANCELLED',
      status: activity.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
      isDeleted: false,
      deletedAt: null,
    },
  })
  return activity.activityPostId
}

export async function createTopicSubmissionForCommentInTransaction(tx: Prisma.TransactionClient, input: {
  postId: string
  commentId: string
  userId: string
  isAdmin: boolean
  now: Date
}) {
  const activity = await tx.activity.findFirst({
    where: {
      type: 'TOPIC_ACTIVITY',
      status: 'PUBLISHED',
      activityPostId: input.postId,
      startsAt: { lte: input.now },
      endsAt: { gte: input.now },
    },
    select: { id: true, participationMode: true },
  })
  if (!activity) return null
  return tx.topicActivitySubmission.create({
    data: { activityId: activity.id, userId: input.userId, commentId: input.commentId, submittedAt: input.now },
    select: { id: true, activityId: true, status: true },
  })
}

export async function reconcileTopicActivityCommentSubmissions(activityId: string, batchSize = 250) {
  const boundedBatchSize = Math.min(Math.max(Math.trunc(batchSize) || 250, 1), 500)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
    const activity = await tx.activity.findUnique({
      where: { id: activityId },
      select: { id: true, type: true, status: true, activityPostId: true, startsAt: true, endsAt: true, participationMode: true },
    })
    if (!activity || activity.type !== 'TOPIC_ACTIVITY') throw new Error('TOPIC_ACTIVITY_NOT_FOUND')
    if (activity.status === 'CANCELLED') throw new Error('TOPIC_ACTIVITY_CANCELLED')
    if (activity.status !== 'PUBLISHED' || !activity.activityPostId) throw new Error('TOPIC_ACTIVITY_POST_UNAVAILABLE')
    if (!activity.startsAt || !activity.endsAt) throw new Error('TOPIC_ACTIVITY_WINDOW_UNAVAILABLE')
    const post = await tx.post.findUnique({ where: { id: activity.activityPostId }, select: { isDeleted: true } })
    if (!post || post.isDeleted) throw new Error('TOPIC_ACTIVITY_POST_UNAVAILABLE')
    const comments = await tx.reply.findMany({
      where: {
        postId: activity.activityPostId,
        parentId: null,
        isDeleted: false,
        createdAt: { gte: activity.startsAt, lte: activity.endsAt },
        TopicActivitySubmission: { is: null },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: boundedBatchSize,
      select: { id: true, authorId: true, createdAt: true },
    })
    if (!comments.length) return { scanned: 0, created: 0, hasMore: false }
    const inserted = await tx.topicActivitySubmission.createMany({
      data: comments.map((comment) => ({
        activityId: activity.id,
        userId: comment.authorId,
        commentId: comment.id,
        submittedAt: comment.createdAt,
      })),
      skipDuplicates: true,
    })
    return { scanned: comments.length, created: inserted.count, hasMore: comments.length === boundedBatchSize }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}

async function ensureRewardItems(tx: Prisma.TransactionClient, participation: { id: string; activityId: string; userId: string }, activity: {
  rewardPoints: number | null
  rewardBadgeIds: Prisma.JsonValue | null
}) {
  const items: Array<Prisma.TopicActivityRewardGrantCreateManyInput> = []
  const prefix = `topic-activity:${participation.activityId}:${participation.userId}`
  if (activity.rewardPoints && activity.rewardPoints > 0) items.push({
    participationId: participation.id, activityId: participation.activityId, userId: participation.userId,
    kind: 'POINTS', points: activity.rewardPoints, grantKey: `${prefix}:points`,
  })
  for (const badgeId of badgeIds(activity.rewardBadgeIds)) items.push({
    participationId: participation.id, activityId: participation.activityId, userId: participation.userId,
    kind: 'BADGE', badgeId, grantKey: `${prefix}:badge:${badgeId}`,
  })
  if (items.length) await tx.topicActivityRewardGrant.createMany({ data: items, skipDuplicates: true })
  return items.length
}

type ReviewActivitySnapshot = {
  id: string
  status: string
  rewardGrantMode: 'IMMEDIATE' | 'SCHEDULED'
  rewardGrantAt: Date | null
  rewardPoints: number | null
  rewardBadgeIds: Prisma.JsonValue | null
}

/**
 * Only approved, undeleted root comments establish participation. Forms are
 * information collection, including legacy forms with a review status.
 * Callers lock Activity before reviews; reward keys remain user/activity scoped.
 */
async function syncTopicActivityParticipationForUser(tx: Prisma.TransactionClient, input: {
  activity: ReviewActivitySnapshot
  userId: string
  submissionId: string
  now: Date
}) {
  const nextCount = await tx.topicActivitySubmission.count({ where: { activityId: input.activity.id, userId: input.userId, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { parentId: null, isDeleted: false } } } })
  let participation = await tx.topicActivityParticipation.findUnique({ where: { activityId_userId: { activityId: input.activity.id, userId: input.userId } } })
  // A legacy aggregate may have been formed entirely by form reviews. Do not
  // treat that cached count as an earlier approved comment.
  const previousCount = await tx.topicActivitySubmission.count({ where: { activityId: input.activity.id, userId: input.userId, id: { not: input.submissionId }, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { parentId: null, isDeleted: false } } } })
  let rewardIds: string[] = []

  if (nextCount > 0) {
    const firstActiveApproval = previousCount === 0
    if (!participation) {
      participation = await tx.topicActivityParticipation.create({
        data: { activityId: input.activity.id, userId: input.userId, firstApprovedSubmissionId: input.submissionId, firstApprovedAt: input.now, approvedSubmissionCount: nextCount },
      })
    } else {
      participation = await tx.topicActivityParticipation.update({
        where: { id: participation.id },
        data: {
          approvedSubmissionCount: nextCount,
          ...(firstActiveApproval ? { firstApprovedSubmissionId: input.submissionId, firstApprovedAt: input.now, reviewReversedAfterReward: participation.rewardGrantedAt ? true : participation.reviewReversedAfterReward } : {}),
        },
      })
    }

    if (firstActiveApproval) {
      const existingGrants = await tx.topicActivityRewardGrant.findMany({ where: { participationId: participation.id }, select: { id: true, status: true } })
      if (input.activity.status === 'CANCELLED') {
        await tx.topicActivityRewardGrant.updateMany({
          where: { participationId: participation.id, status: { in: ACTIVE_REWARD_ITEM_STATUSES } },
          data: { status: 'CANCELLED', errorMessage: '活动已取消' },
        })
        const hasGranted = existingGrants.some((grant) => grant.status === 'GRANTED')
        const hasOtherGrantItems = existingGrants.some((grant) => grant.status !== 'GRANTED')
        const hasConfiguredRewards = Boolean(input.activity.rewardPoints && input.activity.rewardPoints > 0) || badgeIds(input.activity.rewardBadgeIds).length > 0
        participation = await tx.topicActivityParticipation.update({
          where: { id: participation.id },
          data: { rewardStatus: !hasConfiguredRewards ? 'NOT_ELIGIBLE' : hasGranted ? (hasOtherGrantItems ? 'PARTIAL' : 'GRANTED') : 'CANCELLED' },
        })
      } else {
        if (!existingGrants.length) {
          const itemCount = await ensureRewardItems(tx, participation, input.activity)
          participation = await tx.topicActivityParticipation.update({
            where: { id: participation.id },
            data: { rewardEligibleAt: input.now, rewardStatus: itemCount ? 'PENDING' : 'NOT_ELIGIBLE' },
          })
        } else if (!existingGrants.some((grant) => grant.status === 'GRANTED')) {
          await tx.topicActivityRewardGrant.updateMany({ where: { participationId: participation.id, status: 'CANCELLED' }, data: { status: 'PENDING', errorMessage: null } })
          participation = await tx.topicActivityParticipation.update({ where: { id: participation.id }, data: { rewardEligibleAt: input.now, rewardStatus: 'PENDING' } })
        }
      }
    }
    rewardIds = (await tx.topicActivityRewardGrant.findMany({ where: { participationId: participation.id, status: { in: ACTIVE_REWARD_ITEM_STATUSES } }, select: { id: true } })).map((grant) => grant.id)
    return { participation, rewardIds, firstParticipationCreated: previousCount === 0 }
  }

  if (participation) {
    const grants = await tx.topicActivityRewardGrant.findMany({ where: { participationId: participation.id }, select: { status: true } })
    const hasGranted = grants.some((grant) => grant.status === 'GRANTED')
    if (!hasGranted) {
      await tx.topicActivityRewardGrant.updateMany({ where: { participationId: participation.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED', errorMessage: '有效通过已撤销' } })
    }
    participation = await tx.topicActivityParticipation.update({
      where: { id: participation.id },
      data: {
        approvedSubmissionCount: 0,
        firstApprovedSubmissionId: null,
        firstApprovedAt: null,
        ...(!hasGranted ? { rewardStatus: 'CANCELLED' as const } : { reviewReversedAfterReward: true }),
      },
    })
  }
  return { participation, rewardIds, firstParticipationCreated: false }
}

export async function reviewTopicActivitySubmission(input: {
  submissionId: string
  reviewerId: string
  status: 'APPROVED' | 'REJECTED'
  rejectReason?: string | null
  now?: Date
}) {
  const now = input.now || new Date()
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.topicActivitySubmission.findUnique({ where: { id: input.submissionId }, select: { activityId: true } })
    if (!initial) throw new Error('TOPIC_SUBMISSION_NOT_FOUND')
    await tx.$queryRaw`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${initial.activityId} FOR UPDATE`
    const submission = await tx.topicActivitySubmission.findUnique({
      where: { id: input.submissionId },
      include: {
        Activity: { select: { id: true, type: true, activityPostId: true, participationMode: true, rewardGrantMode: true, rewardGrantAt: true, rewardPoints: true, rewardBadgeIds: true, status: true } },
        Comment: { select: { postId: true, parentId: true, isDeleted: true } },
      },
    })
    if (!submission || submission.Activity.type !== 'TOPIC_ACTIVITY' || !submission.Comment || submission.commentDeletedAt || submission.Comment.isDeleted || submission.Comment.parentId) throw new Error('TOPIC_SUBMISSION_COMMENT_UNAVAILABLE')
    if (submission.Activity.activityPostId !== submission.Comment.postId || submission.activityId !== submission.Activity.id) throw new Error('TOPIC_SUBMISSION_RELATION_INVALID')
    if (submission.status === input.status) return { submission, participation: await tx.topicActivityParticipation.findUnique({ where: { activityId_userId: { activityId: submission.activityId, userId: submission.userId } } }), rewardIds: [] as string[], changed: false, firstParticipationCreated: false }
    if (submission.status === 'WITHDRAWN') throw new Error('TOPIC_SUBMISSION_WITHDRAWN')
    if (input.status === 'APPROVED' && submission.Activity.participationMode === 'FORM') {
      const form = await tx.topicActivityFormSubmission.findFirst({ where: { activityId: submission.activityId, userId: submission.userId }, select: { id: true } })
      if (!form) throw new Error('FORM_REQUIRED_BEFORE_APPROVAL')
    }
    const fromStatus = submission.status
    const updated = await tx.topicActivitySubmission.update({
      where: { id: submission.id },
      data: { status: input.status, reviewedAt: now, reviewedById: input.reviewerId, rejectReason: input.status === 'REJECTED' ? (input.rejectReason?.trim().slice(0, 2_000) || null) : null },
    })
    await tx.topicActivityReviewLog.create({
      data: { submissionId: submission.id, activityId: submission.activityId, userId: submission.userId, commentId: submission.commentId, fromStatus, toStatus: input.status, reviewedById: input.reviewerId, reason: input.status === 'REJECTED' ? (input.rejectReason?.trim().slice(0, 2_000) || null) : null, reviewedAt: now },
    })

    const aggregate = await syncTopicActivityParticipationForUser(tx, { activity: submission.Activity, userId: submission.userId, submissionId: submission.id, now })
    return { submission: updated, ...aggregate, changed: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  if (result.changed && input.status === 'APPROVED') {
    const participation = result.participation
    if (participation && result.rewardIds.length && (await prisma.activity.findUnique({ where: { id: participation.activityId }, select: { rewardGrantMode: true } }))?.rewardGrantMode === 'IMMEDIATE') {
      await grantTopicActivityRewardItems(result.rewardIds, now)
    }
  }
  const freshParticipation = result.participation
    ? await prisma.topicActivityParticipation.findUnique({ where: { id: result.participation.id } })
    : null
  return { ...result, participation: freshParticipation }
}

async function refreshParticipationRewardStatus(tx: Prisma.TransactionClient, participationId: string, now: Date) {
  const grants = await tx.topicActivityRewardGrant.findMany({ where: { participationId }, select: { status: true } })
  const statuses = grants.map((grant) => grant.status)
  const grantedCount = statuses.filter((status) => status === 'GRANTED').length
  const next: TopicActivityRewardStatus = !statuses.length
    ? 'NOT_ELIGIBLE'
    : grantedCount === statuses.length
      ? 'GRANTED'
      : grantedCount > 0
        ? 'PARTIAL'
        : statuses.some((status) => status === 'PROCESSING')
          ? 'PROCESSING'
          : statuses.some((status) => status === 'FAILED')
            ? 'FAILED'
            : statuses.some((status) => status === 'PENDING')
              ? 'PENDING'
              : 'CANCELLED'
  await tx.topicActivityParticipation.update({ where: { id: participationId }, data: { rewardStatus: next, ...(next === 'GRANTED' ? { rewardGrantedAt: now } : {}) } })
}

async function grantTopicActivityRewardItem(rewardId: string, now: Date) {
  const badgeEffect = await prisma.$transaction(async (tx) => {
    const identity = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId }, select: { activityId: true } })
    if (!identity) return null
    // Admin cancellation locks Activity before reward rows; keep a single lock
    // order when a scheduled worker races that operation.
    await tx.$queryRaw`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${identity.activityId} FOR UPDATE`
    await tx.$queryRaw`SELECT \`id\` FROM \`TopicActivityRewardGrant\` WHERE \`id\` = ${rewardId} FOR UPDATE`
    const grant = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId }, include: { Participation: true, Activity: { select: { title: true, status: true, rewardGrantMode: true, rewardGrantAt: true } } } })
    if (!grant || grant.status === 'GRANTED' || grant.status === 'CANCELLED') return null
    const approvedComments = await tx.topicActivitySubmission.count({ where: { activityId: grant.activityId, userId: grant.userId, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { parentId: null, isDeleted: false } } } })
    if (approvedComments <= 0 || grant.Activity.status === 'CANCELLED') {
      await tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: { status: 'CANCELLED', errorMessage: '活动参与资格已取消' } })
      await refreshParticipationRewardStatus(tx, grant.participationId, now)
      return null
    }
    if (grant.Activity.rewardGrantMode === 'SCHEDULED' && (!grant.Activity.rewardGrantAt || grant.Activity.rewardGrantAt > now)) return null
    await tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: { status: 'PROCESSING', errorMessage: null } })
    let grantedBadgeEffect: { userId: string; badgeId: string; recordId: string; created: boolean } | null = null
    if (grant.kind === 'POINTS' && grant.points && grant.points > 0) {
      const existingLog = await tx.pointLog.findUnique({ where: { businessKey: grant.grantKey }, select: { id: true } })
      if (!existingLog) {
        await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${grant.userId} FOR UPDATE`
        const user = await tx.user.findUnique({ where: { id: grant.userId }, select: { points: true } })
        if (!user) throw new Error('TOPIC_REWARD_USER_NOT_FOUND')
        const after = user.points + grant.points
        await tx.user.update({ where: { id: grant.userId }, data: { points: { increment: grant.points } } })
        await tx.pointLog.create({ data: { userId: grant.userId, action: 'TOPIC_ACTIVITY_REWARD', points: grant.points, before: user.points, after, activityId: grant.activityId, businessKey: grant.grantKey, reason: `话题活动「${grant.Activity.title}」奖励` } })
      }
    } else if (grant.kind === 'BADGE' && grant.badgeId) {
      const result = await grantBadgeWithTransaction(tx, {
        userId: grant.userId,
        badgeId: grant.badgeId,
        sourceType: 'TOPIC_ACTIVITY_REWARD',
        sourceId: grant.activityId,
        grantKey: grant.grantKey,
        grantReason: `话题活动「${grant.Activity.title}」奖励`,
        obtainedAt: now,
      })
      grantedBadgeEffect = { userId: grant.userId, badgeId: grant.badgeId, recordId: result.recordId, created: result.created }
    } else {
      throw new Error('TOPIC_REWARD_ITEM_INVALID')
    }
    await tx.topicActivityRewardGrant.update({ where: { id: grant.id }, data: { status: 'GRANTED', grantedAt: now, errorMessage: null } })
    await refreshParticipationRewardStatus(tx, grant.participationId, now)
    return grantedBadgeEffect
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message.slice(0, 500) : '奖励发放失败'
    await prisma.$transaction(async (tx) => {
      await tx.topicActivityRewardGrant.updateMany({ where: { id: rewardId, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } }, data: { status: 'FAILED', errorMessage: message } })
      const row = await tx.topicActivityRewardGrant.findUnique({ where: { id: rewardId }, select: { participationId: true } })
      if (row) await refreshParticipationRewardStatus(tx, row.participationId, now)
    })
    console.error('[topic-activity.reward.failed]', { rewardId, message })
    return null
  })
  if (badgeEffect?.created) {
    try {
      const { processBadgeGrantEffects } = await import('@/lib/badge-phase3')
      await processBadgeGrantEffects({ userId: badgeEffect.userId, grants: [{ badgeId: badgeEffect.badgeId, recordId: badgeEffect.recordId }] })
    } catch (error) {
      console.error('[topic-activity.reward.badge-effects]', { rewardId, error })
    }
  }
}

export async function grantTopicActivityRewardItems(rewardIds: readonly string[], now = new Date()) {
  for (const rewardId of [...new Set(rewardIds)]) await grantTopicActivityRewardItem(rewardId, now)
}

async function notifyCompletedTopicActivityRewards(participationIds: readonly string[]) {
  const ids = [...new Set(participationIds)]
  if (!ids.length) return
  const participations = await prisma.topicActivityParticipation.findMany({
    where: { id: { in: ids }, rewardStatus: 'GRANTED' },
    select: {
      id: true,
      userId: true,
      activityId: true,
      Activity: { select: { title: true } },
      RewardGrants: {
        where: { status: 'GRANTED' },
        select: { kind: true, points: true, Badge: { select: { name: true } } },
      },
    },
  })
  for (const participation of participations) {
    const items = participation.RewardGrants.map((grant) => grant.kind === 'POINTS' && grant.points
      ? `${grant.points} 挂号费`
      : grant.Badge?.name ? `「${grant.Badge.name}」勋章` : null).filter((item): item is string => Boolean(item))
    if (!items.length) continue
    await safeNotificationWrite(() => createManyNotifications({
      data: [{
        recipientId: participation.userId,
        type: 'ACTIVITY',
        title: '话题活动奖励已发放',
        content: `你参与「${participation.Activity.title}」获得：${items.join('、')}。`,
        link: `/activities/${participation.activityId}`,
        activityId: participation.activityId,
        key: `topic-activity-reward:${participation.id}`,
      }],
      skipDuplicates: true,
    }), { operation: 'topic-activity-reward-notification', userId: participation.userId, targetId: participation.activityId, notificationType: 'ACTIVITY' })
  }
}

export async function dispatchDueTopicActivityRewards(input: { now?: Date; batchSize?: number } = {}) {
  const now = input.now || new Date()
  const batchSize = Math.min(Math.max(Math.trunc(input.batchSize || 100), 1), 500)
  const rows = await prisma.topicActivityRewardGrant.findMany({
    where: {
      status: { in: ACTIVE_REWARD_ITEM_STATUSES },
      Participation: { approvedSubmissionCount: { gt: 0 } },
      Activity: {
        status: { not: 'CANCELLED' },
        OR: [
          { rewardGrantMode: 'IMMEDIATE' },
          { rewardGrantMode: 'SCHEDULED', rewardGrantAt: { lte: now } },
        ],
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    select: { id: true, participationId: true },
  })
  await grantTopicActivityRewardItems(rows.map((row) => row.id), now)
  await notifyCompletedTopicActivityRewards(rows.map((row) => row.participationId))
  return { processed: rows.length }
}

export async function expireTopicActivityPins(now = new Date()) {
  const result = await prisma.post.updateMany({
    where: {
      activityPinned: true,
      TopicActivity: {
        is: {
          OR: [
            { status: { not: 'PUBLISHED' } },
            { pinToPlaza: false },
            { endsAt: { lt: now } },
          ],
        },
      },
    },
    data: { activityPinned: false },
  })
  return { unpinned: result.count }
}

export function isTopicSubmissionStatus(value: unknown): value is TopicActivitySubmissionStatus {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED' || value === 'WITHDRAWN'
}
