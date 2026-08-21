import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(_request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]:DELETE',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  })
  if (limited) return limited

  const { messageId } = await context.params
  const message = await prisma.dailyMessage.findUnique({
    where: { id: messageId },
    select: { id: true, userId: true, isDeleted: true },
  })

  if (!message || message.isDeleted) {
    return NextResponse.json({ message: '挂号留言不存在' }, { status: 404 })
  }
  if (message.userId !== guard.user.id) {
    return NextResponse.json({ message: '只能删除自己的挂号留言' }, { status: 403 })
  }

  await prisma.dailyMessage.update({
    where: { id: message.id },
    data: { isDeleted: true, deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
