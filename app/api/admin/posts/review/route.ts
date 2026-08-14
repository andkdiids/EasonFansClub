import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit, createPostModerationHistory, userSnapshotName } from '@/lib/admin-audit'
import { publicContentImageMarkers } from '@/lib/content-images'
import { profileImageUrl, publicImageUrl } from '@/lib/images'
import { buildPostReviewUpdate, isPostModerationStatus } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const reviewSelect = {
  id: true,
  title: true,
  content: true,
  summary: true,
  createdAt: true,
  moderationStatus: true,
  reviewedAt: true,
  rejectionReason: true,
  isPinned: true,
  isFeatured: true,
  User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
  ReviewedBy: { select: { id: true, uid: true, username: true, nickname: true, Profile: { select: { displayName: true } } } },
  PostModerationHistory: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, actorName: true, actorUsername: true, actorUid: true, action: true, status: true, titleSnapshot: true, rejectionReason: true, createdAt: true },
  },
  Board: { select: { name: true, slug: true } },
  PostMedia: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, type: true, url: true, thumbnail: true } },
} as const

type ReviewPostRow = Prisma.PostGetPayload<{ select: typeof reviewSelect }>

function serializePost(post: ReviewPostRow) {
  return {
    ...post,
    content: publicContentImageMarkers(post.content),
    summary: post.summary ? publicContentImageMarkers(post.summary) : post.summary,
    createdAt: post.createdAt.toISOString(),
    reviewedAt: post.reviewedAt?.toISOString() || null,
    User: { ...post.User, Profile: post.User.Profile ? { ...post.User.Profile, avatarUrl: profileImageUrl(post.User.Profile.avatarUrl) } : null },
    ReviewedBy: post.ReviewedBy
      ? { id: post.ReviewedBy.id, uid: post.ReviewedBy.uid, username: post.ReviewedBy.username, name: userSnapshotName(post.ReviewedBy) }
      : null,
    PostModerationHistory: post.PostModerationHistory.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    PostMedia: post.PostMedia.map((media) => ({ ...media, url: publicImageUrl(media.url), thumbnail: publicImageUrl(media.thumbnail) })),
  }
}

export async function GET(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const rawStatus = new URL(request.url).searchParams.get('status')
  const status = isPostModerationStatus(rawStatus) ? rawStatus : 'PENDING'
  const posts = await prisma.post.findMany({
    where: { moderationStatus: status, isDeleted: false },
    orderBy: status === 'PENDING'
      ? [{ createdAt: 'desc' as const }]
      : [{ reviewedAt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 200,
    select: reviewSelect,
  })
  return NextResponse.json({ posts: posts.map(serializePost), status }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const status = body?.status
  if (status !== 'APPROVED' && status !== 'REJECTED') {
    return NextResponse.json({ message: '璇烽€夋嫨閫氳繃鎴栨嫆缁濓紒' }, { status: 400 })
  }
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
          User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
        },
      })
      if (!current) throw new Error('POST_NOT_FOUND')
      if (String(current.moderationStatus) !== 'PENDING') throw new Error('POST_ALREADY_REVIEWED')

      const updateResult = await tx.post.updateMany({
        where: { id: postId, isDeleted: false, moderationStatus: 'PENDING' },
        data: buildPostReviewUpdate({ status, reviewedAt, reviewedById: guard.user.id, rejectionReason }),
      })
      if (updateResult.count !== 1) throw new Error('POST_ALREADY_REVIEWED')
      const updated = await tx.post.findUniqueOrThrow({
        where: { id: postId },
        select: { id: true, moderationStatus: true, reviewedAt: true, rejectionReason: true },
      })
      const action = status === 'APPROVED' ? 'APPROVE_POST' : 'REJECT_POST'
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action,
        operationType: status === 'APPROVED' ? adminAuditOperations.POST_REVIEW_APPROVED : adminAuditOperations.POST_REVIEW_REJECTED,
        targetType: 'POST',
        targetId: current.id,
        targetTitle: current.title,
        targetUserId: current.authorId,
        targetUserName: current.User.Profile?.displayName || current.User.nickname,
        targetUserUid: current.User.uid,
        reason: updated.rejectionReason,
        metadata: { moderationStatus: updated.moderationStatus, rejectionReason: updated.rejectionReason },
      })
      await createPostModerationHistory(tx, {
        postId: current.id,
        actorId: guard.user.id,
        action: status === 'APPROVED' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
        status: updated.moderationStatus,
        titleSnapshot: current.title,
        rejectionReason: updated.rejectionReason,
      })
      const statusChanged = current.moderationStatus !== updated.moderationStatus
      if (statusChanged) {
        await tx.notification.updateMany({
          where: {
            type: 'ADMIN',
            isRead: false,
            key: { startsWith: `post-review:${current.id}` },
          },
          data: { isRead: true, readAt: reviewedAt },
        })
        const postCount = await tx.post.count({
          where: { boardId: current.boardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
        })
        await tx.board.update({ where: { id: current.boardId }, data: { postCount } })
        // 仅在状态实际变化时通知作者（同事务保证不丢失；APPROVED→APPROVED / REJECTED→REJECTED 不重复通知）。
        await tx.notification.create({
          data: {
            recipientId: current.authorId,
            actorId: guard.user.id,
            type: 'ADMIN',
            title: updated.moderationStatus === 'APPROVED' ? '帖子审核通过' : '帖子未通过审核',
            content: updated.moderationStatus === 'APPROVED'
              ? `你发布的帖子《${current.title}》已通过审核，现在可以在 E院广场查看。`
              : updated.rejectionReason
                ? `你发布的帖子《${current.title}》未通过审核。原因：${updated.rejectionReason}`
                : `你发布的帖子《${current.title}》未通过审核，请修改后重新提交。`,
            link: `/posts/${current.id}`,
          },
        })
      }
      if (updated.moderationStatus === 'APPROVED' && current.moderationStatus !== 'APPROVED') {
        await tx.friendActivity.create({ data: { actorId: current.authorId, type: 'POST', content: current.title, targetUrl: `/posts/${current.id}` } })
      }
      return {
        post: updated,
        previousStatus: current.moderationStatus,
        notificationRecipientIds: statusChanged ? [guard.user.id, current.authorId] : [],
      }
    })
    const post = result.post
    emitRealtimeMany(result.notificationRecipientIds, 'notification')
    revalidatePath('/community')
    revalidatePath('/forum')
    revalidatePath('/admin/posts/review')
    revalidatePath('/user/[uid]', 'page')
    revalidatePath(`/posts/${postId}`)
    revalidateTag('trending-posts')
    return NextResponse.json({ post, previousStatus: result.previousStatus })
  } catch (error) {
    console.error('[admin/posts/review]', { postId, status, error })
    if (error instanceof Error && error.message === 'POST_ALREADY_REVIEWED') {
      return NextResponse.json({ message: '该帖子已被其他管理员审核，请刷新后查看最新状态' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'POST_NOT_FOUND') {
      return NextResponse.json({ message: '帖子不存在或已删除' }, { status: 404 })
    }
    return NextResponse.json({ message: '审核失败，请稍后重试' }, { status: 500 })
  }
}
