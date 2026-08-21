import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeFriendPair } from '@/lib/friends'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { enforceApiRateLimit, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { isStickerVisible, recordStickerUsage } from '@/lib/sticker-center'
import { publicModerationText } from '@/lib/content-moderation'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const messageSelect = {
  id: true,
  content: true,
  moderationStatus: true,
  senderId: true,
  createdAt: true,
  clientMessageId: true,
  stickerId: true,
  sticker: { select: { url: true } },
} as const

async function getConversation(userId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, ConversationParticipant: { some: { userId, isDeleted: false } } },
    select: {
      id: true,
      ConversationParticipant: { select: { userId: true, lastReadAt: true, clearedAt: true } },
    },
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const rateLimited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/direct-conversations/messages',
    ip: { limit: 240, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (rateLimited) return rateLimited
  const { conversationId } = await params
  const conversation = await getConversation(user.id, conversationId)
  if (!conversation) return NextResponse.json({ message: '会话不存在或无权查看' }, { status: 404, headers: privateHeaders })

  const url = new URL(request.url)
  const cursor = parseCursor(url.searchParams.get('after'))
  const before = cursor ? null : parseCursor(url.searchParams.get('before'))
  const take = cursor ? 101 : 51
  const viewerParticipant = conversation.ConversationParticipant.find((participant) => participant.userId === user.id)
  const rows = await prisma.directMessage.findMany({
    where: {
      conversationId,
      isDeleted: false,
      ...(viewerParticipant?.clearedAt ? { createdAt: { gt: viewerParticipant.clearedAt } } : {}),
      ...(cursor ? {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      } : before ? {
        OR: [
          { createdAt: { lt: before.createdAt } },
          { createdAt: before.createdAt, id: { lt: before.id } },
        ],
      } : {}),
    },
    orderBy: cursor
      ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: messageSelect,
  })
  const hasMore = rows.length > (cursor ? 100 : 50)
  const limitedRows = rows.slice(0, cursor ? 100 : 50)
  const ordered = cursor ? limitedRows : limitedRows.reverse()
  const peer = conversation.ConversationParticipant.find((participant) => participant.userId !== user.id)

  return NextResponse.json({
    messages: ordered.map((message) => serializeMessage(message, user.id, peer?.lastReadAt || null)),
    cursor: ordered.length ? formatCursor(ordered[ordered.length - 1]) : url.searchParams.get('after'),
    beforeCursor: ordered.length ? formatCursor(ordered[0]) : url.searchParams.get('before'),
    hasMore: cursor ? hasMore : false,
    hasOlder: cursor ? false : hasMore,
    peerLastReadAt: peer?.lastReadAt || null,
  }, { headers: privateHeaders })
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  let senderId = ''
  let idempotencyKey = ''
  let normalizedContent = ''
  try {
    const user = await getCurrentUser()
    if (!user) return messageFailure(401, 'UNAUTHORIZED', '请先登录')
    senderId = user.id
    const limited = await enforceApiRateLimit(request, user.id, {
      endpoint: '/api/direct-conversations/messages',
      ip: { limit: 60, windowSeconds: 60 },
      user: { limit: 30, windowSeconds: 60 },
    }, '私信发送过于频繁，请稍后再试')
    if (limited) return limited
    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    const stickerId = body?.stickerId ? String(body.stickerId).trim() : ''
    const rawContent = String(body?.content ?? '').trim()

    // 表情消息：仅校验 stickerId 可见性，无需文本内容
    if (stickerId) {
      if (!(await isStickerVisible(stickerId))) {
        return messageFailure(400, 'INVALID_STICKER', '该表情不可用或已被隐藏')
      }
      const clientMessageId = String(body?.clientMessageId || '').trim()
      idempotencyKey = clientMessageId
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
        return messageFailure(400, 'INVALID_CLIENT_MESSAGE_ID', '消息幂等标识无效')
      }
      const conversation = await getConversation(user.id, conversationId)
      if (!conversation) return messageFailure(404, 'NOT_PARTICIPANT', '会话不存在或无权发送')
      const otherUserId = conversation.ConversationParticipant.find((participant) => participant.userId !== user.id)?.userId
      if (!otherUserId) return messageFailure(409, 'NOT_PARTICIPANT', '会话成员无效')
      const recipient = await prisma.user.findFirst({
        where: { id: otherUserId, status: 'ACTIVE', isDeleted: false },
        select: { id: true },
      })
      if (!recipient) return messageFailure(404, 'NOT_PARTICIPANT', '接收用户不存在或不可用')
      const [userAId, userBId] = normalizeFriendPair(user.id, otherUserId)
      const friendship = await prisma.friendship.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
        select: { id: true },
      })
      if (!friendship) return messageFailure(403, 'NOT_FRIEND', '只能给好友发送私信')

      const existing = await prisma.directMessage.findUnique({
        where: { senderId_clientMessageId: { senderId: user.id, clientMessageId } },
        select: messageSelect,
      })
      if (existing) {
        emitRealtimeMany([user.id, otherUserId], 'message', { conversationId })
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: serializeMessage(existing, user.id, null),
        }, { headers: privateHeaders })
      }

      const now = new Date()
      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.directMessage.create({
          data: { conversationId, senderId: user.id, type: 'STICKER', content: '', stickerId, clientMessageId },
          select: messageSelect,
        })
        await tx.conversation.updateMany({
          where: {
            id: conversationId,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: created.createdAt } }],
          },
          data: { lastMessageAt: created.createdAt },
        })
        await tx.conversationParticipant.updateMany({
          where: { conversationId, userId: user.id },
          data: { lastReadAt: now, isDeleted: false },
        })
        return created
      })
      await recordStickerUsage(user.id, stickerId)
      emitRealtimeMany([user.id, otherUserId], 'message', { conversationId })
      return NextResponse.json({
        success: true,
        duplicate: false,
        message: serializeMessage(message, user.id, null),
      }, { status: 201, headers: privateHeaders })
    }

    if (!rawContent) return messageFailure(400, 'INVALID_CONTENT', '消息不能为空')
    if (rawContent.length > 1000) return messageFailure(413, 'INVALID_CONTENT', '消息不能超过1000个字符')
    const content = sanitizeText(rawContent, 1000)
    normalizedContent = content
    if (!content) return messageFailure(400, 'INVALID_CONTENT', '消息不能为空')
    if ((await checkBannedWords(content)).blocked) return messageFailure(400, CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE)
    const clientMessageId = String(body?.clientMessageId || '').trim()
    idempotencyKey = clientMessageId
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
      return messageFailure(400, 'INVALID_CLIENT_MESSAGE_ID', '消息幂等标识无效')
    }

    const conversation = await getConversation(user.id, conversationId)
    if (!conversation) return messageFailure(404, 'NOT_PARTICIPANT', '会话不存在或无权发送')
    const otherUserId = conversation.ConversationParticipant.find((participant) => participant.userId !== user.id)?.userId
    if (!otherUserId) return messageFailure(409, 'NOT_PARTICIPANT', '会话成员无效')
    const recipient = await prisma.user.findFirst({
      where: { id: otherUserId, status: 'ACTIVE', isDeleted: false },
      select: { id: true },
    })
    if (!recipient) return messageFailure(404, 'NOT_PARTICIPANT', '接收用户不存在或不可用')
    const [userAId, userBId] = normalizeFriendPair(user.id, otherUserId)
    const friendship = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true },
    })
    if (!friendship) return messageFailure(403, 'NOT_FRIEND', '只能给好友发送私信')

    const existing = await prisma.directMessage.findUnique({
      where: { senderId_clientMessageId: { senderId: user.id, clientMessageId } },
      select: messageSelect,
    })
    if (existing) {
      if (existing.content !== content) return messageFailure(409, 'DUPLICATE_MESSAGE', '该消息标识已被其他内容使用')
      emitRealtimeMany([user.id, otherUserId], 'message', { conversationId })
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: serializeMessage(existing, user.id, null),
      }, { headers: privateHeaders })
    }

    const now = new Date()
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.directMessage.create({
        data: { conversationId, senderId: user.id, content, type: 'TEXT', clientMessageId },
        select: messageSelect,
      })
      await tx.conversation.updateMany({
        where: {
          id: conversationId,
          OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: created.createdAt } }],
        },
        data: { lastMessageAt: created.createdAt },
      })
      await tx.conversationParticipant.updateMany({
        where: { conversationId, userId: user.id },
        data: { lastReadAt: now, isDeleted: false },
      })
      return created
    })
    emitRealtimeMany([user.id, otherUserId], 'message', { conversationId })
    return NextResponse.json({
      success: true,
      duplicate: false,
      message: serializeMessage(message, user.id, null),
    }, { status: 201, headers: privateHeaders })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && senderId && idempotencyKey) {
      const duplicate = await prisma.directMessage.findUnique({
        where: { senderId_clientMessageId: { senderId, clientMessageId: idempotencyKey } },
        select: messageSelect,
      }).catch(() => null)
      if (duplicate?.content === normalizedContent) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: serializeMessage(duplicate, senderId, null),
        }, { headers: privateHeaders })
      }
      return messageFailure(409, 'DUPLICATE_MESSAGE', '该消息标识已被其他内容使用')
    }
    console.error('[direct-message.send]', {
      code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return messageFailure(500, 'DATABASE_ERROR', '消息发送失败，请稍后重试')
  }
}

function messageFailure(status: number, code: string, error: string) {
  return NextResponse.json(
    { success: false, error, code, message: error },
    { status, headers: privateHeaders },
  )
}

function parseCursor(value: string | null) {
  if (!value) return null
  const separator = value.lastIndexOf('|')
  if (separator <= 0) return null
  const createdAt = new Date(value.slice(0, separator))
  const id = value.slice(separator + 1)
  return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id }
}

function formatCursor(message: { createdAt: Date; id: string }) {
  return `${message.createdAt.toISOString()}|${message.id}`
}

function serializeMessage(
  message: {
    id: string
    content: string
    moderationStatus: string
    senderId: string
    createdAt: Date
    clientMessageId: string | null
    stickerId: string | null
    sticker: { url: string } | null
  },
  currentUserId: string,
  peerLastReadAt: Date | null,
) {
  return {
    id: message.id,
    content: publicModerationText(message.content, message.moderationStatus),
    senderId: message.senderId,
    clientMessageId: message.clientMessageId,
    stickerId: message.stickerId,
    stickerUrl: toPublicMediaUrl(message.sticker?.url),
    createdAt: message.createdAt.toISOString(),
    readAt: message.senderId === currentUserId && peerLastReadAt && message.createdAt <= peerLastReadAt
      ? peerLastReadAt.toISOString()
      : null,
  }
}
