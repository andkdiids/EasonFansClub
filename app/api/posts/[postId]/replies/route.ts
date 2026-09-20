import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { awardCommunityCommentRewards } from '@/lib/community-rewards'
import { publicContentImageMarkers } from '@/lib/content-images'
import { publicImageUrl } from '@/lib/images'
import { parsePostReplyDirection, parsePostReplySort, getPostReplyOrderBy, getPostReplyOffset, getPostReplyTotalPages, POST_REPLY_PAGE_SIZE } from '@/lib/post-replies'
import { buildPublicPostWhere as publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { enforceApiRateLimit, requireRequestUser, resolveRequestAuth, sanitizeText } from '@/lib/security'
import { publicModerationText } from '@/lib/content-moderation'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { appendContentImages, parseContentImageUrls } from '@/lib/content-images'
import { isStickerVisible, recordStickerUsage } from '@/lib/sticker-center'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createManyNotifications } from '@/lib/notification-write'
import { allocatePostCommentFloor } from '@/lib/post-comment-floor'
import { getReplyLengthMetrics, replyTooLongPayload } from '@/lib/reply-length'
import { completeTask, resolveAndGrantWeeklyMilestonesInTransaction } from '@/lib/growth-tasks/service'
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
    if (!mention.userId || !Number.isInteger(mention.startIndex) || !Number.isInteger(mention.endIndex) || mention.startIndex < 0 || mention.endIndex <= mention.startIndex || mention.endIndex > content.length || !mention.displayText.startsWith('@') || content.slice(mention.startIndex, mention.endIndex) !== mention.displayText) return { error: '提及信息格式不正确' }
    if (mention.userId !== currentUserId && !unique.has(mention.userId)) unique.set(mention.userId, mention)
  }
  const mentions = [...unique.values()]
  return mentions.length > 5 ? { error: '单条内容最多提及 5 位好友' } : { mentions }
}

const replyAuthorSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true, displayName: true, displayNameModerationStatus: true } },
} as const

const replySelect = {
  id: true,
  content: true,
  moderationStatus: true,
  stickerId: true,
  isPinned: true,
  createdAt: true,
  updatedAt: true,
  postId: true,
  authorId: true,
  parentId: true,
  likeCount: true,
  User: { select: replyAuthorSelect },
  sticker: { select: { url: true } },
} as const

type ReplyRecord = Prisma.ReplyGetPayload<{ select: typeof replySelect }>

function serializeReply(reply: ReplyRecord, likedIds: Set<string>) {
  const author = reply.User
  return {
    id: reply.id,
    content: publicModerationText(publicContentImageMarkers(reply.content), reply.moderationStatus),
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    parentId: reply.parentId,
    isPinned: reply.isPinned,
    likeCount: reply.likeCount,
    liked: likedIds.has(reply.id),
    stickerUrl: publicImageUrl(reply.sticker?.url),
    author: author.Profile
      ? {
          ...author,
          nickname: getPublicUserDisplayName(author),
          avatarUrl: publicImageUrl(author.avatarUrl),
          Profile: { ...author.Profile, avatarUrl: publicImageUrl(author.Profile.avatarUrl), displayName: getPublicUserDisplayName(author) },
        }
      : { ...author, nickname: getPublicUserDisplayName(author), avatarUrl: publicImageUrl(author.avatarUrl) },
  }
}

type SerializedReply = ReturnType<typeof serializeReply>

export async function GET(request: Request, { params }: Params) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const viewer = auth.user
  const { postId } = await params
  const searchParams = new URL(request.url).searchParams
  const sort = parsePostReplySort(searchParams.get('sort'))
  const direction = parsePostReplyDirection(searchParams.get('direction'), searchParams.get('sort'))
  const pageSize = Math.min(POST_REPLY_PAGE_SIZE, Math.max(1, Number(searchParams.get('pageSize')) || POST_REPLY_PAGE_SIZE))
  const page = Math.max(1, Number(searchParams.get('page')) || 1)

  const post = await prisma.post.findFirst({
    where: { ...publicPostWhere(), id: postId },
    select: { id: true },
  })
  if (!post) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })

  const rootWhere = {
    postId,
    parentId: null,
    isPinned: false,
    isDeleted: false,
    User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } },
  }
  const total = await prisma.reply.count({ where: rootWhere })
  const totalPages = getPostReplyTotalPages(total, pageSize)
  const safePage = Math.min(page, totalPages)
  const [pinned, roots] = await Promise.all([
    prisma.reply.findFirst({
      where: { ...rootWhere, isPinned: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: replySelect,
    }),
    prisma.reply.findMany({
      where: rootWhere,
      orderBy: getPostReplyOrderBy(sort, direction),
      skip: getPostReplyOffset(safePage, pageSize),
      take: pageSize,
      select: replySelect,
    }),
  ])

  const rootIds = roots.map((reply) => reply.id)
  const children = rootIds.length
    ? await prisma.reply.findMany({
        where: {
          postId,
          parentId: { in: rootIds },
          isDeleted: false,
          User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: Math.min(200, rootIds.length * 10),
        select: replySelect,
      })
    : []
  const allReplies = [...(pinned ? [pinned] : []), ...roots, ...children]
  const likedIds = viewer && allReplies.length
    ? new Set((await prisma.replyLike.findMany({ where: { userId: viewer.id, replyId: { in: allReplies.map((reply) => reply.id) } }, select: { replyId: true } })).map((like) => like.replyId))
    : new Set<string>()
  const childrenByParent = new Map<string, SerializedReply[]>()
  for (const child of children) {
    const list = childrenByParent.get(child.parentId || '') || []
    list.push(serializeReply(child, likedIds))
    childrenByParent.set(child.parentId || '', list)
  }
  const serializeRoot = (reply: ReplyRecord) => ({
    ...serializeReply(reply, likedIds),
    replies: childrenByParent.get(reply.id) || [],
  })

  return NextResponse.json({
    replies: roots.map(serializeRoot),
    pinned: pinned ? serializeRoot(pinned) : null,
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasMore: safePage < totalPages,
    sort,
    direction,
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}

export async function POST(request: Request, { params }: Params) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const user = guard.user
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/posts/replies',
    ip: { limit: 120, windowSeconds: 10 * 60 },
    user: { limit: 20, windowSeconds: 10 * 60 },
  }, '评论过于频繁，请稍后再试')
  if (limited) return limited

  const ipLocation = await resolveIpLocation(request)
  const ipRegion = ipLocation?.label || null
  void updateUserIpRegion(user.id, ipLocation)
  const { postId } = await params
  const body = await request.json().catch(() => null)
  const stickerId = body?.stickerId ? String(body.stickerId).trim() : ''
  if (stickerId && !(await isStickerVisible(stickerId))) return NextResponse.json({ message: '该表情不可用或已被隐藏' }, { status: 400 })

  const textLength = getReplyLengthMetrics(body?.content)
  if (textLength.exceededBy > 0) return NextResponse.json({ ok: false, ...replyTooLongPayload(textLength) }, { status: 400 })
  const textContent = textLength.content
  const imageUrls = parseContentImageUrls(body?.imageUrls)
  const content = appendContentImages(textContent, imageUrls)
  if ((await checkBannedWords(content)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  const parentId = sanitizeText(body?.parentId, 80)
  const parsedMentions = parseMentions(body?.mentions, textContent, user.id)
  if ('error' in parsedMentions) return NextResponse.json({ message: parsedMentions.error }, { status: 400 })
  const requestedMentions = parsedMentions.mentions
  if (textLength.actualLength < 2 && imageUrls.length === 0 && !stickerId) return NextResponse.json({ message: '回复内容至少需要 2 个字符', errors: { content: '回复太短了' } }, { status: 400 })

  const post = await prisma.post.findFirst({
    where: { ...publicPostWhere(), id: postId, isLocked: false, Board: { isActive: true } },
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
    prisma.block.findMany({ where: { OR: [{ blockerId: user.id, blockedId: { in: mentionIds } }, { blockedId: user.id, blockerId: { in: mentionIds } }] }, select: { blockerId: true, blockedId: true } }),
  ]) : [[], []]
  const mentionedFriends = friendships.map((row) => row.userAId === user.id ? row.User_Friendship_userBIdToUser : row.User_Friendship_userAIdToUser)
  const allowedMentionIds = new Set(mentionedFriends.map((item) => item.id))
  if (blockedUsers.length || mentionIds.some((id) => !allowedMentionIds.has(id))) return NextResponse.json({ message: '只能提及当前有效好友' }, { status: 403 })

  let parentReply: { id: string; authorId: string; parentId: string | null; author: { nickname: string; profile: { displayName: string | null } | null } } | null = null
  if (parentId) {
    const parentRow = await prisma.reply.findFirst({
      where: { id: parentId, postId, isDeleted: false },
      select: { id: true, authorId: true, parentId: true, User: { select: { nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } } },
    })
    parentReply = parentRow ? { id: parentRow.id, authorId: parentRow.authorId, parentId: parentRow.parentId, author: { nickname: getPublicUserDisplayName(parentRow.User), profile: parentRow.User.Profile } } : null
    if (!parentReply) return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 409 })
  }

  const replyRecipientId = parentReply?.authorId || post.authorId
  const now = new Date()
  const reply = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const currentPost = await tx.post.findFirst({ where: { ...publicPostWhere(), id: postId, isLocked: false, Board: { isActive: true } }, select: { id: true, authorId: true } })
    if (!currentPost) return { unavailable: true as const }
    for (const userId of [...new Set([user.id, post.authorId])].sort()) await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`
    await tx.user.findFirstOrThrow({ where: { id: user.id, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }, select: { id: true } })
    const duplicateReply = await tx.reply.findFirst({ where: { postId, authorId: user.id, parentId: parentId || null, content, stickerId: stickerId || null, isDeleted: false, createdAt: { gte: new Date(Date.now() - 8_000) } }, select: { id: true } })
    if (duplicateReply) return { duplicateReplyId: duplicateReply.id }
    const floorNumber = parentId ? null : await allocatePostCommentFloor(tx, postId)
    const createdReply = await tx.reply.create({
      data: { postId, authorId: user.id, content, ipRegion, stickerId: stickerId || null, parentId: parentId || null, floorNumber },
      include: { User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, level: true, avatarUrl: true, Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } } }, }, sticker: { select: { url: true } } },
    })
    if (requestedMentions.length) await tx.replyMention.createMany({ data: requestedMentions.map((mention) => ({ replyId: createdReply.id, mentionerId: user.id, mentionedUserId: mention.userId, startIndex: mention.startIndex, endIndex: mention.endIndex, displayText: mention.displayText })) })
    await tx.post.update({ where: { id: postId }, data: { replyCount: { increment: 1 } }, select: { id: true } })
    await tx.friendActivity.create({ data: { actorId: user.id, type: 'COMMENT', content: stickerId ? '[表情]' : textContent, targetUrl: `/posts/${postId}?focus=${createdReply.id}` } })
    const communityReward = await awardCommunityCommentRewards(tx, { commentId: createdReply.id, postId, commenterId: user.id, postAuthorId: post.authorId, now })
    await completeTask(tx, { userId: user.id, taskCode: 'DAILY_COMMENT', periodKey: getShanghaiDateKey(now), sourceEventId: createdReply.id, now })
    const weeklyMilestones = await resolveAndGrantWeeklyMilestonesInTransaction(tx, user.id, now)
    if (user.id !== post.authorId) {
      await completeTask(tx, { userId: user.id, taskCode: 'FIRST_COMMENT', periodKey: 'ALL', sourceEventId: createdReply.id })
      await completeTask(tx, { userId: post.authorId, taskCode: 'FIRST_RECEIVED_COMMENT', periodKey: 'ALL', sourceEventId: createdReply.id })
    }
    return { createdReply, floorNumber, rewardPoints: communityReward.commenterRewardPoints, weeklyMilestoneRewards: weeklyMilestones.rewards, points: weeklyMilestones.balance, notificationRecipientIds: [...requestedMentions.map((mention) => mention.userId), ...(replyRecipientId !== user.id && !allowedMentionIds.has(replyRecipientId) ? [replyRecipientId] : [])] }
  }, { timeout: 15_000, maxWait: 5_000 })

  if ('unavailable' in reply) return NextResponse.json({ message: '帖子不存在或当前不允许回复' }, { status: 404 })
  if ('duplicateReplyId' in reply) return NextResponse.json({ message: '相同回复正在处理中，请勿重复提交', replyId: reply.duplicateReplyId }, { status: 409 })

  const { createdReply, floorNumber, rewardPoints, weeklyMilestoneRewards, points } = reply
  const notificationData = [
    ...requestedMentions.map((mention) => ({ recipientId: mention.userId, actorId: user.id, type: 'REPLY' as const, title: `${user.nickname}在回复中提到了你`, content: `${user.nickname}在回复中提到了你`, link: `/posts/${postId}?focus=${createdReply.id}`, key: `reply-mention:${createdReply.id}:${mention.userId}` })),
    ...(replyRecipientId !== user.id && !allowedMentionIds.has(replyRecipientId) ? [{ recipientId: replyRecipientId, actorId: user.id, type: 'REPLY' as const, title: parentReply ? '有人回复了你的评论' : '你的帖子有新回复', content: parentReply ? `${user.nickname} 回复了你的评论` : `${user.nickname} 回复了你的帖子`, link: `/posts/${postId}?focus=${createdReply.id}` }] : []),
  ]
  if (notificationData.length) await safeNotificationWrite(() => createManyNotifications({ data: notificationData, skipDuplicates: true }), { operation: 'post-reply-notifications', userId: user.id, notificationType: 'REPLY' })
  emitRealtimeMany(reply.notificationRecipientIds, 'notification')
  const { User: replyAuthor, sticker: replySticker, ...serializedReply } = createdReply
  const mentionUserById = new Map(mentionedFriends.map((friend) => [friend.id, friend]))
  if (stickerId) await recordStickerUsage(user.id, stickerId)

  return NextResponse.json({
    success: true,
    reply: {
      ...serializedReply,
      content: publicContentImageMarkers(serializedReply.content),
      floorNumber,
      stickerId: createdReply.stickerId || null,
      stickerUrl: publicImageUrl(replySticker?.url),
      createdAt: serializedReply.createdAt.toISOString(),
      updatedAt: serializedReply.updatedAt.toISOString(),
      author: { ...replyAuthor, nickname: getPublicUserDisplayName(replyAuthor), avatarUrl: publicImageUrl(replyAuthor.avatarUrl), profile: replyAuthor.Profile ? { ...replyAuthor.Profile, avatarUrl: publicImageUrl(replyAuthor.Profile.avatarUrl) } : null, Profile: undefined },
      mentions: requestedMentions.flatMap((mention) => {
        const friend = mentionUserById.get(mention.userId)
        if (!friend) return []
        return [{ id: `${createdReply.id}:${friend.id}`, startIndex: mention.startIndex, endIndex: mention.endIndex, user: { id: friend.id, uid: friend.uid, name: getPublicUserDisplayName(friend) } }]
      }),
    },
    rewardPoints,
    weeklyMilestoneRewards,
    points,
  }, { status: 201 })
}
