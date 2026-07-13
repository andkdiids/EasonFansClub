import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const [totalUsers, notifications] = await Promise.all([
    prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }),
    prisma.systemNotification.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        content: true,
        link: true,
        type: true,
        isPublished: true,
        publishedAt: true,
        createdAt: true,
        createdBy: { select: { nickname: true, uid: true } },
        _count: { select: { reads: true } },
      },
    }),
  ])

  return NextResponse.json({
    notifications: notifications.map((item) => ({
      ...item,
      readCount: item._count.reads,
      unreadCount: Math.max(totalUsers - item._count.reads, 0),
      _count: undefined,
    })),
    totalUsers,
  })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const title = sanitizeText(body?.title, 80)
  const content = sanitizeText(body?.content, 2000)
  const link = sanitizeText(body?.link, 500)
  const type = sanitizeText(body?.type || 'SYSTEM', 40).toUpperCase()
  const publishNow = body?.publishNow !== false

  if (!title || !content) {
    return NextResponse.json({ message: '请填写通知标题和内容' }, { status: 400 })
  }

  const notification = await prisma.systemNotification.create({
    data: {
      title,
      content,
      link: link || null,
      type,
      createdById: guard.user.id,
      isPublished: publishNow,
      publishedAt: publishNow ? new Date() : new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    },
    select: { id: true, title: true },
  })

  return NextResponse.json({ notification, message: publishNow ? '全站通知已发布' : '通知已保存为未发布' }, { status: 201 })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const isPublished = Boolean(body?.isPublished)
  if (!id) return NextResponse.json({ message: '通知不存在' }, { status: 400 })

  await prisma.systemNotification.update({
    where: { id },
    data: {
      isPublished,
      ...(isPublished ? { publishedAt: new Date() } : {}),
    },
  })

  return NextResponse.json({ ok: true })
}
