import type { PrismaClient } from '@prisma/client'

export type CommentLikeResult = { isLiked: boolean; likeCount: number }

// focus 评论可见性：评论未删除、所属每日留言已通过审核、作者账号正常。
// 与 lib/notifications.ts 里 canViewDailyNotificationMessage 的判定保持一致。
// 注意：可见性针对「focus 评论本身」，不是 focus 评论的 parentId（被回复的原评论）。
type VisibleCommentShape = {
  isDeleted: boolean
  DailyMessage: {
    isDeleted: boolean
    moderationStatus: string
    User: { isDeleted: boolean; status: string }
  } | null
}

export function isDailyMessageCommentVisible(comment: VisibleCommentShape): boolean {
  const message = comment.DailyMessage
  return (
    message !== null
    && !comment.isDeleted
    && !message.isDeleted
    && !message.User.isDeleted
    && message.User.status === 'ACTIVE'
    && (message.moderationStatus === 'APPROVED' || message.moderationStatus === 'VIOLATION')
  )
}

// 评论点赞的幂等切换：点赞目标必须是对方回复的那条评论（focus 评论 / commentId 本身），
// 绝不可以是其 parentId（被回复的原评论）。评论不存在或不可访问时返回 null（路由据此回 404）。
export async function toggleDailyMessageCommentLike(
  prisma: PrismaClient,
  commentId: string,
  userId: string,
): Promise<CommentLikeResult | null> {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.dailyMessageComment.findFirst({
      where: { id: commentId, isDeleted: false },
      select: {
        id: true,
        isDeleted: true,
        DailyMessage: {
          select: { isDeleted: true, moderationStatus: true, User: { select: { status: true, isDeleted: true } } },
        },
      },
    })
    if (!comment || !isDailyMessageCommentVisible({ isDeleted: comment.isDeleted, DailyMessage: comment.DailyMessage })) {
      return null
    }
    const existing = await tx.dailyMessageCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    })
    if (existing) {
      await tx.dailyMessageCommentLike.delete({ where: { id: existing.id } })
    } else {
      await tx.dailyMessageCommentLike.create({ data: { commentId, userId } })
    }
    const likeCount = await tx.dailyMessageCommentLike.count({ where: { commentId } })
    return { isLiked: !existing, likeCount }
  }, { timeout: 15_000, maxWait: 5_000 })
}

// 取消点赞（DELETE 语义）：移除当前用户对 focus 评论的点赞，返回最新状态；
// 评论不存在或不可访问时返回 null。
export async function removeDailyMessageCommentLike(
  prisma: PrismaClient,
  commentId: string,
  userId: string,
): Promise<CommentLikeResult | null> {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.dailyMessageComment.findFirst({
      where: { id: commentId, isDeleted: false },
      select: {
        id: true,
        isDeleted: true,
        DailyMessage: {
          select: { isDeleted: true, moderationStatus: true, User: { select: { status: true, isDeleted: true } } },
        },
      },
    })
    if (!comment || !isDailyMessageCommentVisible({ isDeleted: comment.isDeleted, DailyMessage: comment.DailyMessage })) {
      return null
    }
    await tx.dailyMessageCommentLike.deleteMany({ where: { commentId, userId } })
    const likeCount = await tx.dailyMessageCommentLike.count({ where: { commentId } })
    return { isLiked: false, likeCount }
  }, { timeout: 15_000, maxWait: 5_000 })
}
