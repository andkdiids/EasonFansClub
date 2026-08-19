import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { requireUser, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords, publicModerationText } from '@/lib/content-moderation'
import { formatBeijingDate } from '@/lib/checkin'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'

type RouteContext = { params: Promise<{ messageId: string }> }

const COMMENT_PAGE_SIZE = 80

export async function GET(_request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  const { messageId } = await context.params
  const comments = await prisma.dailyMessageComment.findMany({
    where: { messageId, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    take: COMMENT_PAGE_SIZE,
    include: {
      User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, level: true, Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } } } },
    },
  })

  const remarkMap = await loadFriendRemarkMap(viewer?.id, comments.map((comment) => comment.User.id))
  return NextResponse.json({ comments: comments.map((comment) => ({
    ...comment,
    content: publicModerationText(comment.content, comment.moderationStatus),
    User: comment.User.Profile ? {
      ...comment.User,
      nickname: getPublicUserDisplayName(comment.User),
      avatarUrl: publicImageUrl(comment.User.avatarUrl),
      Profile: {
        ...comment.User.Profile,
        avatarUrl: publicImageUrl(comment.User.Profile.avatarUrl),
        displayName: resolveFriendDisplayName({
          viewerId: viewer?.id,
          targetUserId: comment.User.id,
          fallbackName: getPublicUserDisplayName(comment.User),
          remarkMap,
        }),
      },
    } : comment.User,
  })) }, { headers: viewer ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

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
      include: { User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, level: true, Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } } } } },
    })

    await tx.dailyMessage.update({
      where: { id: messageId },
      data: { commentCount: { increment: 1 } },
    })

    const recipientId = parentComment?.authorId || dailyMessage.userId
    if (recipientId !== guard.user.id) {
      notifiedUserId = recipientId
      await tx.notification.create({
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
      })
    }

    return created
  })

  if (notifiedUserId) emitRealtime(notifiedUserId, 'notification')
  return NextResponse.json({
    comment: {
      ...comment,
      content: publicModerationText(comment.content, comment.moderationStatus),
      User: comment.User.Profile ? {
        ...comment.User,
        nickname: getPublicUserDisplayName(comment.User),
        avatarUrl: publicImageUrl(comment.User.avatarUrl),
        Profile: { ...comment.User.Profile, avatarUrl: publicImageUrl(comment.User.Profile.avatarUrl) },
      } : { ...comment.User, nickname: getPublicUserDisplayName(comment.User), avatarUrl: publicImageUrl(comment.User.avatarUrl) },
    },
  }, { status: 201 })
}
