import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  if (guard.user.id === userId) {
    return NextResponse.json({ message: '不能关注自己' }, { status: 400 })
  }

  await prisma.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: guard.user.id,
        followingId: userId,
      },
    },
    update: {},
    create: {
      followerId: guard.user.id,
      followingId: userId,
    },
  })

  await prisma.notification.create({
    data: {
      recipientId: userId,
      actorId: guard.user.id,
      type: 'FOLLOW',
      title: '你有新的关注者',
      content: `${guard.user.nickname} 关注了你`,
      link: `/users/${guard.user.id}`,
    },
  })

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
