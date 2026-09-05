import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireUser } from '@/lib/security'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'

type RouteContext = { params: Promise<{ userId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  if (guard.user.id === userId) {
    return NextResponse.json({ message: '不能关注自己' }, { status: 400 })
  }

  let created = false
  let followId: string | null = null
  try {
    const follow = await prisma.follow.create({
      data: {
        followerId: guard.user.id,
        followingId: userId,
      },
    })
    created = true
    followId = follow.id
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
  }

  if (created) {
    await safeNotificationWrite(
      () => createNotification({
        data: {
          recipientId: userId,
          actorId: guard.user.id,
          type: 'FOLLOW',
          title: '你有新的关注者',
          content: `${guard.user.nickname} 关注了你`,
          link: `/users/${guard.user.id}`,
        },
      }),
      { operation: 'follow-created', userId, notificationType: 'FOLLOW' },
    )
    triggerBadgeEvaluation(userId, 'FOLLOW_CREATED', followId)
    emitRealtime(userId, 'notification')
  }

  return NextResponse.json({ followed: true })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  await prisma.follow.deleteMany({
    where: {
      followerId: guard.user.id,
      followingId: userId,
    },
  })

  return NextResponse.json({ followed: false })
}
