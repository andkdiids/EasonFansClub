import type { Prisma } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { stableRecommendationWeight } from '@/lib/forum-discovery'
import { publicImageUrl } from '@/lib/images'
import { getProfileRecordPagination } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'

export const SALON_CATEGORIES = ['CONCERT', 'MOBILE_WALLPAPER', 'DESKTOP_WALLPAPER', 'TIME_TRAVEL'] as const
export type SalonCategoryValue = typeof SALON_CATEGORIES[number]

export type SalonCategoryConfig = {
  label: string
  hint: string
  allowsConcert: boolean
  allowsSession: boolean
  requiresConcert: boolean
  originalPolicy: 'PRESERVE_ORIGINAL'
}

/** Shared category rules for upload, moderation, feeds, detail and share cards. */
export const SALON_CATEGORY_CONFIG: Record<SalonCategoryValue, SalonCategoryConfig> = {
  CONCERT: {
    label: '演唱会记录',
    hint: '上传你在现场拍摄的照片。',
    allowsConcert: true,
    allowsSession: true,
    requiresConcert: true,
    originalPolicy: 'PRESERVE_ORIGINAL',
  },
  MOBILE_WALLPAPER: {
    label: '手机壁纸',
    hint: '适合手机竖屏使用的高清图片。',
    allowsConcert: true,
    allowsSession: true,
    requiresConcert: false,
    originalPolicy: 'PRESERVE_ORIGINAL',
  },
  DESKTOP_WALLPAPER: {
    label: '电脑壁纸',
    hint: '适合电脑横屏使用的高清图片。',
    allowsConcert: true,
    allowsSession: true,
    requiresConcert: false,
    originalPolicy: 'PRESERVE_ORIGINAL',
  },
  TIME_TRAVEL: {
    label: '时光倒流二十年',
    hint: '分享与陈奕迅有关的早年生活照、公开影像和珍贵历史记录。',
    allowsConcert: false,
    allowsSession: false,
    requiresConcert: false,
    originalPolicy: 'PRESERVE_ORIGINAL',
  },
}

/** Every Salon upload retains an untouched source; only public display variants are optimized. */
export function supportsOriginal(category: SalonCategoryValue | string) {
  return SALON_CATEGORIES.includes(category as SalonCategoryValue)
}

/** Naming alias for upload code that describes the persistence decision. */
export const shouldPreserveOriginal = supportsOriginal

export const SALON_CATEGORY_LABELS: Record<SalonCategoryValue, string> = Object.fromEntries(
  SALON_CATEGORIES.map((category) => [category, SALON_CATEGORY_CONFIG[category].label]),
) as Record<SalonCategoryValue, string>

export const SALON_CATEGORY_HINTS: Record<SalonCategoryValue, string> = Object.fromEntries(
  SALON_CATEGORIES.map((category) => [category, SALON_CATEGORY_CONFIG[category].hint]),
) as Record<SalonCategoryValue, string>

export const SALON_POST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type SalonPostStatusValue = typeof SALON_POST_STATUSES[number]
export const SALON_STATUS_LABELS: Record<SalonPostStatusValue, string> = {
  PENDING: '审核中',
  APPROVED: '已通过',
  REJECTED: '未通过',
}

export const SALON_PAGE_SIZE = 24
export const SALON_COMMENT_PAGE_SIZE = 40
export const SALON_RECOMMENDATION_CANDIDATE_POOL = 120

export type SalonSort = 'latest' | 'popular'
export type SalonFeedMode = SalonSort | 'recommend'

export type SalonCategoryCounts = Record<SalonCategoryValue, number> & { all: number }

export type SalonFeedResult = {
  posts: SalonPostView[]
  hasMore: boolean
  nextCursor: string | null
  feedSeed: string | null
  categoryCounts?: SalonCategoryCounts
}

export type SalonFilters = {
  category?: SalonCategoryValue
  tourId?: string
  sessionId?: string
  sort?: SalonSort
  cursor?: string
}

export function createEmptySalonCategoryCounts(): SalonCategoryCounts {
  return {
    all: 0,
    ...Object.fromEntries(SALON_CATEGORIES.map((category) => [category, 0])),
  } as SalonCategoryCounts
}

export type SalonOptions = {
  tours: Array<{
    id: string
    name: string
    sessions: Array<{
      id: string
      title: string | null
      concertDate: string
      city: string
      countryOrRegion: string | null
      venue: string | null
      stageType: string
      sessionNumber: string | null
    }>
  }>
}

export type SalonPostMediaView = {
  id: string
  /** Public pages render display WebP; originalUrl is only populated for admin review. */
  originalUrl: string | null
  previewUrl: string
  thumbnailUrl: string
  originalFilename: string | null
  originalMimeType: string | null
  originalSize: number | null
  originalAvailable: boolean
  width: number
  height: number
  sortOrder: number
}

export type SalonPostView = {
  id: string
  category: SalonCategoryValue
  title: string | null
  content: string | null
  status: SalonPostStatusValue
  rejectReason: string | null
  likeCount: number
  commentCount: number
  viewCount: number
  createdAt: string
  approvedAt: string | null
  likedByMe: boolean
  author: {
    id: string
    uid: number
    nickname: string
    avatarUrl: string | null
  }
  concert: {
    id: string
    title: string | null
    date: string
    city: string
    stageType: string
    venue: string | null
    sessionNumber: string | null
    tour: { id: string; name: string }
  } | null
  media: SalonPostMediaView[]
}

export type SalonCommentView = {
  id: string
  parentId: string | null
  content: string
  createdAt: string
  author: {
    id: string
    uid: number
    nickname: string
    avatarUrl: string | null
  }
}

function isSalonCategory(value: unknown): value is SalonCategoryValue {
  return typeof value === 'string' && SALON_CATEGORIES.includes(value as SalonCategoryValue)
}

export function getSalonCategoryConfig(value: unknown) {
  return isSalonCategory(value) ? SALON_CATEGORY_CONFIG[value] : null
}

export function salonCategoryAllowsConcert(value: unknown) {
  return getSalonCategoryConfig(value)?.allowsConcert === true
}

export function salonCategoryAllowsSession(value: unknown) {
  return getSalonCategoryConfig(value)?.allowsSession === true
}

export function salonCategoryRequiresConcert(value: unknown) {
  return getSalonCategoryConfig(value)?.requiresConcert === true
}

/**
 * SalonPost stores the selected concrete MusicConcert in `concertId`.
 * `sessionId` is the explicit UI/API name; `concertId` remains supported for
 * older callers. The parent tour is only used to validate the child session.
 */
export function normalizeSalonConcertSelection(input: { tourId?: unknown; sessionId?: unknown; concertId?: unknown }) {
  const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const tourId = clean(input.tourId)
  const sessionId = clean(input.sessionId)
  const legacyConcertId = clean(input.concertId)
  return {
    tourId: tourId || null,
    sessionId: sessionId || legacyConcertId || null,
    hasConflict: Boolean(sessionId && legacyConcertId && sessionId !== legacyConcertId),
  }
}

export function parseSalonCategory(value: unknown) {
  return isSalonCategory(value) ? value : undefined
}

export function parseSalonSort(value: unknown): SalonSort {
  return value === 'popular' ? 'popular' : 'latest'
}

export function parseSalonFilters(value: Record<string, string | string[] | undefined>): SalonFilters {
  const get = (key: string) => {
    const raw = value[key]
    return Array.isArray(raw) ? raw[0] : raw
  }
  const category = parseSalonCategory(get('category'))
  const tourId = get('concert')?.trim() || undefined
  const sessionId = get('session')?.trim() || undefined
  const cursor = get('cursor')?.trim() || undefined
  return {
    ...(category ? { category } : {}),
    ...(tourId ? { tourId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(cursor ? { cursor } : {}),
    sort: parseSalonSort(get('sort')),
  }
}

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

export type SalonRecommendationSeed = {
  value: string
  startedAt: Date
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

/**
 * A recommendation refresh is a bounded, deterministic snapshot. The
 * timestamp keeps newly approved posts from shifting later windows while the
 * random suffix gives each refresh a new ordering seed.
 */
export function parseSalonRecommendationSeed(value: unknown): SalonRecommendationSeed | null {
  if (typeof value !== 'string' || !value || value.length > 160) return null
  const [timestampPart, randomPart] = value.split('.', 2)
  if (!timestampPart || !randomPart || randomPart.length > 100) return null
  const timestamp = Number.parseInt(timestampPart, 36)
  const now = Date.now()
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now + 5 * 60 * 1000) return null
  return { value, startedAt: new Date(Math.min(timestamp, now)) }
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

function formatSessionDate(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '日期待整理'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatSalonSession(session: Pick<SalonOptions['tours'][number]['sessions'][number], 'city' | 'concertDate' | 'venue' | 'title' | 'sessionNumber'>) {
  const name = session.title?.trim() || session.city
  const sessionNumber = session.sessionNumber?.trim() ? ` · ${session.sessionNumber.trim()}` : ''
  const venue = session.venue?.trim() ? ` · ${session.venue.trim()}` : ''
  return `${name} · ${formatSessionDate(session.concertDate)}${sessionNumber}${venue}`
}

export function formatSalonPostConcert(concert: SalonPostView['concert']) {
  if (!concert) return ''
  return `${concert.tour.name} · ${formatSalonSession({
    city: concert.city,
    concertDate: concert.date,
    venue: concert.venue,
    title: concert.title,
    sessionNumber: concert.sessionNumber,
  })}`
}

export function formatSalonPostContext(category: SalonCategoryValue | string, concert: SalonPostView['concert']) {
  return concert ? formatSalonPostConcert(concert) : salonCategoryLabel(category)
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

export function appendUniqueSalonPosts<T extends { id: string }>(
  current: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
  reset = false,
) {
  const next = reset ? [] : [...current]
  const knownIds = new Set(next.map((post) => post.id))
  for (const post of incoming) {
    if (knownIds.has(post.id)) continue
    knownIds.add(post.id)
    next.push(post)
  }
  return next
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

export function collectSalonCommentThreadIds(rows: Array<{ id: string; parentId: string | null }>, rootId: string) {
  const childrenByParent = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    childrenByParent.set(row.parentId, [...(childrenByParent.get(row.parentId) || []), row.id])
  }
  const ids: string[] = []
  const pending = [rootId]
  const seen = new Set<string>()
  while (pending.length) {
    const id = pending.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    pending.push(...(childrenByParent.get(id) || []))
  }
  return ids
}

export function salonCategoryLabel(value: string) {
  return isSalonCategory(value) ? SALON_CATEGORY_LABELS[value] : value
}
