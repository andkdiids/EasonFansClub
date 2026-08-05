import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { awardExperience } from '@/lib/growth'
import { POINTS } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'
import { appendContentImages, parseContentImageUrls } from '@/lib/content-images'
import { getShanghaiDateKey } from '@/lib/checkin'

type Params = { params: Promise<{ postId: string }> }
type MentionInput = { userId: string; startIndex: number; endIndex: number; displayText: string }

function parseMentions(value: unknown, content: string, currentUserId: string) {
  if (!Array.isArray(value)) return { mentions: [] as MentionInput[] }
  const unique = new Map<string, MentionInput>()
  for (const item of value.slice(0, 25)) {
    if (!item || typeof item !== 'object') return { error: '提及信息格式不正确' }
    const source = item as Partial<MentionInput>
    const mention = {
      userId: sanitizeText(source.userId, 80),
      startIndex: Number(source.startIndex),
      endIndex: Number(source.endIndex),
      displayText: sanitizeText(source.displayText, 100),
    }
    if (
      !mention.userId
      || !Number.isInteger(mention.startIndex)
      || !Number.isInteger(mention.endIndex)
      || mention.startIndex < 0
      || mention.endIndex <= mention.startIndex
      || mention.endIndex > content.length
      || !mention.displayText.startsWith('@')
      || content.slice(mention.startIndex, mention.endIndex) !== mention.displayText
    ) return { error: '提及信息格式不正确' }
    if (mention.userId !== currentUserId && !unique.has(mention.userId)) unique.set(mention.userId, mention)
  }
  const mentions = [...unique.values()]
  return mentions.length > 5 ? { error: '单条内容最多提及 5 位好友' } : { mentions }
}

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再回复' }, { status: 401 })

  const { postId } = await params
  const body = await request.json().catch(() => null)
  const textContent = sanitizeText(body?.content, 5000)
  const imageUrls = parseContentImageUrls(body?.imageUrls)
  const content = appendContentImages(textContent, imageUrls)
  if (await containsSensitiveContent(content)) {
    return NextResponse.json({ message: '回复包含违禁词，无法发布' }, { status: 400 })
  }
  const parentId = sanitizeText(body?.parentId, 80)
  const parsedMentions = parseMentions(body?.mentions, textContent, user.id)
  if ('error' in parsedMentions) {
    return NextResponse.json({ message: parsedMentions.error }, { status: 400 })
  }
  const requestedMentions = parsedMentions.mentions

  if (textContent.length < 2 && imageUrls.length === 0) {
    return NextResponse.json({ message: '回复内容至少需要 2 个字符', errors: { content: '回复太短了' } }, { status: 400 })
  }

  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      isDeleted: false,
      isLocked: false,
      status: 'PUBLISHED',
      moderationStatus: 'APPROVED',
      Board: { isActive: true },
    },
    select: { id: true, authorId: true },
  })
  if (!post) return NextResponse.json({ message: '帖子不存在或当前不允许回复' }, { status: 404 })

  const mentionIds = requestedMentions.map((item) => item.userId)
  const [friendships, blockedUsers] = mentionIds.length ? await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: user.id, userBId: { in: mentionIds }, User_Friendship_userBIdToUser: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } },
          { userBId: user.id, userAId: { in: mentionIds }, User_Friendship_userAIdToUser: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } },
        ],
      },
      select: {
        userAId: true,
        userBId: true,
        User_Friendship_userAIdToUser: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
        User_Friendship_userBIdToUser: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
      },
    }),
    prisma.block.findMany({
      where: {
        OR: [
          { blockerId: user.id, blockedId: { in: mentionIds } },
          { blockedId: user.id, blockerId: { in: mentionIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
  ]) : [[], []]
  const mentionedFriends = friendships.map((row) => (
    row.userAId === user.id ? row.User_Friendship_userBIdToUser : row.User_Friendship_userAIdToUser
  ))
  const allowedMentionIds = new Set(mentionedFriends.map((item) => item.id))
  if (blockedUsers.length || mentionIds.some((id) => !allowedMentionIds.has(id))) {
    return NextResponse.json({ message: '只能提及当前有效好友' }, { status: 403 })
  }

  let parentReply: { id: string; authorId: string; parentId: string | null; author: { nickname: string; profile: { displayName: string | null } | null } } | null = null
  if (parentId) {
    const parentRow = await prisma.reply.findFirst({
      where: { id: parentId, postId, isDeleted: false },
      select: {
        id: true,
        authorId: true,
        parentId: true,
        User: { select: { nickname: true, Profile: { select: { displayName: true } } } },
      },
    })
    parentReply = parentRow ? {
      id: parentRow.id,
      authorId: parentRow.authorId,
      parentId: parentRow.parentId,
      author: {
        nickname: parentRow.User.nickname,
        profile: parentRow.User.Profile,
      },
    } : null
    if (!parentReply) {
      return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 409 })
    }
  }

  const reply = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`
    await tx.user.findFirstOrThrow({
      where: { id: user.id, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { id: true },
    })
    const duplicateReply = await tx.reply.findFirst({
      where: {
        postId,
        authorId: user.id,
        parentId: parentId || null,
        content,
        isDeleted: false,
        createdAt: { gte: new Date(Date.now() - 8_000) },
      },
      select: { id: true },
    })
    if (duplicateReply) return { duplicateReplyId: duplicateReply.id }

    const createdReply = await tx.reply.create({
      data: {
        postId,
        authorId: user.id,
        content,
        parentId: parentId || null,
      },
      include: {
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            level: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    })

    if (requestedMentions.length) {
      await tx.replyMention.createMany({
        data: requestedMentions.map((mention) => ({
          replyId: createdReply.id,
          mentionerId: user.id,
          mentionedUserId: mention.userId,
          startIndex: mention.startIndex,
          endIndex: mention.endIndex,
          displayText: mention.displayText,
        })),
      })
      await tx.notification.createMany({
        data: requestedMentions.map((mention) => ({
          recipientId: mention.userId,
          actorId: user.id,
          type: 'REPLY' as const,
          title: `${user.nickname}在回复中提到了你`,
          content: `${user.nickname}在回复中提到了你`,
          link: `/posts/${postId}?focus=${createdReply.id}`,
          key: `reply-mention:${createdReply.id}:${mention.userId}`,
        })),
        skipDuplicates: true,
      })
    }

    const replyRecipientId = parentReply?.authorId || post.authorId
    if (replyRecipientId !== user.id && !allowedMentionIds.has(replyRecipientId)) {
      await tx.notification.create({
        data: {
          recipientId: replyRecipientId,
          actorId: user.id,
          type: 'REPLY',
          title: parentReply ? '有人回复了你的评论' : '你的帖子有新回复',
          content: parentReply
            ? `${user.nickname} 回复了你的评论`
            : `${user.nickname} 回复了你的帖子`,
          link: `/posts/${postId}?focus=${createdReply.id}`,
        },
      })
    }

    await tx.post.update({
      where: { id: postId },
      data: { replyCount: { increment: 1 } },
    })
    await tx.friendActivity.create({ data: { actorId: user.id, type: 'COMMENT', content: textContent, targetUrl: `/posts/${postId}?focus=${createdReply.id}` } })

    await awardExperience(tx, {
      userId: user.id,
      amount: POINTS.replyCreateExperience,
      type: 'COMMENT',
      description: '回复帖子',
    })

    const dateKey = getShanghaiDateKey(new Date())
    const rewardedToday = await tx.pointLog.count({ where: { userId: user.id, action: 'POST_COMMENT_DAILY', dateKey } })
    const feeAward = rewardedToday < POINTS.dailyPostCommentLimit
      ? await awardRegistrationFee(tx, {
        userId: user.id,
        action: 'POST_COMMENT_DAILY',
        requestedAmount: POINTS.dailyPostComment,
        reason: '每日评论奖励',
        postId,
        replyId: createdReply.id,
        businessKey: `post-comment:${createdReply.id}`,
      })
      : null

    return {
      createdReply,
      rewardPoints: feeAward?.awardedAmount || 0,
    }
  })

  if ('duplicateReplyId' in reply) {
    return NextResponse.json({
      message: '相同回复正在处理中，请勿重复提交',
      replyId: reply.duplicateReplyId,
    }, { status: 409 })
  }

  const { createdReply, rewardPoints } = reply
  const { User: replyAuthor, ...serializedReply } = createdReply
  const mentionUserById = new Map(mentionedFriends.map((friend) => [friend.id, friend]))
  return NextResponse.json({
    success: true,
    reply: {
      ...serializedReply,
      createdAt: serializedReply.createdAt.toISOString(),
      updatedAt: serializedReply.updatedAt.toISOString(),
      author: {
        ...replyAuthor,
        profile: replyAuthor.Profile,
        Profile: undefined,
      },
      mentions: requestedMentions.flatMap((mention) => {
        const friend = mentionUserById.get(mention.userId)
        if (!friend) return []
        return [{
          id: `${createdReply.id}:${friend.id}`,
          startIndex: mention.startIndex,
          endIndex: mention.endIndex,
          user: {
            id: friend.id,
            uid: friend.uid,
            name: friend.Profile?.displayName || friend.nickname,
          },
        }]
      }),
    },
    rewardPoints,
  }, { status: 201 })
}
