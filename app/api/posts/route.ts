import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission, isAdminUser } from '@/lib/admin-permissions'
import { awardExperience } from '@/lib/growth'
import { getRandomPostRegistrationFee, POINTS } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'
import { checkForbiddenWords } from '@/lib/content-filter'
import { parseContentImageUrls } from '@/lib/content-images'
import { getShanghaiDateKey } from '@/lib/checkin'
import { isStickerVisible, recordStickerUsage } from '@/lib/sticker-center'

function stripUnsafeHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function createSummary(content: string, length = 180) {
  return content.length > length ? `${content.slice(0, length)}...` : content
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const boardSlug = searchParams.get('board')
  const page = Math.max(Number(searchParams.get('page') || 1), 1)
  const take = Math.min(Number(searchParams.get('take') || 20), 50)
  const skip = (page - 1) * take

  try {
    const rows = await prisma.post.findMany({
      where: {
        isDeleted: false,
        status: 'PUBLISHED',
        moderationStatus: 'APPROVED',
        User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
        ...(boardSlug ? { Board: { slug: boardSlug } } : {}),
      },
      orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: take + 1,
      select: {
        id: true,
        title: true,
        summary: true,
        content: true,
        likeCount: true,
        favoriteCount: true,
        replyCount: true,
        viewCount: true,
        isPinned: true,
        isFeatured: true,
        createdAt: true,
        User: {
          select: {
            uid: true,
            nickname: true,
            avatarUrl: true,
            level: true,
            Profile: { select: { avatarUrl: true, displayName: true } },
          },
        },
        Board: { select: { name: true, slug: true } },
        sticker: { select: { url: true } },
      },
    })
    const hasMore = rows.length > take
    const pageRows = hasMore ? rows.slice(0, take) : rows
    const posts = pageRows.map(({ summary, content, User, Board, sticker, ...post }) => ({
      ...post,
      author: { ...User, profile: User.Profile },
      board: Board,
      content: summary || createSummary(content),
      stickerUrl: sticker?.url || null,
    }))

    return NextResponse.json(
      { posts, page, hasMore },
      { headers: { 'Cache-Control': 'public, max-age=15, s-maxage=45, stale-while-revalidate=120' } },
    )
  } catch (error) {
    console.error('[posts:list:error]', { boardSlug, page, error })
    return NextResponse.json({ message: '帖子列表暂时无法加载，请稍后重试', posts: [], page, hasMore: false }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ message: '请先登录后再发布帖子' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const rawTitle = sanitizeText(body?.title, 120)
  const rawContent = stripUnsafeHtml(sanitizeText(body?.content, 20000))
  const rawStickerId = typeof body?.stickerId === 'string' && body.stickerId ? String(body.stickerId).trim().slice(0, 191) : null
  if (checkForbiddenWords(`${rawTitle}\n${rawContent}`).blocked) {
    return NextResponse.json({ message: '内容包含不允许使用的词语，请修改后重新提交。' }, { status: 400 })
  }
  if (await containsSensitiveContent(`${rawTitle}\n${rawContent}`)) {
    return NextResponse.json({ message: '帖子包含违禁词，无法发布', errors: { content: '请修改后重新发布' } }, { status: 400 })
  }
  if (rawStickerId && !(await isStickerVisible(rawStickerId))) {
    return NextResponse.json({ message: '该表情不可用或已被隐藏', errors: { stickerId: '表情无效' } }, { status: 400 })
  }
  const input = {
    boardId: sanitizeText(body?.boardId, 80),
    title: rawTitle,
    content: rawContent,
  }
  const imageUrls = parseContentImageUrls(body?.imageUrls)

  const errors: Record<string, string> = {}
  if (!input.boardId) errors.boardId = '请选择板块'
  if (input.title.length < 3) errors.title = '标题至少需要 3 个字符'
  // 纯表情帖（仅发送表情包、无正文）允许发布；其余情况正文至少 5 个字符
  if (!rawStickerId && input.content.length < 5) errors.content = '正文至少需要 5 个字符'

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ message: '请检查帖子内容', errors }, { status: 400 })
  }

  try {
    const board = await prisma.board.findFirst({
      where: { id: input.boardId, isActive: true },
      select: { id: true, slug: true },
    })
    if (!board) {
      return NextResponse.json({ message: '板块不存在或已停用', errors: { boardId: '板块无效' } }, { status: 404 })
    }
    if (board.slug === 'announcements' && !await hasAdminPermission(user, 'post_manage')) {
      return NextResponse.json(
        { message: '只有管理员可以在公告区发布内容', errors: { boardId: '普通用户不能选择公告区' } },
        { status: 403 },
      )
    }

    const canPublishImmediately = isAdminUser(user)
    const moderationStatus = canPublishImmediately ? 'APPROVED' as const : 'PENDING' as const
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`
      await tx.user.findFirstOrThrow({
        where: { id: user.id, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
        select: { id: true },
      })
      const post = await tx.post.create({
        data: {
          boardId: input.boardId,
          authorId: user.id,
          title: input.title,
          content: input.content,
          summary: createSummary(input.content),
          status: 'PUBLISHED',
          moderationStatus,
          stickerId: rawStickerId || undefined,
        },
        select: { id: true, moderationStatus: true },
      })
      if (imageUrls.length) {
        await tx.postMedia.createMany({ data: imageUrls.map((url, sortOrder) => ({ postId: post.id, type: 'IMAGE', url, sortOrder })) })
      }
      if (moderationStatus === 'APPROVED') {
        await tx.friendActivity.create({ data: { actorId: user.id, type: 'POST', content: input.title, targetUrl: `/posts/${post.id}` } })
      }

      if (moderationStatus === 'PENDING') {
        const admins = await tx.user.findMany({
          where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
          select: { id: true },
        })
        if (admins.length) {
          await tx.notification.createMany({
            data: admins.map((admin) => ({
              recipientId: admin.id,
              type: 'ADMIN' as const,
              title: '新帖子待审核',
              content: input.title,
              link: '/admin/posts/review',
              key: `post-review:${post.id}`,
            })),
            skipDuplicates: true,
          })
        }
      }

      if (moderationStatus === 'APPROVED') {
        await tx.board.update({
          where: { id: input.boardId },
          data: { postCount: { increment: 1 } },
        })
      }

      await awardExperience(tx, {
        userId: user.id,
        amount: POINTS.postCreateExperience,
        type: 'POST',
        description: '发布帖子',
      })

      const dateKey = getShanghaiDateKey(new Date())
      const feeAward = await awardRegistrationFee(tx, {
        userId: user.id,
        requestedAmount: getRandomPostRegistrationFee(),
        action: 'POST_DAILY_FIRST',
        reason: '每日首次发帖',
        businessKey: `post-daily:${user.id}:${dateKey}`,
        postId: post.id,
      })

      return { post, rewardPoints: feeAward.awardedAmount }
    })

    if (rawStickerId) {
      await recordStickerUsage(user.id, rawStickerId).catch((usageError) => {
        console.error('[post:sticker:usage]', usageError)
      })
    }

    const detailQuery = result.rewardPoints ? `?reward=${result.rewardPoints}` : ''
    const detailUrl = `/posts/${result.post.id}${detailQuery}`
    await syncUserAchievements(user.id, ['POST']).catch((achievementError) => {
      console.error('[achievements:post]', achievementError)
    })

    return NextResponse.json({
      post: { ...result.post, detailUrl },
      detailUrl,
      rewardPoints: result.rewardPoints,
      moderationStatus,
      message: moderationStatus === 'PENDING' ? '帖子已提交，等待管理员审核后公开' : '帖子发布成功',
    }, { status: 201 })
  } catch (error) {
    console.error('[post:create:error]', { userId: user.id, boardId: input.boardId, error })
    return NextResponse.json({ message: '发布帖子暂时失败，请稍后重试' }, { status: 503 })
  }
}
