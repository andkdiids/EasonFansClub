import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = sanitizeText(searchParams.get('q'), 60)
  const numericUid = /^\d+$/.test(keyword) ? Number(keyword) : null

  if (!keyword) {
    const hotKeywords = await prisma.searchKeyword.findMany({
      orderBy: [{ count: 'desc' }, { lastUsedAt: 'desc' }],
      take: 10,
    })
    return NextResponse.json({ users: [], posts: [], boards: [], tags: [], hotKeywords })
  }

  const user = await getCurrentUser()
  await prisma.searchKeyword.upsert({
    where: { keyword },
    update: { count: { increment: 1 }, lastUsedAt: new Date() },
    create: { keyword },
  })

  if (user) {
    await prisma.searchHistory.create({ data: { userId: user.id, keyword } })
  }

  const [users, posts, boards, tags] = await Promise.all([
    prisma.user.findMany({
      where: {
        uid: { gt: 0 },
        isDeleted: false,
        status: 'ACTIVE',
        profile: { isNot: null },
        OR: [
          ...(Number.isSafeInteger(numericUid) && Number(numericUid) > 0 ? [{ uid: Number(numericUid) }] : []),
          { nickname: { contains: keyword, mode: 'insensitive' } },
          { username: { contains: keyword, mode: 'insensitive' } },
          { profile: { displayName: { contains: keyword, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true, uid: true, nickname: true, username: true, avatarUrl: true, experience: true, createdAt: true, lastActiveAt: true,
        profile: { select: { displayName: true, avatarUrl: true, bio: true } },
        _count: { select: { posts: { where: { isDeleted: false, status: 'PUBLISHED' } } } },
        posts: { where: { isDeleted: false, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true, createdAt: true } },
      },
      take: 10,
    }),
    prisma.post.findMany({
      where: {
        isDeleted: false,
        status: 'PUBLISHED',
        OR: [
          { title: { contains: keyword, mode: 'insensitive' } },
          { content: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      include: {
        author: { select: { nickname: true, level: true } },
        board: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.board.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { description: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      take: 10,
    }),
    prisma.tag.findMany({
      where: { name: { contains: keyword, mode: 'insensitive' } },
      orderBy: { usageCount: 'desc' },
      take: 10,
    }),
  ])

  return NextResponse.json({ users, posts, boards, tags })
}
