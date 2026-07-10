import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { POINTS, calcLevel } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, sanitizeText } from '@/lib/security'

function stripUnsafeHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const boardSlug = searchParams.get('board')
  const take = Math.min(Number(searchParams.get('take') || 20), 50)

  const posts = await prisma.post.findMany({
    where: {
      isDeleted: false,
      status: 'PUBLISHED',
      author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      ...(boardSlug ? { board: { slug: boardSlug } } : {}),
    },
    orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
    take,
    include: {
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

  return NextResponse.json({ posts })
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

  const board = await prisma.board.findFirst({
    where: { id: input.boardId, isActive: true },
    select: { id: true },
  })
  if (!board) {
    return NextResponse.json({ message: '板块不存在或已停用', errors: { boardId: '板块无效' } }, { status: 404 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findFirstOrThrow({
      where: { id: user.id, status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      select: { points: true, exp: true },
    })
    const nextPoints = currentUser.points + POINTS.postCreate
    const nextExp = currentUser.exp + POINTS.postCreate

    const post = await tx.post.create({
      data: {
        boardId: input.boardId,
        authorId: user.id,
        title: input.title,
        content: input.content,
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
        exp: nextExp,
        level: calcLevel(nextPoints + nextExp),
      },
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

  return NextResponse.json({ post: result }, { status: 201 })
}
