import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { awardExperience } from '@/lib/growth'
import { POINTS } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'
import { appendContentImages, parseContentImageUrls } from '@/lib/content-images'
import { getShanghaiDateKey } from '@/lib/checkin'

type Params = { params: Promise<{ postId: string }> }

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

  if (textContent.length < 2 && imageUrls.length === 0) {
    return NextResponse.json({ message: '回复内容至少需要 2 个字符', errors: { content: '回复太短了' } }, { status: 400 })
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true, authorId: true },
  })
  if (!post) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })

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
      return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 400 })
    }
  }

  const reply = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`
    const currentUser = await tx.user.findFirstOrThrow({
      where: { id: user.id, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { points: true },
    })
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
    const rewardPoints = rewardedToday < POINTS.dailyPostCommentLimit ? POINTS.dailyPostComment : 0
    if (rewardPoints) {
      await tx.pointLog.create({ data: {
        userId: user.id,
        action: 'POST_COMMENT_DAILY',
        points: rewardPoints,
        before: currentUser.points,
        after: currentUser.points + rewardPoints,
        postId,
        replyId: createdReply.id,
        dateKey,
        businessKey: `post-comment:${createdReply.id}`,
        reason: '每日评论奖励',
      } })
      await tx.user.update({ where: { id: user.id }, data: { points: { increment: rewardPoints } } })
    }

    const recipientId = parentReply?.authorId || post.authorId
    if (recipientId !== user.id) {
      await tx.notification.create({
        data: {
          recipientId,
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

    return { createdReply, rewardPoints }
  })

  return NextResponse.json({ reply: reply.createdReply, rewardPoints: reply.rewardPoints }, { status: 201 })
}
