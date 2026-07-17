import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { clampForumPage, excerptForumPost, getForumTotalPages, parseForumSort } from '@/lib/forum'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  const { searchParams } = new URL(request.url)
  const boardValue = sanitizeText(searchParams.get('board'), 80)
  const query = sanitizeText(searchParams.get('query'), 100)
  const sort = parseForumSort(searchParams.get('sort'))
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const pageSize = Math.min(40, Math.max(5, Number.parseInt(searchParams.get('pageSize') || '20', 10) || 20))

  const boards = await prisma.board.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: { id: true, name: true, slug: true, description: true, postCount: true },
  })
  const selectedBoard = boardValue
    ? boards.find((board) => board.slug === boardValue || board.id === boardValue) || null
    : null

  const where: Prisma.PostWhereInput = {
    isDeleted: false,
    status: 'PUBLISHED',
    author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
    ...(selectedBoard ? { boardId: selectedBoard.id } : { board: { isActive: true } }),
    ...(sort === 'featured' ? { isFeatured: true } : {}),
    ...(sort === 'pinned' ? { isPinned: true } : {}),
    ...(query ? { OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { summary: { contains: query, mode: 'insensitive' } },
    ] } : {}),
  }
  const orderBy: Prisma.PostOrderByWithRelationInput[] = sort === 'latest-reply'
    ? [{ isPinned: 'desc' }, { updatedAt: 'desc' }]
    : sort === 'most-replies'
      ? [{ replyCount: 'desc' }, { createdAt: 'desc' }]
      : sort === 'featured'
        ? [{ createdAt: 'desc' }]
        : sort === 'pinned'
          ? [{ createdAt: 'desc' }]
          : [{ isPinned: 'desc' }, { createdAt: 'desc' }]

  const { total, totalPages, page, rows } = await prisma.$transaction(async (tx) => {
    const total = await tx.post.count({ where })
    const totalPages = getForumTotalPages(total, pageSize)
    const page = clampForumPage(requestedPage, totalPages)
    const rows = await tx.post.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, title: true, summary: true, content: true,
        likeCount: true, replyCount: true, viewCount: true,
        isPinned: true, isFeatured: true, createdAt: true, updatedAt: true,
        board: { select: { name: true, slug: true } },
        author: { select: { uid: true, nickname: true, avatarUrl: true, level: true, profile: { select: { displayName: true, avatarUrl: true } } } },
        likes: { where: { userId: user?.id || '__anonymous__' }, select: { id: true }, take: 1 },
      },
    })
    return { total, totalPages, page, rows }
  })

  const announcement = selectedBoard?.slug === 'announcements'
  const canCreateAnnouncement = Boolean(user && await hasAdminPermission(user, 'post_manage'))
  return NextResponse.json({
    boards: boards.map((board) => ({ ...board, isAnnouncement: board.slug === 'announcements' })),
    selectedBoard: selectedBoard ? { ...selectedBoard, isAnnouncement: announcement } : null,
    posts: rows.map(({ summary, content, likes, ...post }) => ({
      ...post,
      content: excerptForumPost(summary || content),
      likedByMe: likes.length > 0,
    })),
    pagination: { page, pageSize, total, totalPages, hasMore: page < totalPages },
    permissions: {
      canCreatePost: Boolean(user && (!announcement || canCreateAnnouncement)),
      canCreateAnnouncement,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
