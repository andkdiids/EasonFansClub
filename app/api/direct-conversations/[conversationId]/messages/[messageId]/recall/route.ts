import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getDirectMessageRecallCutoff, canRecallDirectMessage } from '@/lib/direct-message-recall'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录', privateHeaders)
  const rateLimited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/direct-conversations/messages/recall',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '撤回操作过于频繁，请稍后再试')
  if (rateLimited) return rateLimited

  const { conversationId, messageId } = await params
  if (!conversationId || !messageId || conversationId.length > 191 || messageId.length > 191) {
    return recallFailure(400, 'INVALID_MESSAGE', '消息参数无效')
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      ConversationParticipant: { some: { userId: user.id, isDeleted: false } },
    },
    select: { ConversationParticipant: { select: { userId: true, isDeleted: true } } },
  })
  if (!conversation) return recallFailure(404, 'NOT_PARTICIPANT', '会话不存在或无权操作')

  const message = await prisma.directMessage.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true, senderId: true, createdAt: true, isDeleted: true, type: true, clientMessageId: true },
  })
  if (!message) return recallFailure(404, 'MESSAGE_NOT_FOUND', '消息不存在')

  const now = new Date()
  const decision = canRecallDirectMessage(message, user.id, now)
  if (!decision.ok) {
    if (decision.code === 'NOT_SENDER') return recallFailure(403, decision.code, '只能撤回自己发送的消息')
    if (decision.code === 'NOT_RECALLABLE') return recallFailure(403, decision.code, '该消息不可撤回')
    return recallFailure(410, decision.code, '消息发送已超过1分钟，无法撤回')
  }
  if (decision.code === 'ALREADY_RECALLED') {
    return NextResponse.json({ success: true, recalled: true, duplicate: true }, { headers: privateHeaders })
  }

  try {
    const changed = await prisma.directMessage.updateMany({
      where: {
        id: message.id,
        conversationId,
        senderId: user.id,
        isDeleted: false,
        createdAt: { gte: getDirectMessageRecallCutoff(now), lte: now },
      },
      data: { isDeleted: true },
    })
    if (!changed.count) {
      const current = await prisma.directMessage.findUnique({ where: { id: message.id }, select: { isDeleted: true } })
      if (current?.isDeleted) return NextResponse.json({ success: true, recalled: true, duplicate: true }, { headers: privateHeaders })
      return recallFailure(410, 'RECALL_WINDOW_EXPIRED', '消息发送已超过1分钟，无法撤回')
    }
  } catch (error) {
    console.error('[direct-message.recall]', {
      code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return recallFailure(500, 'DATABASE_ERROR', '消息撤回失败，请稍后重试')
  }

  const memberIds = conversation.ConversationParticipant
    .filter((participant) => !participant.isDeleted)
    .map((participant) => participant.userId)
  emitRealtimeMany(memberIds, 'message', { conversationId })
  return NextResponse.json({ success: true, recalled: true, duplicate: false }, { headers: privateHeaders })
}

function recallFailure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, error: message, message }, { status, headers: privateHeaders })
}
