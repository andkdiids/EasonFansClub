import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords, publicModerationText } from '@/lib/content-moderation'
import { formatBeijingDate } from '@/lib/checkin'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'

type RouteContext = { params: Promise<{ messageId: string }> }

const COMMENT_PAGE_SIZE = 80
const commentUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  level: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
} as const

function serializeComment(comment: {
  id: string
  parentId: string | null
  content: string
  moderationStatus: string
  ipRegion: string | null
  createdAt: Date
  updatedAt: Date
  User: {
    id: string
    uid: number
    nickname: string
    usernameModerationStatus: string
    nicknameModerationStatus: string
    nicknameViolationDisplay: string | null
    avatarUrl: string | null
    level: number
    Profile: { displayName: string | null; displayNameModerationStatus: string; avatarUrl: string | null } | null
  }
}, equippedBadge?: EquippedBadgeView | null) {
  const { User, ...row } = comment
  const publicName = getPublicUserDisplayName(User)
  return {
    ...row,
    content: publicModerationText(comment.content, comment.moderationStatus),
    User: {
      uid: User.uid,
      nickname: publicName,
      usernameModerationStatus: User.usernameModerationStatus,
      nicknameModerationStatus: User.nicknameModerationStatus,
      nicknameViolationDisplay: User.nicknameViolationDisplay,
      avatarUrl: publicImageUrl(User.avatarUrl),
      level: User.level,
      equippedBadge: equippedBadge || null,
      Profile: User.Profile ? {
        displayName: publicName,
        avatarUrl: publicImageUrl(User.Profile.avatarUrl),
      } : null,
    },
  }
}

export async function GET(request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  const limited = await enforceApiRateLimit(request, viewer?.id, {
    endpoint: '/api/daily-messages/[messageId]/comments:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const { messageId } = await context.params
  const comments = await prisma.dailyMessageComment.findMany({
    where: { messageId, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    take: COMMENT_PAGE_SIZE,
    select: {
      id: true,
      parentId: true,
      content: true,
      moderationStatus: true,
      ipRegion: true,
      createdAt: true,
      updatedAt: true,
      User: { select: commentUserSelect },
    },
  })

  const equippedBadgeMap = await getEquippedBadgesForUsers(comments.map((comment) => comment.User.id))
  return NextResponse.json({ comments: comments.map((comment) => serializeComment(comment, equippedBadgeMap.get(comment.User.id) || null)) }, { headers: viewer ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]/comments:POST',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (limited) return limited

  const ipLocation = await resolveIpLocation(request)
  const ipRegion = ipLocation?.label || null
  void updateUserIpRegion(guard.user.id, ipLocation)
  const { messageId } = await context.params
  const body = await request.json().catch(() => null)
  const content = sanitizeText(body?.content, 300)
  const parentId = sanitizeText(body?.parentId, 80)

  if (!content) {
    return NextResponse.json({ message: '评论内容不能为空' }, { status: 400 })
  }
  if ((await checkBannedWords(content)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }

  let parentComment: { id: string; authorId: string; messageId: string } | null = null
  if (parentId) {
    parentComment = await prisma.dailyMessageComment.findFirst({
      where: { id: parentId, messageId, isDeleted: false },
      select: { id: true, authorId: true, messageId: true },
    })
    if (!parentComment) {
      return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 400 })
    }
  }

  let notifiedUserId: string | null = null
  let notificationData: Prisma.NotificationCreateArgs | null = null
  const comment = await prisma.$transaction(async (tx) => {
    const dailyMessage = await tx.dailyMessage.findUnique({
      where: { id: messageId },
      select: { userId: true, date: true },
    })
    if (!dailyMessage) throw new Error('message not found')

    const created = await tx.dailyMessageComment.create({
      data: {
        messageId,
        authorId: guard.user.id,
        content,
        ipRegion,
        parentId: parentId || null,
      },
      include: { User: { select: commentUserSelect } },
    })

    await tx.dailyMessage.update({
      where: { id: messageId },
      data: { commentCount: { increment: 1 } },
    })

    const recipientId = parentComment?.authorId || dailyMessage.userId
    if (recipientId !== guard.user.id) {
      notifiedUserId = recipientId
      notificationData = {
        data: {
          recipientId,
          actorId: guard.user.id,
          type: 'REPLY',
          title: parentComment ? '有人回复了你的评论' : '你的每日留言有新评论',
          content: parentComment
            ? `${guard.user.nickname} 回复了你的评论`
            : `${guard.user.nickname} 评论了你的挂号留言`,
          link: `/checkin?date=${formatBeijingDate(dailyMessage.date)}&message=${messageId}&focus=${created.id}`,
        },
      }
    }

    return created
  }, { timeout: 15_000, maxWait: 5_000 })

  const committedNotificationData = notificationData as Prisma.NotificationCreateArgs | null
  if (committedNotificationData) {
    await safeNotificationWrite(
      () => createNotification(committedNotificationData),
      { operation: 'daily-message-comment-notification', userId: committedNotificationData.data.recipientId, notificationType: 'REPLY' },
    )
  }
  if (notifiedUserId) emitRealtime(notifiedUserId, 'notification')
  const equippedBadge = await getEquippedBadgesForUsers([guard.user.id])
  return NextResponse.json({
    comment: serializeComment(comment, equippedBadge.get(guard.user.id) || null),
  }, { status: 201 })
}
