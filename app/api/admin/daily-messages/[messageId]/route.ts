import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('daily_message_manage')
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const body = await request.json().catch(() => null)

  // 目标留言必须存在（含已软删的留言也视为存在，保证幂等），避免 prisma.update 抛 P2025 变成 500。
  const existing = await prisma.dailyMessage.findUnique({
    where: { id: messageId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ message: '留言不存在或已被删除' }, { status: 404 })
  }

  if (body?.isFeatured) {
    const message = await prisma.dailyMessage.findUnique({
      where: { id: messageId },
      select: { date: true },
    })
    if (message) {
      const nextDate = new Date(message.date.getFullYear(), message.date.getMonth(), message.date.getDate() + 1)
      const featuredCount = await prisma.dailyMessage.count({
        where: {
          date: { gte: message.date, lt: nextDate },
          isFeatured: true,
          isDeleted: false,
        },
      })
      if (featuredCount >= 5) {
        return NextResponse.json({ message: '每天最多精选 5 条留言' }, { status: 400 })
      }
    }
  }

  const updated = await prisma.dailyMessage.update({
    where: { id: messageId },
    data: {
      ...(body?.isPinned !== undefined ? { isPinned: Boolean(body.isPinned) } : {}),
      ...(body?.isFeatured !== undefined ? { isFeatured: Boolean(body.isFeatured) } : {}),
      ...(body?.isDeleted !== undefined
        ? { isDeleted: Boolean(body.isDeleted), deletedAt: body.isDeleted ? new Date() : null }
        : {}),
    },
  })

  await prisma.adminAction.create({
    data: {
      adminId: guard.user.id,
      action: body?.isDeleted ? 'DELETE_REPLY' : 'UPDATE_SETTING',
      reason: sanitizeText(body?.reason, 160) || '管理每日留言',
      metadata: { dailyMessageId: messageId, body },
    },
  })

  return NextResponse.json({ message: updated })
}
