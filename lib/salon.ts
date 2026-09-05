import type { Prisma } from '@prisma/client'
// Imported from the browser-safe display module, not from '@/lib/friend-remarks':
// that module owns loadFriendRemarkMap (Prisma) and would pull the server graph
// into any bundle that reaches this file.
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { stableRecommendationWeight } from '@/lib/forum-discovery'
import { publicImageUrl } from '@/lib/images'
import { getProfileRecordPagination } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
import {
  createEmptySalonCategoryCounts,
  parseSalonRecommendationSeed,
  parseSalonSort,
  SALON_CATEGORIES,
  SALON_COMMENT_PAGE_SIZE,
  SALON_PAGE_SIZE,
  SALON_RECOMMENDATION_CANDIDATE_POOL,
  supportsOriginal,
  type SalonCategoryCounts,
  type SalonCategoryValue,
  type SalonCommentView,
  type SalonFeedMode,
  type SalonFeedResult,
  type SalonFilters,
  type SalonOptions,
  type SalonPostMediaView,
  type SalonPostStatusValue,
  type SalonPostView,
  type SalonRecommendationSeed,
  type SalonSort,
} from '@/lib/salon-shared'

/**
 * Re-export the browser-safe Salon surface so existing '@/lib/salon' importers
 * keep working unchanged. Client components must import from
 * '@/lib/salon-shared' instead to avoid pulling this server-only module
 * (Prisma, Node Buffer cursors) into the browser bundle.
 */
export * from '@/lib/salon-shared'

type SalonCursor = {
  id: string
  approvedAt: string
  likeCount?: number
}

type SalonRecommendationCursor = {
  seed: string
  window: number
  offset: number
}

export function encodeSalonCursor(cursor: SalonCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeSalonCursor(value: unknown): SalonCursor | null {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SalonCursor>
    if (typeof decoded.id !== 'string' || !decoded.id || typeof decoded.approvedAt !== 'string' || Number.isNaN(new Date(decoded.approvedAt).getTime())) return null
    if (decoded.likeCount !== undefined && (!Number.isInteger(decoded.likeCount) || decoded.likeCount < 0)) return null
    return { id: decoded.id, approvedAt: decoded.approvedAt, likeCount: decoded.likeCount }
  } catch {
    return null
  }
}

export function encodeSalonRecommendationCursor(cursor: SalonRecommendationCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeSalonRecommendationCursor(value: unknown, seed: string): SalonRecommendationCursor | null {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SalonRecommendationCursor>
    const window = decoded.window
    const offset = decoded.offset
    if (decoded.seed !== seed || typeof window !== 'number' || !Number.isSafeInteger(window) || window < 0 || window > 10000) return null
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset >= SALON_RECOMMENDATION_CANDIDATE_POOL) return null
    return { seed: decoded.seed, window, offset }
  } catch {
    return null
  }
}

export async function getSalonOptions(): Promise<SalonOptions> {
  const tours = await prisma.musicTour.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: 200,
    select: {
      id: true,
      name: true,
      MusicConcert: {
        where: { status: 'PUBLISHED' },
        orderBy: [{ concertDate: 'asc' }, { startTime: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
        select: {
          id: true,
          title: true,
          concertDate: true,
          city: true,
          countryOrRegion: true,
          venue: true,
          stageType: true,
          sessionNumber: true,
        },
      },
    },
  })

  return {
    tours: tours
      .filter((tour) => tour.MusicConcert.length > 0)
      .map((tour) => ({
        id: tour.id,
        name: tour.name,
        sessions: tour.MusicConcert.map((session) => ({
          id: session.id,
          title: session.title,
          concertDate: session.concertDate.toISOString(),
          city: session.city,
          countryOrRegion: session.countryOrRegion,
          venue: session.venue,
          stageType: session.stageType,
          sessionNumber: session.sessionNumber,
        })),
      })),
  }
}

const salonPostSelect = {
  id: true,
  category: true,
  title: true,
  content: true,
  status: true,
  rejectReason: true,
  likeCount: true,
  commentCount: true,
  viewCount: true,
  createdAt: true,
  approvedAt: true,
  author: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
  concert: {
    select: {
      id: true,
      title: true,
      concertDate: true,
      city: true,
      stageType: true,
      venue: true,
      sessionNumber: true,
      MusicTour: { select: { id: true, name: true } },
    },
  },
  media: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      originalUrl: true,
      previewUrl: true,
      thumbnailUrl: true,
      originalObjectKey: true,
      originalFilename: true,
      originalMimeType: true,
      originalSize: true,
      width: true,
      height: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.SalonPostSelect

type SalonPostRow = Prisma.SalonPostGetPayload<{ select: typeof salonPostSelect }>

function publicAuthor(author: SalonPostRow['author']) {
  return {
    id: author.id,
    uid: author.uid,
    nickname: getPublicUserDisplayName(author),
    avatarUrl: publicImageUrl(author.Profile?.avatarUrl || author.avatarUrl),
  }
}

function originalObjectKey(media: SalonPostRow['media'][number]) {
  // A legacy display/source key is not evidence that an original object was
  // retained. Only an explicitly persisted original key may expose the
  // protected download action.
  return media.originalObjectKey?.trim() || null
}

function publicMedia(media: SalonPostRow['media'][number], category: SalonCategoryValue, includeOriginal = false): SalonPostMediaView {
  const originalAvailable = supportsOriginal(category) && Boolean(originalObjectKey(media))
  return {
    id: media.id,
    originalUrl: includeOriginal && originalAvailable ? publicImageUrl(media.originalUrl) || media.originalUrl : null,
    previewUrl: publicImageUrl(media.previewUrl) || media.previewUrl,
    thumbnailUrl: publicImageUrl(media.thumbnailUrl) || media.thumbnailUrl,
    originalFilename: media.originalFilename,
    originalMimeType: media.originalMimeType,
    originalSize: media.originalSize,
    originalAvailable,
    width: media.width,
    height: media.height,
    sortOrder: media.sortOrder,
  }
}

export function serializeSalonPost(row: SalonPostRow, likedByMe = false, includeOriginal = false): SalonPostView {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    status: row.status,
    rejectReason: row.rejectReason,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    viewCount: row.viewCount || 0,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() || null,
    likedByMe,
    author: publicAuthor(row.author),
    concert: row.concert ? {
      id: row.concert.id,
      title: row.concert.title,
      date: row.concert.concertDate.toISOString(),
      city: row.concert.city,
      stageType: row.concert.stageType,
      venue: row.concert.venue,
      sessionNumber: row.concert.sessionNumber,
      tour: row.concert.MusicTour,
    } : null,
    media: row.media.map((media) => publicMedia(media, row.category, includeOriginal)),
  }
}

function visibilityWhere(postId: string, viewerId?: string | null, viewerCanModerate = false): Prisma.SalonPostWhereInput {
  if (viewerCanModerate) return { id: postId }
  const publicWhere = { ...salonPublicBaseWhere, id: postId }
  if (viewerId) return { id: postId, OR: [salonPublicBaseWhere, { userId: viewerId }] }
  return publicWhere
}

export function getSalonPostVisibilityWhere(postId: string, viewerId?: string | null, viewerCanModerate = false) {
  return visibilityWhere(postId, viewerId, viewerCanModerate)
}

const publishedConcertWhere = {
  status: 'PUBLISHED' as const,
  MusicTour: { status: 'PUBLISHED' as const },
} satisfies Prisma.MusicConcertWhereInput

/** Concert records need a published session; wallpapers and archives do not. */
export const salonPublicBaseWhere = {
  status: 'APPROVED' as const,
  approvedAt: { not: null },
  OR: [
    { category: 'CONCERT' as const, concert: publishedConcertWhere },
    { category: { in: ['MOBILE_WALLPAPER', 'DESKTOP_WALLPAPER', 'TIME_TRAVEL'] as const } },
  ],
} satisfies Prisma.SalonPostWhereInput

/** Counts use exactly the same public visibility predicate as the feed. */
export async function getSalonCategoryCounts(): Promise<SalonCategoryCounts> {
  const [all, grouped] = await Promise.all([
    prisma.salonPost.count({ where: salonPublicBaseWhere }),
    prisma.salonPost.groupBy({
      by: ['category'],
      where: salonPublicBaseWhere,
      _count: { _all: true },
    }),
  ])
  const counts = createEmptySalonCategoryCounts()
  counts.all = all
  for (const row of grouped) {
    if (SALON_CATEGORIES.includes(row.category)) counts[row.category] = row._count._all
  }
  return counts
}

/** One public filter is shared by ALL, category tabs, latest, and popular feeds. */
export function buildSalonFeedWhere(filters: Pick<SalonFilters, 'category' | 'tourId' | 'sessionId'> = {}): Prisma.SalonPostWhereInput {
  const concertWhere: Prisma.MusicConcertWhereInput = {
    ...publishedConcertWhere,
    ...(filters.tourId ? { tourId: filters.tourId } : {}),
    ...(filters.sessionId ? { id: filters.sessionId } : {}),
  }
  const hasConcertFilter = Boolean(filters.tourId || filters.sessionId)
  if (filters.category === 'CONCERT' || hasConcertFilter) {
    return { ...salonPublicBaseWhere, ...(filters.category ? { category: filters.category } : {}), concert: concertWhere }
  }
  return { ...salonPublicBaseWhere, ...(filters.category ? { category: filters.category } : {}) }
}

function addCursorWhere(where: Prisma.SalonPostWhereInput, sort: SalonSort, cursor: SalonCursor | null) {
  if (!cursor) return where
  const approvedAt = new Date(cursor.approvedAt)
  if (sort === 'popular') {
    return {
      ...where,
      AND: [{
        OR: [
          { likeCount: { lt: cursor.likeCount ?? 0 } },
          { likeCount: cursor.likeCount ?? 0, approvedAt: { lt: approvedAt } },
          { likeCount: cursor.likeCount ?? 0, approvedAt, id: { lt: cursor.id } },
        ],
      }],
    }
  }
  return {
    ...where,
    AND: [{ OR: [{ approvedAt: { lt: approvedAt } }, { approvedAt, id: { lt: cursor.id } }] }],
  }
}

function salonRecommendationScore(row: SalonPostRow, seed: SalonRecommendationSeed) {
  const publishedAt = row.approvedAt || row.createdAt
  const ageHours = Math.max(0, (seed.startedAt.getTime() - publishedAt.getTime()) / (60 * 60 * 1000))
  const freshnessScore = ageHours <= 6
    ? 82
    : ageHours <= 24
      ? 62
      : ageHours <= 72
        ? 40
        : ageHours <= 168
          ? 20
          : 8
  const qualityScore = Math.log1p(row.likeCount) * 4
    + Math.log1p(row.commentCount) * 5
    + Math.log1p(row.viewCount) * 0.5
  return freshnessScore + qualityScore + stableRecommendationWeight(seed.value, row.id) * 18
}

export async function getSalonPosts(filters: SalonFilters = {}, viewerId?: string | null, options: { mode?: SalonFeedMode; feedSeed?: string | null } = {}): Promise<SalonFeedResult> {
  const sort = parseSalonSort(filters.sort)
  const canRecommend = options.mode === 'recommend' && !filters.category && !filters.tourId && !filters.sessionId
  let pageRows: SalonPostRow[]
  let hasMore = false
  let nextCursor: string | null = null
  let feedSeed: string | null = null

  if (canRecommend) {
    const seed = parseSalonRecommendationSeed(options.feedSeed)
    if (!seed) throw new Error('沙龙推荐会话无效')
    const recommendationCursor = filters.cursor ? decodeSalonRecommendationCursor(filters.cursor, seed.value) : null
    if (filters.cursor && !recommendationCursor) throw new Error('沙龙推荐游标无效')
    const window = recommendationCursor?.window || 0
    const offset = recommendationCursor?.offset || 0
    const candidateRows = await prisma.salonPost.findMany({
      where: { AND: [buildSalonFeedWhere(filters), { approvedAt: { lte: seed.startedAt } }] },
      orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      skip: window * SALON_RECOMMENDATION_CANDIDATE_POOL,
      take: SALON_RECOMMENDATION_CANDIDATE_POOL + 1,
      select: salonPostSelect,
    })
    const rankedRows = candidateRows.slice(0, SALON_RECOMMENDATION_CANDIDATE_POOL).sort((left, right) => {
      const scoreDifference = salonRecommendationScore(right, seed) - salonRecommendationScore(left, seed)
      if (scoreDifference) return scoreDifference
      const leftTime = (left.approvedAt || left.createdAt).getTime()
      const rightTime = (right.approvedAt || right.createdAt).getTime()
      return rightTime - leftTime || right.id.localeCompare(left.id)
    })
    pageRows = rankedRows.slice(offset, offset + SALON_PAGE_SIZE)
    if (offset + pageRows.length < rankedRows.length) {
      hasMore = true
      nextCursor = encodeSalonRecommendationCursor({ seed: seed.value, window, offset: offset + pageRows.length })
    } else if (candidateRows.length > SALON_RECOMMENDATION_CANDIDATE_POOL) {
      hasMore = true
      nextCursor = encodeSalonRecommendationCursor({ seed: seed.value, window: window + 1, offset: 0 })
    }
    feedSeed = seed.value
  } else {
    const cursor = filters.cursor ? decodeSalonCursor(filters.cursor) : null
    if (filters.cursor && !cursor) throw new Error('沙龙游标无效')
    const where = addCursorWhere(buildSalonFeedWhere(filters), sort, cursor)
    const rows = await prisma.salonPost.findMany({
      where,
      orderBy: sort === 'popular'
        ? [{ likeCount: 'desc' }, { approvedAt: 'desc' }, { id: 'desc' }]
        : [{ approvedAt: 'desc' }, { id: 'desc' }],
      take: SALON_PAGE_SIZE + 1,
      select: salonPostSelect,
    })
    hasMore = rows.length > SALON_PAGE_SIZE
    pageRows = rows.slice(0, SALON_PAGE_SIZE)
    const last = pageRows[pageRows.length - 1]
    nextCursor = hasMore && last?.approvedAt
      ? encodeSalonCursor({ id: last.id, approvedAt: last.approvedAt.toISOString(), likeCount: last.likeCount })
      : null
  }

  const likedIds = viewerId && pageRows.length
    ? new Set((await prisma.salonPostLike.findMany({
      where: { userId: viewerId, postId: { in: pageRows.map((row) => row.id) } },
      select: { postId: true },
    })).map((row) => row.postId))
    : new Set<string>()
  return {
    posts: pageRows.map((row) => serializeSalonPost(row, likedIds.has(row.id))),
    hasMore,
    nextCursor,
    feedSeed,
  }
}

/**
 * The profile record is a public projection, so it uses the same approved
 * conditions as the main Salon feed and paginates in the database.
 */
export async function getProfileSalonPosts(userId: string, requestedPage = 1, viewerId?: string | null) {
  const where: Prisma.SalonPostWhereInput = { ...salonPublicBaseWhere, userId }
  const total = await prisma.salonPost.count({ where })
  const pagination = getProfileRecordPagination(total, requestedPage)
  const rows = await prisma.salonPost.findMany({
    where,
    orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
    select: salonPostSelect,
  })
  const likedIds = viewerId && rows.length
    ? new Set((await prisma.salonPostLike.findMany({
      where: { userId: viewerId, postId: { in: rows.map((row) => row.id) } },
      select: { postId: true },
    })).map((row) => row.postId))
    : new Set<string>()
  return {
    posts: rows.map((row) => serializeSalonPost(row, likedIds.has(row.id))),
    pagination,
  }
}

export async function getSalonPostForViewer(postId: string, viewerId?: string | null, viewerCanModerate = false) {
  const row = await prisma.salonPost.findFirst({
    where: visibilityWhere(postId, viewerId, viewerCanModerate),
    select: salonPostSelect,
  })
  if (!row) return null
  const likedByMe = Boolean(viewerId && await prisma.salonPostLike.findUnique({
    where: { postId_userId: { postId, userId: viewerId } },
    select: { id: true },
  }))
  return serializeSalonPost(row, likedByMe)
}

export async function getMySalonPosts(userId: string) {
  const rows = await prisma.salonPost.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: salonPostSelect,
  })
  return rows.map((row) => serializeSalonPost(row, false))
}

export async function getSalonAdminPosts(status: SalonPostStatusValue = 'PENDING', page = 1) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  const rows = await prisma.salonPost.findMany({
    where: { status },
    orderBy: status === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (safePage - 1) * 20,
    take: 21,
    select: salonPostSelect,
  })
  return {
    posts: rows.slice(0, 20).map((row) => serializeSalonPost(row, false, true)),
    hasMore: rows.length > 20,
    page: safePage,
  }
}

const salonCommentSelect = {
  id: true,
  parentId: true,
  content: true,
  createdAt: true,
  author: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
} satisfies Prisma.SalonCommentSelect

type SalonCommentRow = Prisma.SalonCommentGetPayload<{ select: typeof salonCommentSelect }>

export function serializeSalonComment(row: SalonCommentRow): SalonCommentView {
  return {
    id: row.id,
    parentId: row.parentId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    author: {
      id: row.author.id,
      uid: row.author.uid,
      nickname: getPublicUserDisplayName(row.author),
      avatarUrl: publicImageUrl(row.author.Profile?.avatarUrl || row.author.avatarUrl),
    },
  }
}

export async function getSalonComments(postId: string, cursor?: string) {
  const decoded = cursor ? decodeSalonCursor(cursor) : null
  const rows = await prisma.salonComment.findMany({
    where: {
      postId,
      isDeleted: false,
      ...(decoded ? { OR: [{ createdAt: { gt: new Date(decoded.approvedAt) } }, { createdAt: new Date(decoded.approvedAt), id: { gt: decoded.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: SALON_COMMENT_PAGE_SIZE + 1,
    select: salonCommentSelect,
  })
  const hasMore = rows.length > SALON_COMMENT_PAGE_SIZE
  const pageRows = rows.slice(0, SALON_COMMENT_PAGE_SIZE)
  const last = pageRows[pageRows.length - 1]
  return {
    comments: pageRows.map(serializeSalonComment),
    hasMore,
    nextCursor: hasMore && last ? encodeSalonCursor({ id: last.id, approvedAt: last.createdAt.toISOString() }) : null,
  }
}
