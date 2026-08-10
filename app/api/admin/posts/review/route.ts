import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { profileImageUrl, publicImageUrl } from '@/lib/images'
import { buildPostReviewUpdate, isPostModerationStatus } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
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
  Board: { select: { name: true, slug: true } },
  PostMedia: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, type: true, url: true, thumbnail: true } },
} as const

type ReviewPostRow = Prisma.PostGetPayload<{ select: typeof reviewSelect }>

function serializePost(post: ReviewPostRow) {
  return {
    ...post,
    createdAt: post.createdAt.toISOString(),
    reviewedAt: post.reviewedAt?.toISOString() || null,
    User: { ...post.User, Profile: post.User.Profile ? { ...post.User.Profile, avatarUrl: profileImageUrl(post.User.Profile.avatarUrl) } : null },
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
  const rejectionReason = status === 'REJECTED' ? sanitizeText(body?.rejectionReason, 1000) || null : null

  try {
    const result = await prisma.$transaction(async (tx) => {
      const reviewedAt = new Date()
      // Serialize concurrent reviews of the same Post row before reading its state.
      await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
      const current = await tx.post.findFirst({
        where: { id: postId, isDeleted: false },
        select: { id: true, authorId: true, boardId: true, title: true, moderationStatus: true },
      })
      if (!current) throw new Error('POST_NOT_FOUND')
      const updated = await tx.post.update({
        where: { id: postId, isDeleted: false },
        data: buildPostReviewUpdate({ status, reviewedAt, reviewedById: guard.user.id, rejectionReason }),
        select: { id: true, moderationStatus: true, reviewedAt: true, rejectionReason: true },
      })
      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          postId,
          action: status === 'APPROVED' ? 'APPROVE_POST' : 'REJECT_POST',
          metadata: { moderationStatus: updated.moderationStatus, rejectionReason: updated.rejectionReason },
        },
      })
      const statusChanged = current.moderationStatus !== updated.moderationStatus
      if (statusChanged) {
        await tx.notification.updateMany({
          where: {
            type: 'ADMIN',
            isRead: false,
            key: `post-review:${current.id}`,
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
      return { post: updated, previousStatus: current.moderationStatus }
    })
    const post = result.post
    revalidatePath('/community')
    revalidatePath('/forum')
    revalidatePath('/admin/posts/review')
    revalidatePath(`/posts/${postId}`)
    return NextResponse.json({ post, previousStatus: result.previousStatus })
  } catch (error) {
    console.error('[admin/posts/review]', { postId, status, error })
    if (error instanceof Error && error.message === 'POST_NOT_FOUND') {
      return NextResponse.json({ message: '帖子不存在或已删除' }, { status: 404 })
    }
    return NextResponse.json({ message: '审核失败，请稍后重试' }, { status: 500 })
  }
}
