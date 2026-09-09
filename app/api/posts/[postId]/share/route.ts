import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { requireUser, enforceApiRateLimit } from '@/lib/security'
import { emitRealtimeMany } from '@/lib/realtime'
import { ensureFriendConversation } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { recordContentShareTask } from '@/lib/share-task'
import {
  assertFriendShareTarget,
  findShareablePost,
  getRecentPostShareFriends,
  toPostShareMessageView,
  toPostShareSnapshot,
} from '@/lib/post-share-service'
import { parsePostShareSnapshot, postSharePreview, POST_SHARE_MESSAGE_TYPE } from '@/lib/post-share-types'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const messageSelect = {
  id: true,
  type: true,
  content: true,
  conversationId: true,
  senderId: true,
  createdAt: true,
  clientMessageId: true,
  metadata: true,
} as const

type Params = { params: Promise<{ postId: string }> }

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/posts/share/recent-friends',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const { postId } = await params
  const post = await findShareablePost(guard.user.id, postId)
  if (!post) return NextResponse.json({ message: '帖子不存在或暂不可分享' }, { status: 404, headers: privateHeaders })
  const recentFriends = await getRecentPostShareFriends(guard.user.id, 12)
  return NextResponse.json({ recentFriends }, { headers: privateHeaders })
}

export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/posts/share/send',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '分享消息发送过于频繁，请稍后再试')
  if (limited) return limited

  const { postId } = await params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const recipientId = typeof body?.recipientId === 'string' ? body.recipientId.trim() : ''
  const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.trim() : ''
  if (!recipientId || recipientId.length > 191) return shareFailure(400, 'INVALID_RECIPIENT', '请选择有效好友')
  if (!uuidPattern.test(clientMessageId)) return shareFailure(400, 'INVALID_CLIENT_MESSAGE_ID', '分享请求无效，请重试')

  const post = await findShareablePost(guard.user.id, postId)
  if (!post) return shareFailure(404, 'POST_NOT_SHAREABLE', '帖子不存在或暂不可分享')
  if (!(await assertFriendShareTarget(guard.user.id, recipientId))) {
    return shareFailure(403, 'NOT_FRIEND', '只能分享给当前好友')
  }

  const snapshot = toPostShareSnapshot(post)
  const content = postSharePreview(snapshot)
  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const conversation = await ensureFriendConversation(tx, guard.user.id, recipientId)
      const existing = await tx.directMessage.findUnique({
        where: { senderId_clientMessageId: { senderId: guard.user.id, clientMessageId } },
        select: messageSelect,
      })
      if (existing) {
        const existingSnapshot = parsePostShareSnapshot(existing.metadata)
        if (existing.conversationId !== conversation.id || existingSnapshot?.postId !== snapshot.postId) {
          throw new ShareMessageConflictError()
        }
        return { conversationId: conversation.id, message: existing, duplicate: true, awardedAmount: 0 }
      }

      const message = await tx.directMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: guard.user.id,
          type: POST_SHARE_MESSAGE_TYPE,
          content,
          metadata: snapshot,
          clientMessageId,
        },
        select: messageSelect,
      })
      await tx.conversation.updateMany({
        where: {
          id: conversation.id,
          OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: message.createdAt } }],
        },
        data: { lastMessageAt: message.createdAt },
      })
      await tx.conversationParticipant.updateMany({
        where: { conversationId: conversation.id, userId: guard.user.id },
        data: { lastReadAt: now, isDeleted: false },
      })
      const task = await recordContentShareTask(tx, guard.user.id, now)
      return { conversationId: conversation.id, message, duplicate: false, awardedAmount: task.awardedAmount }
    }, { timeout: 20_000, maxWait: 5_000 })

    emitRealtimeMany([guard.user.id, recipientId], 'message', { conversationId: result.conversationId })
    return NextResponse.json({
      success: true,
      duplicate: result.duplicate,
      awardedAmount: result.awardedAmount,
      message: {
        id: result.message.id,
        type: POST_SHARE_MESSAGE_TYPE,
        content: result.message.content,
        senderId: result.message.senderId,
        clientMessageId: result.message.clientMessageId,
        createdAt: result.message.createdAt.toISOString(),
        readAt: null,
        postShare: toPostShareMessageView(snapshot),
      },
    }, { status: result.duplicate ? 200 : 201, headers: privateHeaders })
  } catch (error) {
    if (error instanceof ShareMessageConflictError) return shareFailure(409, 'DUPLICATE_MESSAGE', '分享请求已被其他内容使用，请重试')
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await prisma.directMessage.findUnique({
        where: { senderId_clientMessageId: { senderId: guard.user.id, clientMessageId } },
        select: messageSelect,
      }).catch(() => null)
      const duplicateSnapshot = duplicate ? parsePostShareSnapshot(duplicate.metadata) : null
      if (duplicate && duplicateSnapshot?.postId === snapshot.postId) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          awardedAmount: 0,
          message: {
            id: duplicate.id,
            type: POST_SHARE_MESSAGE_TYPE,
            content: duplicate.content,
            senderId: duplicate.senderId,
            clientMessageId: duplicate.clientMessageId,
            createdAt: duplicate.createdAt.toISOString(),
            readAt: null,
            postShare: toPostShareMessageView(snapshot),
          },
        }, { headers: privateHeaders })
      }
    }
    console.error('[post-share.send]', { name: error instanceof Error ? error.name : 'UnknownError' })
    return shareFailure(500, 'SEND_FAILED', '分享失败，请稍后重试')
  }
}

class ShareMessageConflictError extends Error {}

function shareFailure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, error: message, message }, { status, headers: privateHeaders })
}
