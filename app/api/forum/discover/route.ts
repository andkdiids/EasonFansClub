import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { splitContentImages } from '@/lib/content-images'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageVariantUrl } from '@/lib/image-variants'
import {
  parseForumDiscoveryLimit,
  parseForumDiscoveryMode,
  stableRecommendationWeight,
  normalizeDiscoveryIds,
  selectRecommendationRows,
  FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT,
  type ForumDiscoveryMode,
} from '@/lib/forum-discovery'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'
import { sanitizeText } from '@/lib/security'
import { publicModerationText } from '@/lib/content-moderation'

export const dynamic = 'force-dynamic'

const DISCOVERY_CANDIDATE_POOL = 120
const DISCOVERY_MAX_RECOMMEND_WINDOWS = 4
const DISCOVERY_MAX_SEEN_IDS = 500
const DISCOVERY_FRESH_WINDOW_HOURS = 24
const DISCOVERY_RECENT_WINDOW_HOURS = 72

type DiscoveryFeedSeed = {
  value: string
  startedAt: Date
}

type RecommendationCursor = {
  page: number
}

type HotCursor = {
  likeCount: number
  replyCount: number
  date: Date
  id: string
}

function createFeedSeed() {
  return `${Date.now().toString(36)}.${randomUUID()}`
}

function parseFeedSeed(value: unknown): DiscoveryFeedSeed | null {
  if (typeof value !== 'string' || !value || value.length > 160) return null
  const [timestampPart, randomPart] = value.split('.', 2)
  if (!timestampPart || !randomPart || randomPart.length > 100) return null
  const timestamp = Number.parseInt(timestampPart, 36)
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null
  const now = Date.now()
  if (timestamp > now + 5 * 60 * 1000) return null
  return { value, startedAt: new Date(Math.min(timestamp, now)) }
}

function buildRecommendationCursor(seed: string, page: number) {
  return `r|${seed}|${page}`
}

function parseRecommendationCursor(value: unknown, seed: DiscoveryFeedSeed): RecommendationCursor | null {
  if (value === undefined || value === null || value === '') return { page: 0 }
  if (typeof value !== 'string') return null
  const [prefix, cursorSeed, pageValue] = value.split('|')
  if (prefix !== 'r' || cursorSeed !== seed.value || !pageValue) return null
  const page = Number.parseInt(pageValue, 10)
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) return null
  return { page }
}

function recommendationScore(row: DiscoveryRow, seed: DiscoveryFeedSeed) {
  const ageHours = Math.max(0, (seed.startedAt.getTime() - row.createdAt.getTime()) / (60 * 60 * 1000))
  const freshnessScore = ageHours <= 6
    ? 82
    : ageHours <= DISCOVERY_FRESH_WINDOW_HOURS
      ? 62
      : ageHours <= DISCOVERY_RECENT_WINDOW_HOURS
        ? 40
        : ageHours <= 168
          ? 20
          : 8
  const qualityScore = Math.log1p(row.likeCount) * 4
    + Math.log1p(row.replyCount) * 5
    + Math.log1p(row.viewCount) * 0.5
    + (row.isFeatured ? 18 : 0)
    + (row.isPinned ? 12 : 0)
    + (row.isRecommended ? 10 : 0)
  const explorationScore = stableRecommendationWeight(seed.value, row.id) * 18
  return freshnessScore + qualityScore + explorationScore
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

function parseHotCursor(value: unknown): HotCursor | null {
  if (typeof value !== 'string' || !value) return null
  const [prefix, likeValue, replyValue, dateValue, id] = value.split('|')
  const likeCount = Number.parseInt(likeValue || '', 10)
  const replyCount = Number.parseInt(replyValue || '', 10)
  const date = new Date(dateValue || '')
  if (prefix !== 'h' || !Number.isSafeInteger(likeCount) || likeCount < 0 || !Number.isSafeInteger(replyCount) || replyCount < 0) return null
  if (Number.isNaN(date.getTime()) || !id || id.length > 80) return null
  return { likeCount, replyCount, date, id }
}

function buildHotCursor(row: Pick<DiscoveryRow, 'likeCount' | 'replyCount' | 'createdAt' | 'id'>) {
  return `h|${row.likeCount}|${row.replyCount}|${row.createdAt.toISOString()}|${row.id}`
}

function serializePost(row: DiscoveryRow) {
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
    title: publicModerationText(row.title, row.moderationStatus),
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
      nickname: getPublicUserDisplayName(row.User),
      displayName: getPublicUserDisplayName(row.User),
      avatarUrl: publicImageVariantUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl, 'avatar-sm'),
      level: row.User.level,
    },
    cover,
  }
}

const discoverySelect = {
  id: true,
  title: true,
  moderationStatus: true,
  content: true,
  ipRegion: true,
  viewCount: true,
  likeCount: true,
  favoriteCount: true,
  replyCount: true,
  isPinned: true,
  isFeatured: true,
  isRecommended: true,
  createdAt: true,
  updatedAt: true,
  Board: { select: { name: true, slug: true } },
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      level: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
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

function buildWhere({ boardId, query, excludedPostIds, excludedAuthorIds, excludeSystemPosts }: {
  boardId?: string
  query?: string
  excludedPostIds?: string[]
  excludedAuthorIds?: string[]
  excludeSystemPosts?: boolean
}): Prisma.PostWhereInput {
  return {
    ...publicPostWhere,
    User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    Board: excludeSystemPosts ? { isActive: true, slug: { not: 'announcements' } } : { isActive: true },
    ...(excludeSystemPosts ? { isPinned: false, isFeatured: false } : {}),
    ...(boardId ? { boardId } : {}),
    ...(query ? { OR: [{ title: { contains: query } }, { summary: { contains: query } }] } : {}),
    ...(excludedPostIds?.length ? { id: { notIn: excludedPostIds } } : {}),
    ...(excludedAuthorIds?.length ? { authorId: { notIn: excludedAuthorIds } } : {}),
  }
}

function hasInvalidDiscoveryIds(value: unknown, max = DISCOVERY_MAX_SEEN_IDS) {
  if (value === undefined) return false
  if (!Array.isArray(value) || value.length > max) return true
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
  const rawFeedSeed = body.feedSeed
  const rawSeenPostIds = body.seenPostIds
  const rawSeenAuthorIds = body.seenAuthorIds
  const rawRecentRecommendedPostIds = body.recentRecommendedPostIds
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
  if (hasInvalidDiscoveryIds(rawRecentRecommendedPostIds, FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT)) return NextResponse.json({ message: 'recentRecommendedPostIds 参数无效' }, { status: 400 })
  if (typeof rawFeedSeed === 'string' && (!rawFeedSeed || rawFeedSeed.length > 160)) return NextResponse.json({ message: 'feedSeed invalid' }, { status: 400 })
  if (rawFeedSeed !== undefined && rawFeedSeed !== null && typeof rawFeedSeed !== 'string') return NextResponse.json({ message: 'feedSeed invalid' }, { status: 400 })
  const boardValue = sanitizeText(typeof rawBoard === 'string' ? rawBoard : '', 80)
  const query = sanitizeText(typeof rawQuery === 'string' ? rawQuery : '', 100)
  const seenPostIds = normalizeDiscoveryIds(body.seenPostIds)
  const seenAuthorIds = normalizeDiscoveryIds(body.seenAuthorIds)
  const recentRecommendedPostIds = normalizeDiscoveryIds(body.recentRecommendedPostIds, FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT)

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
  const mode: ForumDiscoveryMode = !boardValue && !query ? requestedMode : 'latest'
  const feedSeed = mode === 'recommend'
    ? (rawFeedSeed ? parseFeedSeed(rawFeedSeed) : { value: createFeedSeed(), startedAt: new Date() })
    : null
  if (mode === 'recommend' && !feedSeed) return NextResponse.json({ message: 'feedSeed invalid' }, { status: 400 })
  const cursor = mode === 'latest' ? parseCursor(rawCursor) : null
  const hotCursor = mode === 'hot' ? parseHotCursor(rawCursor) : null
  const recommendationCursor = mode === 'recommend' && feedSeed
    ? parseRecommendationCursor(rawCursor, feedSeed)
    : null
  if (mode === 'latest' && rawCursor && !cursor) return NextResponse.json({ message: 'cursor invalid' }, { status: 400 })
  if (mode === 'hot' && rawCursor && !hotCursor) return NextResponse.json({ message: 'cursor invalid' }, { status: 400 })
  if (mode === 'recommend' && rawCursor && !recommendationCursor) return NextResponse.json({ message: 'cursor invalid' }, { status: 400 })
  const currentUserId = user?.id
  const interactionUserId = currentUserId || '__anonymous__'
  const isSystemSort = !boardValue && !query && (mode === 'latest' || mode === 'hot')
  const where = buildWhere({ boardId: selectedBoard?.id, query, excludeSystemPosts: isSystemSort })

  let rows: DiscoveryRow[] = []
  let hasMore = false
  let nextCursor: string | null = null

  if (mode === 'recommend') {
    const recommendWhere: Prisma.PostWhereInput = {
      AND: [where, { createdAt: { lte: feedSeed!.startedAt } }],
    }
    const remainingPostIds = new Set(seenPostIds)
    const remainingAuthorIds = new Set(seenAuthorIds)
    const recentPostIds = new Set(recentRecommendedPostIds)
    const selectedRows: DiscoveryRow[] = []
    const candidateRows: DiscoveryRow[] = []
    const candidateSize = Math.min(DISCOVERY_CANDIDATE_POOL, Math.max(limit * 12, 96))
    const startWindow = recommendationCursor?.page || 0
    const selectForPage = (candidates: DiscoveryRow[], allowPreviouslySeenAuthors = false, allowRecentPosts = false) => {
      const ranked = candidates
        .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index)
        .sort((left, right) => {
          const scoreDelta = recommendationScore(right, feedSeed!) - recommendationScore(left, feedSeed!)
          if (scoreDelta !== 0) return scoreDelta
          const dateDelta = right.createdAt.getTime() - left.createdAt.getTime()
          return dateDelta !== 0 ? dateDelta : right.id.localeCompare(left.id)
        })
      const selected = selectRecommendationRows(
        ranked.map((row) => ({ row, id: row.id, author: { id: row.User.id } })),
        remainingPostIds,
        allowPreviouslySeenAuthors ? new Set(selectedRows.map((row) => row.User.id)) : remainingAuthorIds,
        limit - selectedRows.length,
        allowRecentPosts ? new Set() : recentPostIds,
      )
      selected.rows.forEach((item) => {
        selectedRows.push(item.row)
        remainingPostIds.add(item.row.id)
        remainingAuthorIds.add(item.row.User.id)
      })
    }

    for (let window = 0; window < DISCOVERY_MAX_RECOMMEND_WINDOWS && selectedRows.length < limit; window += 1) {
      const candidates = await prisma.post.findMany({
        where: recommendWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (startWindow + window) * candidateSize,
        take: candidateSize,
        select: {
          ...discoverySelect,
          Like: { where: { userId: interactionUserId }, select: { id: true }, take: 1 },
          PostFavorite: currentUserId ? { where: { userId: currentUserId }, select: { id: true }, take: 1 } : false,
        },
      })
      const normalizedCandidates = candidates.map((row) => ({ ...row, PostFavorite: row.PostFavorite || [] }))
      candidateRows.push(...normalizedCandidates)
      selectForPage(normalizedCandidates)
      if (candidates.length < candidateSize) break
    }

    if (selectedRows.length < limit) selectForPage(candidateRows, true)
    if (selectedRows.length < limit) selectForPage(candidateRows, true, true)

    if (selectedRows.length === 0) {
      const fallbackCandidates = await prisma.post.findMany({
        where: { AND: [recommendWhere, { id: { notIn: [...remainingPostIds] } }] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          ...discoverySelect,
          Like: { where: { userId: interactionUserId }, select: { id: true }, take: 1 },
          PostFavorite: currentUserId ? { where: { userId: currentUserId }, select: { id: true }, take: 1 } : false,
        },
      })
      selectForPage(fallbackCandidates.map((row) => ({ ...row, PostFavorite: row.PostFavorite || [] })), true, true)
    }

    rows = selectedRows
    const nextRemaining = await prisma.post.count({
      where: { AND: [recommendWhere, { id: { notIn: [...remainingPostIds] } }] },
    })
    hasMore = rows.length > 0 && nextRemaining > 0
    if (hasMore) nextCursor = buildRecommendationCursor(feedSeed!.value, (recommendationCursor?.page || 0) + 1)
  } else if (mode === 'hot') {
    const cursorConditions: Prisma.PostWhereInput[] = hotCursor
      ? [
          { likeCount: { lt: hotCursor.likeCount } },
          { likeCount: hotCursor.likeCount, replyCount: { lt: hotCursor.replyCount } },
          { likeCount: hotCursor.likeCount, replyCount: hotCursor.replyCount, createdAt: { lt: hotCursor.date } },
          { likeCount: hotCursor.likeCount, replyCount: hotCursor.replyCount, createdAt: hotCursor.date, id: { lt: hotCursor.id } },
        ]
      : []
    const hotWhere: Prisma.PostWhereInput = hotCursor
      ? { AND: [where, { OR: cursorConditions }] }
      : where
    const pageRows = await prisma.post.findMany({
      where: hotWhere,
      orderBy: [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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
    nextCursor = last ? buildHotCursor(last) : null
  } else {
    const pinAwareOrder = !query && !isSystemSort
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

  const announcement = selectedBoard?.slug === 'announcements'
  const canCreateAnnouncement = Boolean(user && await hasAdminPermission(user, 'post_manage'))
  return NextResponse.json({
    posts: rows.map((row) => serializePost(row)),
    boards: boards.map((board) => ({ ...board, isAnnouncement: board.slug === 'announcements' })),
    selectedBoard: selectedBoard ? { ...selectedBoard, isAnnouncement: announcement } : null,
    nextCursor,
    feedSeed: feedSeed?.value || null,
    hasMore,
    mode,
    permissions: {
      canCreatePost: Boolean(user && (!announcement || canCreateAnnouncement)),
      canCreateAnnouncement,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
