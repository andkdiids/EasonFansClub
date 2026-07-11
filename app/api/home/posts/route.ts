import { NextResponse } from 'next/server'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const posts = await safeDb(
    'home.posts',
    prisma.post.findMany({
      where: {
        isDeleted: false,
        status: 'PUBLISHED',
        author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      },
      orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { replyCount: 'desc' }],
      take: 6,
      select: {
        id: true,
        title: true,
        content: true,
        likeCount: true,
        replyCount: true,
        viewCount: true,
        isPinned: true,
        isFeatured: true,
        createdAt: true,
        board: { select: { name: true, slug: true } },
        author: {
          select: {
            uid: true,
            nickname: true,
            level: true,
            avatarUrl: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    }),
    [],
  )

  return NextResponse.json({ posts })
}
