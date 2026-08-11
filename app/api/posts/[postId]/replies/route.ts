import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { awardCommunityCommentRewards } from '@/lib/community-rewards'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'
import { checkForbiddenWords } from '@/lib/content-filter'
import { appendContentImages, parseContentImageUrls } from '@/lib/content-images'
import { isStickerVisible, recordStickerUsage } from '@/lib/sticker-center'

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
  const stickerId = body?.stickerId ? String(body.stickerId).trim() : ''

  // 表情可见性校验：仅校验，不在此分支创建回复。
  // 文字 / 图片 / 表情统一在下方创建，确保「文字 + 表情」合并为同一条回复（不拆成两条、不新建楼层），
  // 且楼中楼表情回复会进入对应的 reply thread（parentId 由下方逻辑统一处理）。
  if (stickerId && !(await isStickerVisible(stickerId))) {
    return NextResponse.json({ message: '该表情不可用或已被隐藏' }, { status: 400 })
  }

  const textContent = sanitizeText(body?.content, 5000)
  const imageUrls = parseContentImageUrls(body?.imageUrls)
  const content = appendContentImages(textContent, imageUrls)
  if (checkForbiddenWords(content).blocked || await containsSensitiveContent(content)) {
    return NextResponse.json({ message: '回复包含违禁词，无法发布' }, { status: 400 })
  }
  const parentId = sanitizeText(body?.parentId, 80)
  const parsedMentions = parseMentions(body?.mentions, textContent, user.id)
  if ('error' in parsedMentions) {
    return NextResponse.json({ message: parsedMentions.error }, { status: 400 })
  }
  const requestedMentions = parsedMentions.mentions

  if (textContent.length < 2 && imageUrls.length === 0 && !stickerId) {
    return NextResponse.json({ message: '回复内容至少需要 2 个字符', errors: { content: '回复太短了' } }, { status: 400 })
  }

  const post = await prisma.post.findFirst({
    where: {
      ...publicPostWhere,
      id: postId,
      isLocked: false,
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
    for (const userId of [...new Set([user.id, post.authorId])].sort()) {
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`
    }
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
        stickerId: stickerId || null,
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
        stickerId: stickerId || null,
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
        sticker: { select: { url: true } },
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
    await tx.friendActivity.create({ data: { actorId: user.id, type: 'COMMENT', content: stickerId ? '[表情]' : textContent, targetUrl: `/posts/${postId}?focus=${createdReply.id}` } })

    const communityReward = await awardCommunityCommentRewards(tx, {
      commentId: createdReply.id,
      postId,
      commenterId: user.id,
      postAuthorId: post.authorId,
    })

    return {
      createdReply,
      rewardPoints: communityReward.commenterRewardPoints,
    }
  })

  if ('duplicateReplyId' in reply) {
    return NextResponse.json({
      message: '相同回复正在处理中，请勿重复提交',
      replyId: reply.duplicateReplyId,
    }, { status: 409 })
  }

  const { createdReply, rewardPoints } = reply
  const { User: replyAuthor, sticker: replySticker, ...serializedReply } = createdReply
  const mentionUserById = new Map(mentionedFriends.map((friend) => [friend.id, friend]))
  const remarkMap = await loadFriendRemarkMap(user.id, mentionedFriends.map((friend) => friend.id))

  if (stickerId) {
    await recordStickerUsage(user.id, stickerId)
  }

  return NextResponse.json({
    success: true,
    reply: {
      ...serializedReply,
      stickerId: createdReply.stickerId || null,
      stickerUrl: replySticker?.url ?? null,
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
            name: resolveFriendDisplayName({
              viewerId: user.id,
              targetUserId: friend.id,
              fallbackName: getPublicUserDisplayName(friend),
              remarkMap,
            }),
          },
        }]
      }),
    },
    rewardPoints,
  }, { status: 201 })
}
