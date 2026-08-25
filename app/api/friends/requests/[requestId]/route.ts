import { NextResponse } from 'next/server'
import { decideFriendRequest } from '@/lib/friends'
import { getFriendRequestNotificationKey } from '@/lib/notifications'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { enforceApiRateLimit, requireUser } from '@/lib/security'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { safeNotificationWrite } from '@/lib/notification-transaction'

type RouteContext = { params: Promise<{ requestId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/friends/requests/decision',
    ip: { limit: 60, windowSeconds: 60 * 60 },
    user: { limit: 30, windowSeconds: 60 * 60 },
  }, '好友申请操作过于频繁，请稍后再试')
  if (limited) return limited

  const { requestId } = await context.params
  const body = await request.json().catch(() => null)
  if (body?.action === 'cancel') {
    const cancelled = await prisma.$transaction(async (tx) => {
      const pending = await tx.friendRequest.findFirst({
        where: { id: requestId, senderId: user.id, status: 'PENDING' },
        select: { id: true, receiverId: true, createdAt: true },
      })
      if (!pending) return null

      const updated = await tx.friendRequest.updateMany({
        where: { id: pending.id, senderId: user.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      if (!updated.count) return null
      return { receiverId: pending.receiverId, createdAt: pending.createdAt }
    }, { timeout: 15_000, maxWait: 5_000 })
    if (!cancelled) return NextResponse.json({ message: '好友申请不存在或已处理' }, { status: 404 })
    await safeNotificationWrite(
      async () => {
        const exactNotification = await prisma.notification.findFirst({
          where: {
            recipientId: cancelled.receiverId,
            actorId: user.id,
            type: 'FRIEND_REQUEST',
            key: getFriendRequestNotificationKey(requestId),
            isRead: false,
          },
          select: { id: true },
        })
        const notification = exactNotification || await prisma.notification.findFirst({
          where: {
            recipientId: cancelled.receiverId,
            actorId: user.id,
            type: 'FRIEND_REQUEST',
            title: '好友申请',
            key: null,
            isRead: false,
            createdAt: { gte: cancelled.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        if (notification) {
          await prisma.notification.update({ where: { id: notification.id }, data: { isRead: true, readAt: new Date() } })
        }
      },
      { operation: 'friend-request-cancel-mark-read', userId: cancelled.receiverId, notificationType: 'FRIEND_REQUEST' },
    )
    emitRealtimeMany([user.id, cancelled.receiverId], 'friend-request', { requestId })
    return NextResponse.json({ message: '好友申请已取消' })
  }
  const action = body?.action === 'accept' ? 'accept' : 'reject'
  const result = await decideFriendRequest(user.id, requestId, action)
  for (const userId of result.badgeEvaluationUserIds) triggerBadgeEvaluation(userId, 'FRIENDSHIP_CREATED')

  return NextResponse.json(result.body, { status: result.status })
}
