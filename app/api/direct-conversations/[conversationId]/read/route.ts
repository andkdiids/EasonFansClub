import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const { conversationId } = await params
  const messageId = String((await request.json().catch(() => null))?.messageId || '').trim()
  if (!messageId) return NextResponse.json({ message: '缺少已读消息位置' }, { status: 400, headers: privateHeaders })
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    select: { id: true, lastReadAt: true, clearedAt: true },
  })
  if (!participant) return NextResponse.json({ message: '会话不存在或无权操作' }, { status: 404, headers: privateHeaders })

  const visibleMessage = await prisma.directMessage.findFirst({
    where: {
      id: messageId,
      conversationId,
      isDeleted: false,
      ...(participant.clearedAt ? { createdAt: { gt: participant.clearedAt } } : {}),
    },
    select: { createdAt: true },
  })
  if (!visibleMessage) return NextResponse.json({ message: '消息不存在或不属于该会话' }, { status: 404, headers: privateHeaders })

  const readAt = participant.lastReadAt && participant.lastReadAt > visibleMessage.createdAt
    ? participant.lastReadAt
    : visibleMessage.createdAt
  let updated = false
  if (!participant.lastReadAt || readAt > participant.lastReadAt) {
    await prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: readAt, isDeleted: false },
    })
    updated = true
  }
  if (updated) emitRealtime(user.id, 'message', { conversationId })
  return NextResponse.json({ readAt }, { headers: privateHeaders })
}
