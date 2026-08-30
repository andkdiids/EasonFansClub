import { NextResponse } from 'next/server'
import { normalizeForumBoards } from '@/lib/boards'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const boards = await prisma.board.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      coverUrl: true,
      sortOrder: true,
      postCount: true,
      followerCount: true,
      isHot: true,
      isRecommended: true,
      categoryId: true,
      parentId: true,
    },
  })

  return NextResponse.json(
    { boards: normalizeForumBoards(boards).map((board) => ({ ...board, coverUrl: publicImageUrl(board.coverUrl) })) },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' } },
  )
}
