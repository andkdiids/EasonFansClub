import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { decideFriendRequest } from '@/lib/friends'
import { getFriendRequestNotificationKey } from '@/lib/notifications'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { enforceApiRateLimit } from '@/lib/security'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'

type RouteContext = { params: Promise<{ requestId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
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

      const exactNotification = await tx.notification.findFirst({
        where: {
          recipientId: pending.receiverId,
          actorId: user.id,
          type: 'FRIEND_REQUEST',
          key: getFriendRequestNotificationKey(requestId),
          isRead: false,
        },
        select: { id: true },
      })
      const legacyNotification = exactNotification ? null : await tx.notification.findFirst({
        where: {
          recipientId: pending.receiverId,
          actorId: user.id,
          type: 'FRIEND_REQUEST',
          title: '好友申请',
          key: null,
          isRead: false,
          createdAt: { gte: pending.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      const notification = exactNotification || legacyNotification
      if (notification) {
        await tx.notification.update({ where: { id: notification.id }, data: { isRead: true, readAt: new Date() } })
      }
      return { receiverId: pending.receiverId }
    })
    if (!cancelled) return NextResponse.json({ message: '好友申请不存在或已处理' }, { status: 404 })
    emitRealtimeMany([user.id, cancelled.receiverId], 'friend-request', { requestId })
    return NextResponse.json({ message: '好友申请已取消' })
  }
  const action = body?.action === 'accept' ? 'accept' : 'reject'
  const result = await decideFriendRequest(user.id, requestId, action)
  for (const userId of result.badgeEvaluationUserIds) triggerBadgeEvaluation(userId, 'FRIENDSHIP_CREATED')

  return NextResponse.json(result.body, { status: result.status })
}
