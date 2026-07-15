import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { awardExperience } from '@/lib/growth'
import { POINTS } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, isAdminRole, sanitizeText } from '@/lib/security'

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
        author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
        ...(boardSlug ? { board: { slug: boardSlug } } : {}),
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
        author: {
          select: {
            uid: true,
            nickname: true,
            avatarUrl: true,
            level: true,
            profile: { select: { avatarUrl: true, displayName: true } },
          },
        },
        board: { select: { name: true, slug: true } },
      },
    })
    const hasMore = rows.length > take
    const pageRows = hasMore ? rows.slice(0, take) : rows
    const posts = pageRows.map(({ summary, content, ...post }) => ({
      ...post,
      content: summary || createSummary(content),
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
  const input = {
    boardId: sanitizeText(body?.boardId, 80),
    title: sanitizeText(body?.title, 120),
    content: await filterSensitiveWords(stripUnsafeHtml(sanitizeText(body?.content, 20000))),
  }

  const errors: Record<string, string> = {}
  if (!input.boardId) errors.boardId = '请选择板块'
  if (input.title.length < 3) errors.title = '标题至少需要 3 个字符'
  if (input.content.length < 5) errors.content = '正文至少需要 5 个字符'

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
    if (board.slug === 'announcements' && !isAdminRole(user.role)) {
      return NextResponse.json(
        { message: '只有管理员可以在公告区发布内容', errors: { boardId: '普通用户不能选择公告区' } },
        { status: 403 },
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentUser = await tx.user.findFirstOrThrow({
        where: { id: user.id, status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
        select: { points: true },
      })
      const nextPoints = currentUser.points + POINTS.postCreate

      const post = await tx.post.create({
        data: {
          boardId: input.boardId,
          authorId: user.id,
          title: input.title,
          content: input.content,
          summary: createSummary(input.content),
          status: 'PUBLISHED',
        },
        select: { id: true },
      })

      await tx.board.update({
        where: { id: input.boardId },
        data: { postCount: { increment: 1 } },
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          points: nextPoints,
        },
      })

      await awardExperience(tx, {
        userId: user.id,
        amount: POINTS.postCreate,
        type: 'POST',
        description: '发布帖子',
      })

      await tx.pointLog.create({
        data: {
          userId: user.id,
          action: 'POST_CREATE',
          points: POINTS.postCreate,
          before: currentUser.points,
          after: nextPoints,
          postId: post.id,
          reason: '发布帖子',
        },
      })

      return post
    })

    const detailUrl = `/posts/${result.id}`
    console.info('[post:create:success]', { postId: result.id, detailUrl, userId: user.id, boardId: input.boardId })

    await syncUserAchievements(user.id, ['POST']).catch((achievementError) => {
      console.error('[achievements:post]', achievementError)
    })

    return NextResponse.json({ post: { ...result, detailUrl }, detailUrl }, { status: 201 })
  } catch (error) {
    console.error('[post:create:error]', { userId: user.id, boardId: input.boardId, error })
    return NextResponse.json({ message: '发布帖子暂时失败，请稍后重试' }, { status: 503 })
  }
}
