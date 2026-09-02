import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { checkBannedWords, BANNED_WORD_MESSAGE } from '@/lib/content-moderation'
import { createNotification } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { getCurrentUser } from '@/lib/auth'
import { emitRealtime } from '@/lib/realtime'
import { getSalonComments, getSalonPostVisibilityWhere, serializeSalonComment } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { getReplyLengthMetrics, replyTooLongPayload } from '@/lib/reply-length'

type RouteContext = { params: Promise<{ postId: string }> }

async function canModerateSalon(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return Boolean(user && await hasAdminPermission(user, 'post_manage').catch(() => false))
}

export async function GET(request: Request, context: RouteContext) {
  const { postId } = await context.params
  const user = await getCurrentUser()
  const canModerate = await canModerateSalon(user)
  const post = await prisma.salonPost.findFirst({ where: getSalonPostVisibilityWhere(postId, user?.id, canModerate), select: { id: true } })
  if (!post) return NextResponse.json({ ok: false, message: '作品不存在或当前不可查看' }, { status: 404 })
  const cursor = new URL(request.url).searchParams.get('cursor') || undefined
  const data = await getSalonComments(postId, cursor)
  return NextResponse.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/salon/comments',
    ip: { limit: 80, windowSeconds: 10 * 60 },
    user: { limit: 20, windowSeconds: 10 * 60 },
  }, '评论过于频繁，请稍后再试')
  if (limited) return limited
  const { postId } = await context.params
  const body = await request.json().catch(() => null) as { content?: unknown; parentId?: unknown } | null
  const parentId = sanitizeText(body?.parentId, 191) || null
  const contentLength = getReplyLengthMetrics(body?.content)
  if (contentLength.exceededBy > 0) return NextResponse.json({ ok: false, ...replyTooLongPayload(contentLength, parentId ? '回复' : '评论') }, { status: 400 })
  const content = contentLength.content
  if (contentLength.actualLength < 2) return NextResponse.json({ ok: false, message: '评论至少需要 2 个字符' }, { status: 400 })
  if ((await checkBannedWords(content)).blocked) return NextResponse.json({ ok: false, message: BANNED_WORD_MESSAGE }, { status: 400 })

  const canModerate = await canModerateSalon(guard.user)
  const post = await prisma.salonPost.findFirst({
    where: getSalonPostVisibilityWhere(postId, guard.user.id, canModerate),
    select: { id: true, userId: true },
  })
  if (!post) return NextResponse.json({ ok: false, message: '作品不存在或当前不允许评论' }, { status: 404 })

  let parent: { id: string; authorId: string } | null = null
  if (parentId) {
    parent = await prisma.salonComment.findFirst({ where: { id: parentId, postId, isDeleted: false }, select: { id: true, authorId: true } })
    if (!parent) return NextResponse.json({ ok: false, message: '不能回复不存在或已删除的评论' }, { status: 409 })
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.salonComment.findFirst({
        where: { postId, authorId: guard.user.id, parentId, content, isDeleted: false, createdAt: { gte: new Date(Date.now() - 8_000) } },
        select: { id: true },
      })
      if (duplicate) throw new Error('SALON_COMMENT_DUPLICATE')
      const comment = await tx.salonComment.create({
        data: { postId, authorId: guard.user.id, parentId, content },
        select: {
          id: true,
          parentId: true,
          content: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              nicknameModerationStatus: true,
              nicknameViolationDisplay: true,
              avatarUrl: true,
              Profile: { select: { avatarUrl: true } },
            },
          },
        },
      })
      await tx.salonPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } }, select: { id: true } })
      return comment
    })

    const recipientId = parent?.authorId || post.userId
    if (recipientId !== guard.user.id) {
      await safeNotificationWrite(() => createNotification({
        data: {
          recipientId,
          actorId: guard.user.id,
          type: 'REPLY',
          key: `salon-comment:${created.id}`,
          title: parent ? '有人回复了你的沙龙评论' : '有人评论了你的沙龙作品',
          content: parent ? `${guard.user.nickname} 回复了你的沙龙评论` : `${guard.user.nickname} 评论了你的沙龙作品`,
          link: `/salon/${postId}#salon-comments`,
        },
      }), { operation: 'salon.comment.notification', userId: guard.user.id, notificationType: 'REPLY' })
      emitRealtime(recipientId, 'notification')
    }
    return NextResponse.json({ ok: true, comment: serializeSalonComment(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'SALON_COMMENT_DUPLICATE') return NextResponse.json({ ok: false, message: '相同评论正在处理中，请勿重复提交' }, { status: 409 })
    console.error('[salon.comment.create]', { postId, userId: guard.user.id, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, message: '评论失败，请稍后重试' }, { status: 500 })
  }
}
