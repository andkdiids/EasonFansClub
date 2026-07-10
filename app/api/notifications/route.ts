import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === '1'

  const notifications = await prisma.notification.findMany({
    where: {
      recipientId: guard.user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      actor: { select: { id: true, nickname: true, avatarUrl: true } },
    },
  })

  const unreadCount = await prisma.notification.count({
    where: { recipientId: guard.user.id, isRead: false },
  })

  return NextResponse.json({ notifications, unreadCount })
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : []

  await prisma.notification.updateMany({
    where: {
      recipientId: guard.user.id,
      ...(ids.length ? { id: { in: ids } } : {}),
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
