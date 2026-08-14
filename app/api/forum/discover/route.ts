import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { splitContentImages } from '@/lib/content-images'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageVariantUrl } from '@/lib/image-variants'
import {
  parseForumDiscoveryLimit,
  parseForumDiscoveryMode,
  normalizeDiscoveryIds,
  selectRecommendationRows,
  type ForumDiscoveryMode,
} from '@/lib/forum-discovery'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'
import { sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const DISCOVERY_CANDIDATE_POOL = 60
const DISCOVERY_MAX_SEEN_IDS = 500

function shuffle<T>(rows: T[]) {
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[rows[index], rows[swapIndex]] = [rows[swapIndex], rows[index]]
  }
  return rows
}

function parseCursor(value: unknown) {
  if (typeof value !== 'string' || !value) return null
  const parts = value.split('|')
  const dateValue = parts.length >= 4 ? parts[2] : parts[0]
  const id = parts.length >= 4 ? parts[3] : parts[1]
  if (!dateValue || !id) return null
  const date = new Date(dateValue)
  return Number.isNaN(date.getTime()) ? null : {
    date,
    id: id.slice(0, 80),
    isPinned: parts.length >= 4 ? parts[0] === '1' : undefined,
    isFeatured: parts.length >= 4 ? parts[1] === '1' : undefined,
  }
}

function buildCursor(row: Pick<DiscoveryRow, 'isPinned' | 'isFeatured' | 'createdAt' | 'id'>) {
  return `${row.isPinned ? '1' : '0'}|${row.isFeatured ? '1' : '0'}|${row.createdAt.toISOString()}|${row.id}`
}

function serializePost(row: DiscoveryRow, userId: string | undefined, remarkMap: ReadonlyMap<string, string>) {
  const contentImages = splitContentImages(row.content).images
  const media = row.PostMedia[0]
  const coverSource = contentImages[0] || media?.thumbnail || media?.url || row.sticker?.url || null
  const cover = coverSource ? {
    url: publicImageVariantUrl(coverSource, 'card') || coverSource,
    width: contentImages[0] ? null : media?.width || null,
    height: contentImages[0] ? null : media?.height || null,
  } : null
  return {
    id: row.id,
    title: row.title,
    ipRegion: row.ipRegion,
    likeCount: row.likeCount,
    favoriteCount: row.favoriteCount,
    replyCount: row.replyCount,
    isPinned: row.isPinned,
    isFeatured: row.isFeatured,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    likedByMe: row.Like.length > 0,
    favoritedByMe: row.PostFavorite.length > 0,
    board: row.Board,
    author: {
      id: row.User.id,
      uid: row.User.uid,
      nickname: row.User.nickname,
      displayName: resolveFriendDisplayName({
        viewerId: userId,
        targetUserId: row.User.id,
        fallbackName: getPublicUserDisplayName(row.User),
        remarkMap,
      }),
      avatarUrl: publicImageVariantUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl, 'avatar-sm'),
      level: row.User.level,
    },
    cover,
  }
}

const discoverySelect = {
  id: true,
  title: true,
  content: true,
  ipRegion: true,
  likeCount: true,
  favoriteCount: true,
  replyCount: true,
  isPinned: true,
  isFeatured: true,
  createdAt: true,
  updatedAt: true,
  Board: { select: { name: true, slug: true } },
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      avatarUrl: true,
      level: true,
      Profile: { select: { displayName: true, avatarUrl: true } },
    },
  },
  Like: { select: { id: true } },
  PostFavorite: { select: { id: true } },
  PostMedia: {
    where: { type: 'IMAGE' as const },
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
    select: { url: true, thumbnail: true, width: true, height: true },
  },
  sticker: { select: { url: true } },
} satisfies Prisma.PostSelect

type DiscoveryRow = Prisma.PostGetPayload<{ select: typeof discoverySelect }>

function buildWhere({ boardId, query, excludedPostIds, excludedAuthorIds }: {
  boardId?: string
  query?: string
  excludedPostIds?: string[]
  excludedAuthorIds?: string[]
}): Prisma.PostWhereInput {
  return {
    ...publicPostWhere,
    User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    Board: { isActive: true },
    ...(boardId ? { boardId } : {}),
    ...(query ? { OR: [{ title: { contains: query } }, { summary: { contains: query } }] } : {}),
    ...(excludedPostIds?.length ? { id: { notIn: excludedPostIds } } : {}),
    ...(excludedAuthorIds?.length ? { authorId: { notIn: excludedAuthorIds } } : {}),
  }
}

function hasInvalidDiscoveryIds(value: unknown) {
  if (value === undefined) return false
  if (!Array.isArray(value) || value.length > DISCOVERY_MAX_SEEN_IDS) return true
  return value.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 80)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  const rawBody = await request.json().catch(() => null)
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return NextResponse.json({ message: '请求参数无效' }, { status: 400 })
  }
  const body = rawBody as Record<string, unknown>
  const requestedMode = parseForumDiscoveryMode(body.mode)
  const limit = parseForumDiscoveryLimit(body.limit)
  const rawBoard = body.board
  const rawQuery = body.query
  const rawCursor = body.cursor
  const rawSeenPostIds = body.seenPostIds
  const rawSeenAuthorIds = body.seenAuthorIds
  if (!requestedMode) return NextResponse.json({ message: 'mode 参数无效' }, { status: 400 })
  if (limit === null) return NextResponse.json({ message: 'limit 参数无效' }, { status: 400 })
  if (rawBoard !== undefined && rawBoard !== null && typeof rawBoard !== 'string') return NextResponse.json({ message: 'board 参数无效' }, { status: 400 })
  if (typeof rawBoard === 'string' && rawBoard.length > 80) return NextResponse.json({ message: 'board 参数过长' }, { status: 400 })
  if (rawQuery !== undefined && rawQuery !== null && typeof rawQuery !== 'string') return NextResponse.json({ message: 'query 参数无效' }, { status: 400 })
  if (typeof rawQuery === 'string' && rawQuery.length > 100) return NextResponse.json({ message: 'query 参数过长' }, { status: 400 })
  if (rawCursor !== undefined && rawCursor !== null && typeof rawCursor !== 'string') return NextResponse.json({ message: 'cursor 参数无效' }, { status: 400 })
  if (typeof rawCursor === 'string' && (!rawCursor || rawCursor.length > 300)) return NextResponse.json({ message: 'cursor 参数无效' }, { status: 400 })
  if (hasInvalidDiscoveryIds(rawSeenPostIds)) return NextResponse.json({ message: 'seenPostIds 参数无效' }, { status: 400 })
  if (hasInvalidDiscoveryIds(rawSeenAuthorIds)) return NextResponse.json({ message: 'seenAuthorIds 参数无效' }, { status: 400 })
  const boardValue = sanitizeText(typeof rawBoard === 'string' ? rawBoard : '', 80)
  const query = sanitizeText(typeof rawQuery === 'string' ? rawQuery : '', 100)
  const seenPostIds = normalizeDiscoveryIds(body.seenPostIds)
  const seenAuthorIds = normalizeDiscoveryIds(body.seenAuthorIds)
  const cursor = parseCursor(rawCursor)
  if (rawCursor && !cursor) return NextResponse.json({ message: 'cursor 参数无效' }, { status: 400 })

  const boards = await prisma.board.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: { id: true, name: true, slug: true, description: true, postCount: true },
  })
  const selectedBoard = boardValue && boardValue !== 'all'
    ? boards.find((board) => board.slug === boardValue || board.id === boardValue) || null
    : null
  if (boardValue && boardValue !== 'all' && !selectedBoard) return NextResponse.json({ message: '分区不存在' }, { status: 404 })
  const mode: ForumDiscoveryMode = requestedMode === 'recommend' && !boardValue && !query ? 'recommend' : 'latest'
  const currentUserId = user?.id
  const interactionUserId = currentUserId || '__anonymous__'
  const where = buildWhere({
    boardId: selectedBoard?.id,
    query,
    excludedPostIds: mode === 'recommend' ? seenPostIds : undefined,
    excludedAuthorIds: mode === 'recommend' ? seenAuthorIds : undefined,
  })

  let rows: DiscoveryRow[] = []
  let hasMore = false
  let nextCursor: string | null = null

  if (mode === 'recommend') {
    const totalRemaining = await prisma.post.count({ where })
    if (totalRemaining > 0) {
      const poolSize = Math.min(DISCOVERY_CANDIDATE_POOL, Math.max(limit * 4, limit))
      const maxOffset = Math.max(0, totalRemaining - poolSize)
      const offset = maxOffset > 0 ? randomInt(maxOffset + 1) : 0
      const candidates = await prisma.post.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: poolSize,
        select: {
          ...discoverySelect,
          Like: { where: { userId: interactionUserId }, select: { id: true }, take: 1 },
          PostFavorite: currentUserId ? { where: { userId: currentUserId }, select: { id: true }, take: 1 } : false,
        },
      })
      const selected = selectRecommendationRows(
        shuffle(candidates.map((row) => ({ row: { ...row, PostFavorite: row.PostFavorite || [] }, id: row.id, author: { id: row.User.id } }))),
        new Set(seenPostIds),
        new Set(seenAuthorIds),
        limit,
      )
      rows = selected.rows.map((item) => item.row)
      if (rows.length) {
        const nextRemaining = await prisma.post.count({
          where: buildWhere({
            boardId: selectedBoard?.id,
            query,
            excludedPostIds: [...seenPostIds, ...rows.map((row) => row.id)],
            excludedAuthorIds: [...seenAuthorIds, ...rows.map((row) => row.User.id)],
          }),
        })
        hasMore = nextRemaining > 0
      }
    }
  } else {
    const pinAwareOrder = !query
    const cursorConditions: Prisma.PostWhereInput[] = cursor && pinAwareOrder && typeof cursor.isPinned === 'boolean' && typeof cursor.isFeatured === 'boolean'
      ? [
          ...(cursor.isPinned ? [{ isPinned: false }] : []),
          ...(cursor.isFeatured ? [{ isPinned: cursor.isPinned, isFeatured: false }] : []),
          { isPinned: cursor.isPinned, isFeatured: cursor.isFeatured, createdAt: { lt: cursor.date } },
          { isPinned: cursor.isPinned, isFeatured: cursor.isFeatured, createdAt: cursor.date, id: { lt: cursor.id } },
        ]
      : cursor
        ? [
            { createdAt: { lt: cursor.date } },
            { createdAt: cursor.date, id: { lt: cursor.id } },
          ]
        : []
    const latestWhere: Prisma.PostWhereInput = cursor
      ? { AND: [where, { OR: cursorConditions }] }
      : where
    const pageRows = await prisma.post.findMany({
      where: latestWhere,
      orderBy: pinAwareOrder
        ? [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        ...discoverySelect,
        Like: { where: { userId: interactionUserId }, select: { id: true }, take: 1 },
        PostFavorite: currentUserId ? { where: { userId: currentUserId }, select: { id: true }, take: 1 } : false,
      },
    })
    hasMore = pageRows.length > limit
    rows = pageRows.slice(0, limit).map((row) => ({ ...row, PostFavorite: row.PostFavorite || [] }))
    const last = rows.at(-1)
    nextCursor = last ? buildCursor(last) : null
  }

  const remarkMap = await loadFriendRemarkMap(user?.id, rows.map((row) => row.User.id))
  const announcement = selectedBoard?.slug === 'announcements'
  const canCreateAnnouncement = Boolean(user && await hasAdminPermission(user, 'post_manage'))
  return NextResponse.json({
    posts: rows.map((row) => serializePost(row, user?.id, remarkMap)),
    boards: boards.map((board) => ({ ...board, isAnnouncement: board.slug === 'announcements' })),
    selectedBoard: selectedBoard ? { ...selectedBoard, isAnnouncement: announcement } : null,
    nextCursor,
    hasMore,
    mode,
    permissions: {
      canCreatePost: Boolean(user && (!announcement || canCreateAnnouncement)),
      canCreateAnnouncement,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
