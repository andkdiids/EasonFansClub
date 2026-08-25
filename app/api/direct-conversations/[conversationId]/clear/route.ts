import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录', privateHeaders)
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/direct-conversations/clear',
    user: { limit: 30, windowSeconds: 60 },
  })
  if (limited) return limited
  const { conversationId } = await params
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    select: { id: true, isDeleted: true },
  })
  if (!participant || participant.isDeleted) return NextResponse.json({ message: '会话不存在或无权操作' }, { status: 404, headers: privateHeaders })

  const clearedAt = new Date()
  await prisma.conversationParticipant.update({
    where: { id: participant.id },
    data: { clearedAt, lastReadAt: clearedAt, isDeleted: false },
  })
  // This is deliberately emitted only to the current user. Clearing history
  // is a private view operation and must not notify the other participant.
  emitRealtime(user.id, 'message', { conversationId })
  return NextResponse.json({ ok: true, clearedAt }, { headers: privateHeaders })
}
