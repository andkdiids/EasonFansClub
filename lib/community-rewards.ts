import type { Prisma } from '@prisma/client'
import { getShanghaiDateKey, parseBeijingDate } from '@/lib/checkin'
import { awardExperience, EXPERIENCE_REWARD_SOURCES } from '@/lib/growth'
import { awardRegistrationFee, reverseRegistrationFee } from '@/lib/registration-fee'

export const COMMUNITY_REWARD_POINTS = {
  postCommentReceived: 1,
  commentPost: 2,
  featuredPost: 27,
  featuredPostExperience: 27,
} as const

export const COMMUNITY_REWARD_LIMITS = {
  postCommentReceivedDaily: 10,
  commentPostDaily: 10,
  featuredPostDaily: 1,
} as const

const shanghaiWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
})

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** Return the Monday date key for the natural week in Asia/Shanghai. */
export function getShanghaiWeekKey(date = new Date()) {
  const dateKey = getShanghaiDateKey(date)
  const localStart = parseBeijingDate(dateKey)
  if (!localStart) return dateKey

  const weekday = weekdayIndex[shanghaiWeekdayFormatter.format(date)] ?? 1
  const daysFromMonday = (weekday + 6) % 7
  return getShanghaiDateKey(new Date(localStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000))
}

type CommunityRewardTransaction = Prisma.TransactionClient

async function lockUsers(tx: CommunityRewardTransaction, userIds: string[]) {
  for (const userId of [...new Set(userIds)].sort()) {
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`
  }
}

async function getPositiveRewardTotal(
  tx: CommunityRewardTransaction,
  input: { userId: string; action: 'POST_COMMENT_RECEIVED' | 'COMMENT_POST' | 'FEATURED_POST'; dateKey?: string },
) {
  const result = await tx.pointLog.aggregate({
    where: {
      userId: input.userId,
      action: input.action,
      points: { gt: 0 },
      ...(input.dateKey ? { dateKey: input.dateKey } : {}),
    },
    _sum: { points: true },
  })
  return result._sum.points || 0
}

type CommentRewardInput = {
  commentId: string
  postId: string
  commenterId: string
  postAuthorId: string
  now?: Date
}

export async function awardCommunityCommentRewards(
  tx: CommunityRewardTransaction,
  input: CommentRewardInput,
) {
  const now = input.now || new Date()
  const dateKey = getShanghaiDateKey(now)
  const weekKey = getShanghaiWeekKey(now)

  await lockUsers(tx, [input.commenterId, input.postAuthorId])

  // A post author may reply to their own post, but it is not a rewardable
  // cross-user interaction and must not consume either interaction quota.
  if (input.commenterId === input.postAuthorId) {
    return { commenterRewardPoints: 0, postAuthorRewardPoints: 0, weekKey, dateKey }
  }

  const authorRewardTotal = await getPositiveRewardTotal(tx, {
    userId: input.postAuthorId,
    action: 'POST_COMMENT_RECEIVED',
    dateKey,
  })
  const authorReward = authorRewardTotal < COMMUNITY_REWARD_LIMITS.postCommentReceivedDaily
    ? await awardRegistrationFee(tx, {
      userId: input.postAuthorId,
      requestedAmount: COMMUNITY_REWARD_POINTS.postCommentReceived,
      action: 'POST_COMMENT_RECEIVED',
      reason: '帖子收到有效评论',
      businessKey: `community:post-comment-received:${input.commentId}`,
      postId: input.postId,
      replyId: input.commentId,
      now,
    })
    : null

  const commenterRewardTotal = await getPositiveRewardTotal(tx, {
    userId: input.commenterId,
    action: 'COMMENT_POST',
    dateKey,
  })
  const commenterReward = commenterRewardTotal < COMMUNITY_REWARD_LIMITS.commentPostDaily
    ? await awardRegistrationFee(tx, {
      userId: input.commenterId,
      requestedAmount: COMMUNITY_REWARD_POINTS.commentPost,
      action: 'COMMENT_POST',
      reason: '评论他人帖子',
      businessKey: `community:comment-post:${input.commenterId}:${input.postId}:${weekKey}`,
      postId: input.postId,
      replyId: input.commentId,
      now,
    })
    : null

  return {
    commenterRewardPoints: commenterReward?.awardedAmount || 0,
    postAuthorRewardPoints: authorReward?.awardedAmount || 0,
    weekKey,
    dateKey,
  }
}

type CommentRewardReversalInput = {
  commentId: string
  postId: string
  commenterId: string
  postAuthorId: string
  now?: Date
}

export async function reverseCommunityCommentRewards(
  tx: CommunityRewardTransaction,
  input: CommentRewardReversalInput,
) {
  const now = input.now || new Date()
  const weekKey = getShanghaiWeekKey(now)
  const dateKey = getShanghaiDateKey(now)

  await lockUsers(tx, [input.commenterId, input.postAuthorId])

  if (input.commenterId === input.postAuthorId) {
    return { commenterReversedPoints: 0, postAuthorReversedPoints: 0, weekKey, dateKey }
  }

  // Look up the original weekly record by the comment id instead of
  // recalculating the week from deletion time. A violation may be discovered
  // in a later week, while the original week must remain consumed.
  const [commenterReward, postAuthorReward] = await Promise.all([
    tx.pointLog.findFirst({
      where: {
        userId: input.commenterId,
        postId: input.postId,
        replyId: input.commentId,
        action: 'COMMENT_POST',
        points: { gt: 0 },
      },
      select: { points: true },
    }),
    tx.pointLog.findUnique({
      where: { businessKey: `community:post-comment-received:${input.commentId}` },
      select: { points: true },
    }),
  ])

  let commenterReversedPoints = 0
  let postAuthorReversedPoints = 0
  if (commenterReward && commenterReward.points > 0) {
    const reversal = await reverseRegistrationFee(tx, {
      userId: input.commenterId,
      amount: commenterReward.points,
      reason: '违规评论奖励追回（评论者）',
      businessKey: `community:comment-revoke:commenter:${input.commentId}`,
      postId: input.postId,
      replyId: input.commentId,
      now,
    })
    commenterReversedPoints = reversal.reversedAmount
  }
  if (postAuthorReward && postAuthorReward.points > 0) {
    const reversal = await reverseRegistrationFee(tx, {
      userId: input.postAuthorId,
      amount: postAuthorReward.points,
      reason: '违规评论奖励追回（帖子作者）',
      businessKey: `community:comment-revoke:author:${input.commentId}`,
      postId: input.postId,
      replyId: input.commentId,
      now,
    })
    postAuthorReversedPoints = reversal.reversedAmount
  }

  return { commenterReversedPoints, postAuthorReversedPoints, weekKey, dateKey }
}

type FeaturedPostRewardInput = {
  postId: string
  authorId: string
  now?: Date
}

export async function awardFeaturedPostRewards(
  tx: CommunityRewardTransaction,
  input: FeaturedPostRewardInput,
) {
  const now = input.now || new Date()
  const dateKey = getShanghaiDateKey(now)
  await lockUsers(tx, [input.authorId])

  const existingReward = await tx.pointLog.findUnique({
    where: { businessKey: `community:featured-post:${input.postId}` },
    select: { id: true },
  })
  if (existingReward) return { registrationFee: 0, experience: 0, dateKey, duplicate: true }

  // PointLog is the registration-fee ledger and ExperienceLog is the EXP
  // ledger. Either record means this post has already consumed its one-time
  // featured reward. The check protects against duplicate requests even if a
  // legacy deployment contains only one side of an otherwise atomic reward.
  const existingExperienceReward = await tx.experienceLog.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: EXPERIENCE_REWARD_SOURCES.FEATURED_POST,
        sourceId: input.postId,
      },
    },
    select: { id: true },
  })
  if (existingExperienceReward) return { registrationFee: 0, experience: 0, dateKey, duplicate: true }

  const rewardedToday = await tx.pointLog.count({
    where: {
      userId: input.authorId,
      action: 'FEATURED_POST',
      points: { gt: 0 },
      dateKey,
    },
  })
  if (rewardedToday >= COMMUNITY_REWARD_LIMITS.featuredPostDaily) {
    return { registrationFee: 0, experience: 0, dateKey, duplicate: false }
  }

  const feeAward = await awardRegistrationFee(tx, {
    userId: input.authorId,
    requestedAmount: COMMUNITY_REWARD_POINTS.featuredPost,
    action: 'FEATURED_POST',
    reason: '帖子被设为精华',
    businessKey: `community:featured-post:${input.postId}`,
    postId: input.postId,
    now,
  })
  if (!feeAward.awardedAmount) return { registrationFee: 0, experience: 0, dateKey, duplicate: feeAward.duplicate }

  const experienceAward = await awardExperience(tx, {
    userId: input.authorId,
    amount: COMMUNITY_REWARD_POINTS.featuredPostExperience,
    type: 'ACTIVITY',
    description: '帖子被设为精华',
    sourceType: EXPERIENCE_REWARD_SOURCES.FEATURED_POST,
    sourceId: input.postId,
    now,
  })

  return {
    registrationFee: feeAward.awardedAmount,
    experience: experienceAward.amount,
    dateKey,
    duplicate: false,
  }
}
