import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { emitRealtime } from '@/lib/realtime'
import { getFollowNotificationKey } from '@/lib/notification-keys'
import { upsertNotification } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { findActiveFollowTarget, privateFollowHeaders } from '@/lib/follow-service'
import { prisma } from '@/lib/prisma'
import { resolveRelationship } from '@/lib/relationship-resolver'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateFollowHeaders })
}

async function guardFollowTarget(request: Request, viewerId: string, targetId: string) {
  const limited = await enforceApiRateLimit(request, viewerId, {
    endpoint: '/api/users/:userId/follow',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return { response: limited, target: null }

  if (viewerId === targetId) return { response: json({ message: '不能关注自己' }, 400), target: null }
  const target = await findActiveFollowTarget(targetId)
  if (!target) return { response: json({ message: '用户不存在' }, 404), target: null }
  return { response: null, target }
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const targetGuard = await guardFollowTarget(request, guard.user.id, userId)
  if (targetGuard.response) return targetGuard.response

  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: guard.user.id, blockedId: userId },
        { blockerId: userId, blockedId: guard.user.id },
      ],
    },
    select: { id: true },
  })
  if (block) return json({ message: '该用户已被屏蔽，无法关注', relationship: await resolveRelationship(guard.user.id, userId) }, 403)

  let created = false
  let followId: string | null = null
  try {
    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: guard.user.id, followingId: userId } },
      select: { id: true },
    })
    if (existing) {
      followId = existing.id
    } else {
      const follow = await prisma.follow.create({
        data: { followerId: guard.user.id, followingId: userId },
        select: { id: true },
      })
      created = true
      followId = follow.id
    }
  } catch (error) {
    // A concurrent duplicate request is still an idempotent success.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
  }

  if (created) {
    const notificationKey = getFollowNotificationKey(guard.user.id, userId)
    await safeNotificationWrite(
      () => upsertNotification({
        where: { recipientId_key: { recipientId: userId, key: notificationKey } },
        update: {
          actorId: guard.user.id,
          type: 'FOLLOW',
          title: '你有新的关注者',
          content: `${guard.user.nickname} 关注了你`,
          link: `/users/${guard.user.id}`,
          isRead: false,
          readAt: null,
          createdAt: new Date(),
        },
        create: {
          recipientId: userId,
          actorId: guard.user.id,
          type: 'FOLLOW',
          title: '你有新的关注者',
          content: `${guard.user.nickname} 关注了你`,
          link: `/users/${guard.user.id}`,
          key: notificationKey,
        },
      }),
      { operation: 'follow-created', userId: guard.user.id, targetId: userId, notificationType: 'FOLLOW' },
    )
    triggerBadgeEvaluation(userId, 'FOLLOW_CREATED', followId)
    emitRealtime(userId, 'notification')
  }

  return json({ success: true, followed: true, relationship: await resolveRelationship(guard.user.id, userId) })
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const targetGuard = await guardFollowTarget(request, guard.user.id, userId)
  if (targetGuard.response) return targetGuard.response

  // Only the authenticated viewer's directional edge is removable. A
  // reverse Follow is left intact, so MUTUAL becomes FOLLOWED_BY.
  await prisma.follow.deleteMany({
    where: { followerId: guard.user.id, followingId: userId },
  })

  return json({ success: true, followed: false, relationship: await resolveRelationship(guard.user.id, userId) })
}
