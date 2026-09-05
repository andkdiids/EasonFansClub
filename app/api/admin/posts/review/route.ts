import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { withForumBoardDisplayName } from '@/lib/boards'
import { adminAuditOperations, createAdminActionAudit, createPostModerationHistory, userSnapshotName } from '@/lib/admin-audit'
import { profileImageUrl, publicImageUrl } from '@/lib/images'
import { buildPostReviewUpdate, canTransitionPostModerationStatus, isPostModerationStatus, POST_REVIEW_PAGE_SIZE, type PostModerationStatus, type PostReviewableStatus } from '@/lib/post-moderation'
import { describePostModerationHistoryError, loadPostModerationHistoryByPostIds, type PostModerationHistoryRow } from '@/lib/post-moderation-history'
import { postContentPlainText } from '@/lib/share-metadata'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { createNotification } from '@/lib/notification-write'
import { HOME_FEATURED_POSTS_CACHE_TAG } from '@/lib/home-data'

export const dynamic = 'force-dynamic'

const reviewSelect = {
  id: true,
  title: true,
  content: true,
  richContent: true,
  summary: true,
  createdAt: true,
  moderationStatus: true,
  reviewedAt: true,
  rejectionReason: true,
  isPinned: true,
  isFeatured: true,
  User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
  ReviewedBy: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
  Board: { select: { name: true, slug: true } },
  PostMedia: { where: { type: 'IMAGE' as const }, orderBy: { sortOrder: 'asc' as const }, select: { id: true, type: true, url: true, thumbnail: true } },
} as const

type ReviewPostRow = Prisma.PostGetPayload<{ select: typeof reviewSelect }>

type ReviewStatus = 'APPROVED' | 'REJECTED'
type ReviewAction = 'APPROVE_POST' | 'REJECT_POST'

function safeReviewErrorMeta(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 20)
  return Object.fromEntries(entries.map(([key, item]) => {
    if (/authorization|cookie|database|password|secret|token|url/i.test(key)) return [key, '[redacted]']
    if (typeof item === 'string') return [key, item.slice(0, 500)]
    return [key, item]
  }))
}

function describeReviewError(error: unknown) {
  const details = describePostModerationHistoryError(error)
  const rawMeta = (error as { meta?: unknown } | null)?.meta
  return {
    errorName: details.name || (error instanceof Error ? error.constructor.name : 'UnknownError'),
    errorCode: details.code || details.metaCode,
    message: details.message,
    meta: safeReviewErrorMeta(rawMeta),
  }
}

function logReviewError(scope: string, postId: string, action: ReviewAction, error: unknown) {
  console.error(`[admin.posts.review.${scope}]`, {
    postId,
    action,
    ...describeReviewError(error),
  })
}

async function writeReviewAudit(input: {
  operatorId: string
  postId: string
  action: ReviewAction
  status: ReviewStatus
  title: string
  authorId: string
  authorName: string
  authorUid: number
  previousStatus: PostReviewableStatus
  rejectionReason: string | null
}) {
  const operationType = input.status === 'APPROVED'
    ? adminAuditOperations.POST_REVIEW_APPROVED
    : adminAuditOperations.POST_REVIEW_REJECTED
  const metadata = {
    fromStatus: input.previousStatus,
    toStatus: input.status,
    moderationStatus: input.status,
    rejectionReason: input.rejectionReason,
  }

  try {
    // Prefer the snapshot-rich audit row when the matching schema is present.
    await createAdminActionAudit(prisma, {
      operatorId: input.operatorId,
      action: input.action,
      operationType,
      targetType: 'POST',
      targetId: input.postId,
      targetTitle: input.title,
      targetUserId: input.authorId,
      targetUserName: input.authorName,
      targetUserUid: input.authorUid,
      reason: input.rejectionReason,
      metadata,
    })
    return
  } catch (error) {
    // The audit schema was extended without a migration in older production
    // databases. Fall back to the original columns so the audit trail remains
    // append-only without allowing it to roll back the moderation decision.
    logReviewError('audit', input.postId, input.action, error)
  }

  try {
    await prisma.adminAction.create({
      data: {
        adminId: input.operatorId,
        postId: input.postId,
        action: input.action,
        reason: input.rejectionReason,
        metadata: { ...metadata, operationType, targetType: 'POST', targetTitle: input.title, targetUserId: input.authorId, targetUserName: input.authorName, targetUserUid: input.authorUid },
      },
    })
  } catch (error) {
    logReviewError('audit-fallback', input.postId, input.action, error)
  }
}

async function writeReviewHistory(input: {
  postId: string
  actorId: string
  action: 'REVIEW_APPROVED' | 'REVIEW_REJECTED'
  status: ReviewStatus
  titleSnapshot: string
  rejectionReason: string | null
}, reviewAction: ReviewAction) {
  try {
    await createPostModerationHistory(prisma, input)
  } catch (error) {
    logReviewError('history', input.postId, reviewAction, error)
  }
}

async function writeReviewNotification(input: {
  postId: string
  action: ReviewAction
  status: ReviewStatus
  authorId: string
  operatorId: string
  title: string
  rejectionReason: string | null
  reviewedAt: Date
  notificationKey?: string
}) {
  try {
    await prisma.notification.updateMany({
      where: {
        OR: [
          { type: 'REVIEW' },
          { type: 'ADMIN' },
        ],
        readAt: null,
        key: { startsWith: `post-review:${input.postId}` },
      },
      data: { isRead: true, readAt: input.reviewedAt },
    })
  } catch (error) {
    // Marking the administrator's queue notification read is optional.
    logReviewError('notification-read', input.postId, input.action, error)
  }

  try {
    await createNotification({
      data: {
        recipientId: input.authorId,
        actorId: input.operatorId,
        type: 'ADMIN',
        key: input.notificationKey || `post-review-result:${input.postId}:${input.status}:${input.reviewedAt.getTime()}`,
        title: input.status === 'APPROVED' ? '帖子审核通过' : '帖子未通过审核',
        content: input.status === 'APPROVED'
          ? `你发布的帖子《${input.title}》已通过审核，现在可以在 E院广场查看。`
          : input.rejectionReason
            ? `你发布的帖子《${input.title}》未通过审核。原因：${input.rejectionReason}`
            : `你发布的帖子《${input.title}》未通过审核，请修改后重新提交。`,
        link: `/posts/${input.postId}`,
      },
    })
    return true
  } catch (error) {
    // Notification failure must not undo a committed moderation decision.
    logReviewError('notification-create', input.postId, input.action, error)
    return false
  }
}

async function refreshReviewBoardCount(boardId: string, postId: string, action: ReviewAction) {
  try {
    const postCount = await prisma.post.count({
      where: { boardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
    })
    await prisma.board.update({ where: { id: boardId }, data: { postCount } })
  } catch (error) {
    logReviewError('board-count', postId, action, error)
  }
}

async function writeApprovalFriendActivity(input: { postId: string; authorId: string; title: string; action: ReviewAction }) {
  try {
    const targetUrl = `/posts/${input.postId}`
    // This activity is a derived public feed entry. Re-approval must not
    // create a second entry for the same post.
    await prisma.friendActivity.deleteMany({ where: { type: 'POST', targetUrl } })
    await prisma.friendActivity.create({
      data: { actorId: input.authorId, type: 'POST', content: input.title, targetUrl },
    })
  } catch (error) {
    logReviewError('friend-activity', input.postId, input.action, error)
  }
}

async function clearApprovalFriendActivity(input: { postId: string; action: ReviewAction }) {
  try {
    await prisma.friendActivity.deleteMany({ where: { type: 'POST', targetUrl: `/posts/${input.postId}` } })
  } catch (error) {
    logReviewError('friend-activity-cleanup', input.postId, input.action, error)
  }
}

function serializePost(post: ReviewPostRow, history: PostModerationHistoryRow[]) {
  const { richContent, ...postWithoutRichContent } = post
  return {
    ...postWithoutRichContent,
    Board: withForumBoardDisplayName(post.Board),
    content: postContentPlainText(post.content, richContent),
    summary: post.summary ? postContentPlainText(post.summary) : post.summary,
    createdAt: post.createdAt.toISOString(),
    reviewedAt: post.reviewedAt?.toISOString() || null,
    User: { ...post.User, Profile: post.User.Profile ? { ...post.User.Profile, avatarUrl: profileImageUrl(post.User.Profile.avatarUrl) } : null },
    ReviewedBy: post.ReviewedBy
      ? { id: post.ReviewedBy.id, uid: post.ReviewedBy.uid, name: userSnapshotName(post.ReviewedBy) }
      : null,
    PostModerationHistory: history.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    PostMedia: post.PostMedia.map((media) => ({ ...media, url: publicImageUrl(media.url), thumbnail: publicImageUrl(media.thumbnail) })),
  }
}

export async function GET(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const rawStatus = new URL(request.url).searchParams.get('status')
  const status: PostModerationStatus | 'ALL' = rawStatus === 'ALL'
    ? 'ALL'
    : isPostModerationStatus(rawStatus) ? rawStatus : 'PENDING'
  const rawPage = Number(new URL(request.url).searchParams.get('page') || '1')
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  try {
    const pageRows = await prisma.post.findMany({
      where: status === 'ALL' ? { isDeleted: false } : { moderationStatus: status, isDeleted: false },
      orderBy: status === 'PENDING' || status === 'ALL'
        ? [{ createdAt: 'desc' as const }]
        : [{ reviewedAt: 'desc' as const }, { createdAt: 'desc' as const }],
      skip: (page - 1) * POST_REVIEW_PAGE_SIZE,
      take: POST_REVIEW_PAGE_SIZE + 1,
      select: reviewSelect,
    })
    const hasMore = pageRows.length > POST_REVIEW_PAGE_SIZE
    const posts = pageRows.slice(0, POST_REVIEW_PAGE_SIZE)
    const historyByPostId = await loadPostModerationHistoryByPostIds(posts.map((post) => post.id), 'admin.posts.review.list')
    return NextResponse.json({
      posts: posts.map((post) => serializePost(post, historyByPostId.get(post.id) || [])),
      status,
      page,
      hasMore,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.posts.review.list]', { status, page, error: describePostModerationHistoryError(error) })
    return NextResponse.json({ message: '审核列表暂时无法加载，请稍后重试', status, page }, { status: 503 })
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const requestedStatus = body?.status
  if (requestedStatus !== 'APPROVED' && requestedStatus !== 'REJECTED') {
    return NextResponse.json({ message: '璇烽€夋嫨閫氳繃鎴栨嫆缁濓紒' }, { status: 400 })
  }
  const status: ReviewStatus = requestedStatus
  const action: ReviewAction = status === 'APPROVED' ? 'APPROVE_POST' : 'REJECT_POST'
  const postId = sanitizeText(body?.postId, 80)
  if (!postId) return NextResponse.json({ message: '甯栧瓙 ID 鏃犳晥' }, { status: 400 })
  const rejectionReason = status === 'REJECTED'
    ? (typeof body?.rejectionReason === 'string' ? body.rejectionReason.trim() : '')
    : null
  if (status === 'REJECTED' && !rejectionReason) {
    return NextResponse.json({ message: '拒绝帖子时必须填写拒绝理由' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const reviewedAt = new Date()
      // Serialize concurrent reviews of the same Post row before reading its state.
      await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
      const current = await tx.post.findFirst({
        where: { id: postId, isDeleted: false },
        select: {
          id: true,
          authorId: true,
          boardId: true,
          title: true,
          moderationStatus: true,
          reviewedAt: true,
          rejectionReason: true,
          User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
        },
      })
      if (!current) throw new Error('POST_NOT_FOUND')
      if (!canTransitionPostModerationStatus(current.moderationStatus, status)) throw new Error('POST_REVIEW_STATUS_UNSUPPORTED')

      // Retrying the same request after the first commit is a safe no-op. The
      // existing review timestamp keeps the author notification key stable,
      // so a notification retry cannot create a duplicate row.
      if (current.moderationStatus === status) {
        return {
          changed: false,
          post: {
            id: current.id,
            moderationStatus: current.moderationStatus,
            reviewedAt: current.reviewedAt,
            rejectionReason: current.rejectionReason,
          },
          previousStatus: current.moderationStatus,
          reviewedAt: current.reviewedAt || reviewedAt,
          notificationKey: current.reviewedAt ? undefined : `post-review-result:${postId}:${current.moderationStatus}:legacy`,
          current,
        }
      }

      const updateResult = await tx.post.updateMany({
        where: { id: postId, isDeleted: false, moderationStatus: current.moderationStatus },
        data: buildPostReviewUpdate({ status, reviewedAt, reviewedById: guard.user.id, rejectionReason }),
      })
      if (updateResult.count !== 1) throw new Error('POST_ALREADY_REVIEWED')
      const updated = await tx.post.findUniqueOrThrow({
        where: { id: postId },
        select: { id: true, moderationStatus: true, reviewedAt: true, rejectionReason: true },
      })
      return {
        changed: true,
        post: updated,
        previousStatus: current.moderationStatus,
        reviewedAt,
        current,
      }
    })
    const current = result.current
    const reviewStatus = result.post.moderationStatus as ReviewStatus
    if (!result.changed) {
      await writeReviewNotification({
        postId,
        action,
        status: reviewStatus,
        authorId: current.authorId,
        operatorId: guard.user.id,
        title: current.title,
        rejectionReason: result.post.rejectionReason,
        reviewedAt: result.reviewedAt,
        notificationKey: result.notificationKey,
      })
      return NextResponse.json({ post: result.post, previousStatus: result.previousStatus, changed: false })
    }
    await writeReviewAudit({
      operatorId: guard.user.id,
      postId,
      action,
      status: reviewStatus,
      title: current.title,
      authorId: current.authorId,
      authorName: current.User.nickname || 'E院用户',
      authorUid: current.User.uid,
      previousStatus: result.previousStatus,
      rejectionReason: result.post.rejectionReason,
    })
    await writeReviewHistory({
      postId,
      actorId: guard.user.id,
      action: reviewStatus === 'APPROVED' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
      status: reviewStatus,
      titleSnapshot: current.title,
      rejectionReason: result.post.rejectionReason,
    }, action)
    await writeReviewNotification({
      postId,
      action,
      status: reviewStatus,
      authorId: current.authorId,
      operatorId: guard.user.id,
      title: current.title,
      rejectionReason: result.post.rejectionReason,
      reviewedAt: result.reviewedAt,
    })
    await refreshReviewBoardCount(current.boardId, postId, action)
    if (reviewStatus === 'APPROVED') {
      await writeApprovalFriendActivity({ postId, authorId: current.authorId, title: current.title, action })
      // Re-approval must not re-run one-time approval side effects. The badge
      // grant itself is idempotent, while the first pending review remains the
      // existing trigger point for this evaluation.
      if (String(result.previousStatus) === 'PENDING') triggerBadgeEvaluation(current.authorId, 'POST_APPROVED', postId)
    } else {
      await clearApprovalFriendActivity({ postId, action })
    }

    try {
      emitRealtimeMany([guard.user.id, current.authorId], 'notification')
    } catch (error) {
      logReviewError('realtime', postId, action, error)
    }
    try {
      revalidatePath('/community')
      revalidatePath('/forum')
      revalidatePath('/trending')
      revalidatePath('/rankings')
      revalidatePath('/search')
      revalidatePath('/profile')
      revalidatePath('/admin/posts/review')
      revalidatePath('/user/[uid]', 'page')
      revalidatePath(`/posts/${postId}`)
      revalidateTag('trending-posts')
      revalidateTag(HOME_FEATURED_POSTS_CACHE_TAG)
    } catch (error) {
      logReviewError('cache', postId, action, error)
    }
    return NextResponse.json({ post: result.post, previousStatus: result.previousStatus })
  } catch (error) {
    logReviewError('core', postId, action, error)
    if (error instanceof Error && error.message === 'POST_ALREADY_REVIEWED') {
      return NextResponse.json({ message: '该帖子已被其他管理员审核，请刷新后查看最新状态' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'POST_REVIEW_STATUS_UNSUPPORTED') {
      return NextResponse.json({ message: '该帖子当前状态不支持普通审核操作，请刷新后重试' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'POST_NOT_FOUND') {
      return NextResponse.json({ message: '帖子不存在或已删除' }, { status: 404 })
    }
    return NextResponse.json({ message: '审核失败，请稍后重试' }, { status: 500 })
  }
}
