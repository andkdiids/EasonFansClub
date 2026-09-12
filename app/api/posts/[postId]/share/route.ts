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

const MAX_SHARE_RECIPIENTS = 20

type StoredPostShareMessage = Prisma.DirectMessageGetPayload<{ select: typeof messageSelect }>

type ShareRecipientResult = {
  recipientId: string
  success: boolean
  duplicate: boolean
  awardedAmount: number
  status: number
  code?: string
  error?: string
  conversationId: string
  message: StoredPostShareMessage | null
}

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
  const rawRecipientIds = Array.isArray(body?.recipientIds)
    ? body.recipientIds
    : [body?.recipientId]
  const recipientIds = [...new Set(rawRecipientIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))]
  if (!recipientIds.length || recipientIds.some((recipientId) => recipientId.length > 191)) return shareFailure(400, 'INVALID_RECIPIENT', '请选择有效好友')
  if (recipientIds.length > MAX_SHARE_RECIPIENTS) return shareFailure(413, 'TOO_MANY_RECIPIENTS', `一次最多分享给 ${MAX_SHARE_RECIPIENTS} 位好友`)

  const clientMessageIds = recipientIds.map((recipientId) => ({
    recipientId,
    clientMessageId: getClientMessageId(body, recipientId, recipientIds.length),
  }))

  const post = await findShareablePost(guard.user.id, postId)
  if (!post) return shareFailure(404, 'POST_NOT_SHAREABLE', '帖子不存在或暂不可分享')

  const snapshot = toPostShareSnapshot(post)
  const now = new Date()
  const results: ShareRecipientResult[] = []
  for (const { recipientId, clientMessageId } of clientMessageIds) {
    if (!uuidPattern.test(clientMessageId)) {
      results.push({ recipientId, success: false, duplicate: false, awardedAmount: 0, status: 400, code: 'INVALID_CLIENT_MESSAGE_ID', error: '分享请求无效，请重试', conversationId: '', message: null })
      continue
    }
    if (!(await assertFriendShareTarget(guard.user.id, recipientId))) {
      results.push({ recipientId, success: false, duplicate: false, awardedAmount: 0, status: 403, code: 'NOT_FRIEND', error: '只能分享给当前好友', conversationId: '', message: null })
      continue
    }
    const result = await createPostShareMessage({
      senderId: guard.user.id,
      recipientId,
      clientMessageId,
      snapshot,
      now,
    })
    results.push(result)
    if (result.success) emitRealtimeMany([guard.user.id, recipientId], 'message', { conversationId: result.conversationId })
  }

  const successful = results.filter((result) => result.success)
  const failed = results.filter((result) => !result.success)
  if (recipientIds.length === 1) {
    const result = results[0]
    if (!result.success) return shareFailure(result.status, result.code || 'SEND_FAILED', result.error || '分享失败，请稍后重试')
    return NextResponse.json({
      success: true,
      duplicate: result.duplicate,
      awardedAmount: result.awardedAmount,
      message: serializePostShareMessage(result.message!, snapshot),
    }, { status: result.duplicate ? 200 : 201, headers: privateHeaders })
  }

  return NextResponse.json({
    success: successful.length > 0,
    partial: successful.length > 0 && failed.length > 0,
    recipientCount: recipientIds.length,
    sentCount: successful.length,
    failedCount: failed.length,
    awardedAmount: successful.reduce((total, result) => total + result.awardedAmount, 0),
    results: results.map((result) => ({
      recipientId: result.recipientId,
      success: result.success,
      duplicate: result.duplicate,
      awardedAmount: result.awardedAmount,
      ...(result.success ? { message: serializePostShareMessage(result.message!, snapshot) } : { code: result.code, error: result.error }),
    })),
  }, { status: successful.length || failed.length ? 200 : 400, headers: privateHeaders })
}

class ShareMessageConflictError extends Error {}

function getClientMessageId(body: Record<string, unknown> | null, recipientId: string, recipientCount: number) {
  const mapped = body?.clientMessageIds
  if (mapped && typeof mapped === 'object' && !Array.isArray(mapped)) {
    const candidate = (mapped as Record<string, unknown>)[recipientId]
    if (typeof candidate === 'string') return candidate.trim()
  }
  if (recipientCount === 1 && typeof body?.clientMessageId === 'string') return body.clientMessageId.trim()
  return ''
}

async function createPostShareMessage(input: {
  senderId: string
  recipientId: string
  clientMessageId: string
  snapshot: ReturnType<typeof toPostShareSnapshot>
  now: Date
}): Promise<ShareRecipientResult & { conversationId: string }> {
  const content = postSharePreview(input.snapshot)
  try {
    const result = await prisma.$transaction(async (tx) => {
      const conversation = await ensureFriendConversation(tx, input.senderId, input.recipientId)
      const existing = await tx.directMessage.findUnique({
        where: { senderId_clientMessageId: { senderId: input.senderId, clientMessageId: input.clientMessageId } },
        select: messageSelect,
      })
      if (existing) {
        const existingSnapshot = parsePostShareSnapshot(existing.metadata)
        if (existing.conversationId !== conversation.id || existingSnapshot?.postId !== input.snapshot.postId) {
          throw new ShareMessageConflictError()
        }
        return { conversationId: conversation.id, message: existing, duplicate: true, awardedAmount: 0 }
      }

      const message = await tx.directMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: input.senderId,
          type: POST_SHARE_MESSAGE_TYPE,
          content,
          metadata: input.snapshot,
          clientMessageId: input.clientMessageId,
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
        where: { conversationId: conversation.id, userId: input.senderId },
        data: { lastReadAt: input.now, isDeleted: false },
      })
      const task = await recordContentShareTask(tx, input.senderId, input.now)
      return { conversationId: conversation.id, message, duplicate: false, awardedAmount: task.awardedAmount }
    }, { timeout: 20_000, maxWait: 5_000 })
    return { recipientId: input.recipientId, success: true, duplicate: result.duplicate, awardedAmount: result.awardedAmount, status: result.duplicate ? 200 : 201, conversationId: result.conversationId, message: result.message }
  } catch (error) {
    if (error instanceof ShareMessageConflictError) return { recipientId: input.recipientId, success: false, duplicate: false, awardedAmount: 0, status: 409, code: 'DUPLICATE_MESSAGE', error: '分享请求已被其他内容使用，请重试', conversationId: '', message: null }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await prisma.directMessage.findUnique({
        where: { senderId_clientMessageId: { senderId: input.senderId, clientMessageId: input.clientMessageId } },
        select: messageSelect,
      }).catch(() => null)
      const duplicateSnapshot = duplicate ? parsePostShareSnapshot(duplicate.metadata) : null
      if (duplicate && duplicateSnapshot?.postId === input.snapshot.postId) {
        return { recipientId: input.recipientId, success: true, duplicate: true, awardedAmount: 0, status: 200, conversationId: duplicate.conversationId, message: duplicate }
      }
    }
    console.error('[post-share.send]', { name: error instanceof Error ? error.name : 'UnknownError' })
    return { recipientId: input.recipientId, success: false, duplicate: false, awardedAmount: 0, status: 500, code: 'SEND_FAILED', error: '分享失败，请稍后重试', conversationId: '', message: null }
  }
}

function serializePostShareMessage(storedMessage: StoredPostShareMessage, snapshot: ReturnType<typeof toPostShareSnapshot>) {
  return {
    id: storedMessage.id,
    type: POST_SHARE_MESSAGE_TYPE,
    content: storedMessage.content,
    senderId: storedMessage.senderId,
    clientMessageId: storedMessage.clientMessageId,
    createdAt: storedMessage.createdAt.toISOString(),
    readAt: null,
    postShare: toPostShareMessageView(snapshot),
  }
}

function shareFailure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, error: message, message }, { status, headers: privateHeaders })
}
