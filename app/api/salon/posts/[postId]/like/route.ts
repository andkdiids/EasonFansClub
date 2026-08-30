import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { emitRealtime } from '@/lib/realtime'
import { createNotification } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/salon/posts/like',
    ip: { limit: 120, windowSeconds: 10 * 60 },
    user: { limit: 60, windowSeconds: 10 * 60 },
  }, '点赞过于频繁，请稍后再试')
  if (limited) return limited
  const { postId } = await context.params

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`SalonPost\` WHERE \`id\` = ${postId} FOR UPDATE`
      const post = await tx.salonPost.findFirst({
        where: { id: postId, status: 'APPROVED', approvedAt: { not: null } },
        select: { id: true, userId: true },
      })
      if (!post) throw new Error('SALON_POST_NOT_FOUND')
      const existing = await tx.salonPostLike.findUnique({ where: { postId_userId: { postId, userId: guard.user.id } }, select: { id: true } })
      if (existing) await tx.salonPostLike.delete({ where: { id: existing.id } })
      else await tx.salonPostLike.create({ data: { postId, userId: guard.user.id } })
      const likeCount = await tx.salonPostLike.count({ where: { postId } })
      await tx.salonPost.update({ where: { id: postId }, data: { likeCount }, select: { id: true } })
      return { liked: !existing, likeCount, recipientId: post.userId }
    })

    if (result.liked && result.recipientId !== guard.user.id) {
      await safeNotificationWrite(() => createNotification({
        data: {
          recipientId: result.recipientId,
          actorId: guard.user.id,
          type: 'LIKE',
          key: `salon-like:${postId}:${guard.user.id}`,
          title: '有人赞了你的沙龙作品',
          content: `${guard.user.nickname} 赞了你的沙龙作品`,
          link: `/salon/${postId}`,
        },
      }), { operation: 'salon.like.notification', userId: guard.user.id, notificationType: 'LIKE' })
      emitRealtime(result.recipientId, 'notification')
    }
    return NextResponse.json({ ok: true, liked: result.liked, likeCount: result.likeCount })
  } catch (error) {
    if (error instanceof Error && error.message === 'SALON_POST_NOT_FOUND') return NextResponse.json({ ok: false, message: '只有已通过审核的作品可以点赞' }, { status: 404 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ ok: false, message: '点赞状态已更新，请刷新后重试' }, { status: 409 })
    console.error('[salon.like]', { postId, userId: guard.user.id, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, message: '点赞失败，请稍后重试' }, { status: 500 })
  }
}
