import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { isConfiguredForumBoardId, mergeForumBoardSummaries, normalizeForumBoards, withForumBoardDisplayName } from '@/lib/boards'
import { clampForumPage, getForumOffset, getForumTotalPages, parseForumSort } from '@/lib/forum'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'
import { sanitizeText } from '@/lib/security'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  const { searchParams } = new URL(request.url)
  const boardValue = sanitizeText(searchParams.get('board'), 80)
  const query = sanitizeText(searchParams.get('query'), 100)
  const sort = parseForumSort(searchParams.get('sort'))
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const pageSize = Math.min(40, Math.max(5, Number.parseInt(searchParams.get('pageSize') || '20', 10) || 20))

  const boardRows = await prisma.board.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: { id: true, name: true, slug: true, description: true, postCount: true },
  })
  const boards = mergeForumBoardSummaries(boardRows)
  const selectedBoard = boardValue
    ? boards.find((board) => board.slug === boardValue || board.id === boardValue) || null
    : null
  const publicBoards = normalizeForumBoards(boards)
  const publicSelectedBoard = selectedBoard ? withForumBoardDisplayName(selectedBoard) : null

  const boardWhere: Prisma.PostWhereInput = selectedBoard
    ? isConfiguredForumBoardId(selectedBoard.id)
      ? { Board: { isActive: true, slug: selectedBoard.slug } }
      : { boardId: selectedBoard.id }
    : { Board: { isActive: true } }
  const where: Prisma.PostWhereInput = {
    ...publicPostWhere,
    User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    ...boardWhere,
    ...(sort === 'featured' ? { isFeatured: true } : {}),
    ...(sort === 'pinned' ? { isPinned: true } : {}),
    ...(query ? { OR: [
      { title: { contains: query } },
      { summary: { contains: query } },
    ] } : {}),
  }
  const orderBy: Prisma.PostOrderByWithRelationInput[] = sort === 'latest-reply'
    ? [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { updatedAt: 'desc' }]
    : sort === 'most-replies'
      ? [{ replyCount: 'desc' }, { createdAt: 'desc' }]
      : sort === 'featured'
        ? [{ isPinned: 'desc' }, { createdAt: 'desc' }]
        : sort === 'pinned'
          ? [{ createdAt: 'desc' }]
          : [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }]

  const { total, totalPages, page, rows } = await prisma.$transaction(async (tx) => {
    const total = await tx.post.count({ where })
    const totalPages = getForumTotalPages(total, pageSize)
    const page = clampForumPage(requestedPage, totalPages)
    const rows = await tx.post.findMany({
      where,
      orderBy,
      skip: getForumOffset(page, pageSize),
      take: pageSize,
      select: {
        id: true, title: true, moderationStatus: true,
        ipRegion: true,
        likeCount: true, replyCount: true, viewCount: true,
        isPinned: true, isFeatured: true, createdAt: true, updatedAt: true,
        Board: { select: { name: true, slug: true } },
        User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, level: true, Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } } } },
        Like: { where: { userId: user?.id || '__anonymous__' }, select: { id: true }, take: 1 },
      },
    })
    return { total, totalPages, page, rows }
  })

  const announcement = selectedBoard?.slug === 'announcements'
  const canCreateAnnouncement = Boolean(user && await hasAdminPermission(user, 'post_manage'))
  const equippedBadgeMap = await getEquippedBadgesForUsers(rows.map((row) => row.User.id))
  return NextResponse.json({
    boards: publicBoards.map((board) => ({ ...board, isAnnouncement: board.slug === 'announcements' })),
    selectedBoard: publicSelectedBoard ? { ...publicSelectedBoard, isAnnouncement: announcement } : null,
    posts: rows.map(({ Like, User, Board, ...post }) => ({
      ...post,
      title: publicModerationText(post.title, post.moderationStatus),
      author: {
        ...User,
        nickname: getPublicUserDisplayName(User),
        equippedBadge: equippedBadgeMap.get(User.id) || null,
        avatarUrl: publicImageUrl(User.avatarUrl),
        profile: User.Profile ? {
          ...User.Profile,
          avatarUrl: publicImageUrl(User.Profile.avatarUrl),
          displayName: getPublicUserDisplayName(User),
        } : User.Profile,
      },
      board: withForumBoardDisplayName(Board),
      likedByMe: Like.length > 0,
    })),
    total,
    totalPages,
    page,
    pagination: { page, pageSize, total, totalPages, hasMore: page < totalPages },
    permissions: {
      canCreatePost: Boolean(user && (!announcement || canCreateAnnouncement)),
      canCreateAnnouncement,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
