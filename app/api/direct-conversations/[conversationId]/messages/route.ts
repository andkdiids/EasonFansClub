import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const messageSelect = {
  id: true,
  content: true,
  senderId: true,
  createdAt: true,
  clientMessageId: true,
} as const

async function getConversation(userId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, ConversationParticipant: { some: { userId, isDeleted: false } } },
    select: {
      id: true,
      ConversationParticipant: { select: { userId: true, lastReadAt: true } },
    },
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const { conversationId } = await params
  const conversation = await getConversation(user.id, conversationId)
  if (!conversation) return NextResponse.json({ message: '会话不存在或无权查看' }, { status: 404, headers: privateHeaders })

  const url = new URL(request.url)
  const cursor = parseCursor(url.searchParams.get('after'))
  const before = cursor ? null : parseCursor(url.searchParams.get('before'))
  const take = cursor ? 101 : 51
  const rows = await prisma.directMessage.findMany({
    where: {
      conversationId,
      isDeleted: false,
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
  const limited = rows.slice(0, cursor ? 100 : 50)
  const ordered = cursor ? limited : limited.reverse()
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
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const { conversationId } = await params
  const body = await request.json().catch(() => null)
  const rawContent = String(body?.content ?? '').trim()
  if (!rawContent) return NextResponse.json({ message: '消息不能为空' }, { status: 400, headers: privateHeaders })
  if (rawContent.length > 1000) return NextResponse.json({ message: '消息不能超过1000个字符' }, { status: 413, headers: privateHeaders })
  const content = sanitizeText(rawContent, 1000)
  if (!content) return NextResponse.json({ message: '消息不能为空' }, { status: 400, headers: privateHeaders })
  if (await containsSensitiveContent(content)) return NextResponse.json({ message: '消息包含违禁内容' }, { status: 400, headers: privateHeaders })
  const clientMessageId = String(body?.clientMessageId || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
    return NextResponse.json({ message: '消息幂等标识无效' }, { status: 400, headers: privateHeaders })
  }

  const conversation = await getConversation(user.id, conversationId)
  if (!conversation) return NextResponse.json({ message: '会话不存在或无权发送' }, { status: 404, headers: privateHeaders })
  const otherUserId = conversation.ConversationParticipant.find((participant) => participant.userId !== user.id)?.userId
  if (!otherUserId) return NextResponse.json({ message: '会话成员无效' }, { status: 400, headers: privateHeaders })
  const recipient = await prisma.user.findFirst({
    where: { id: otherUserId, status: 'ACTIVE', isDeleted: false },
    select: { id: true },
  })
  if (!recipient) return NextResponse.json({ message: '接收用户不存在或不可用' }, { status: 404, headers: privateHeaders })
  const [userAId, userBId] = normalizeFriendPair(user.id, otherUserId)
  const friendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
  if (!friendship) return NextResponse.json({ message: '只能给好友发送私信' }, { status: 403, headers: privateHeaders })

  const existing = await prisma.directMessage.findUnique({
    where: { senderId_clientMessageId: { senderId: user.id, clientMessageId } },
    select: messageSelect,
  })
  if (existing) return NextResponse.json({ message: serializeMessage(existing, user.id, null) }, { headers: privateHeaders })

  const now = new Date()
  try {
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.directMessage.create({
        data: { conversationId, senderId: user.id, content, type: 'TEXT', clientMessageId },
        select: messageSelect,
      })
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
      await tx.conversationParticipant.updateMany({
        where: { conversationId, userId: user.id },
        data: { lastReadAt: now, isDeleted: false },
      })
      return created
    })
    return NextResponse.json({ message: serializeMessage(message, user.id, null) }, { status: 201, headers: privateHeaders })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await prisma.directMessage.findUniqueOrThrow({
        where: { senderId_clientMessageId: { senderId: user.id, clientMessageId } },
        select: messageSelect,
      })
      return NextResponse.json({ message: serializeMessage(duplicate, user.id, null) }, { headers: privateHeaders })
    }
    throw error
  }
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
    senderId: string
    createdAt: Date
    clientMessageId: string | null
  },
  currentUserId: string,
  peerLastReadAt: Date | null,
) {
  return {
    ...message,
    readAt: message.senderId === currentUserId && peerLastReadAt && message.createdAt <= peerLastReadAt
      ? peerLastReadAt
      : null,
  }
}
