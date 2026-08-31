import type { Prisma } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { getProfileRecordPagination } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'

export const SALON_CATEGORIES = ['CONCERT', 'MOBILE_WALLPAPER', 'DESKTOP_WALLPAPER', 'TIME_TRAVEL'] as const
export type SalonCategoryValue = typeof SALON_CATEGORIES[number]

/** Every Salon upload retains an untouched source; only public display variants are optimized. */
export function supportsOriginal(category: SalonCategoryValue | string) {
  return SALON_CATEGORIES.includes(category as SalonCategoryValue)
}

/** Naming alias for upload code that describes the persistence decision. */
export const shouldPreserveOriginal = supportsOriginal

export const SALON_CATEGORY_LABELS: Record<SalonCategoryValue, string> = {
  CONCERT: '演唱会记录',
  MOBILE_WALLPAPER: '手机壁纸',
  DESKTOP_WALLPAPER: '电脑壁纸',
  TIME_TRAVEL: '时光倒流二十年',
}

export const SALON_CATEGORY_HINTS: Record<SalonCategoryValue, string> = {
  CONCERT: '上传你在现场拍摄的照片。',
  MOBILE_WALLPAPER: '适合手机竖屏使用的高清图片。',
  DESKTOP_WALLPAPER: '适合电脑横屏使用的高清图片。',
  TIME_TRAVEL: '分享与陈奕迅有关的早年生活照、公开影像和珍贵历史记录。',
}

export const SALON_POST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type SalonPostStatusValue = typeof SALON_POST_STATUSES[number]
export const SALON_STATUS_LABELS: Record<SalonPostStatusValue, string> = {
  PENDING: '审核中',
  APPROVED: '已通过',
  REJECTED: '未通过',
}

export const SALON_PAGE_SIZE = 24
export const SALON_COMMENT_PAGE_SIZE = 40

export type SalonSort = 'latest' | 'popular'

export type SalonFilters = {
  category?: SalonCategoryValue
  tourId?: string
  sessionId?: string
  sort?: SalonSort
  cursor?: string
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
  return {
    ...(category ? { category } : {}),
    ...(tourId ? { tourId } : {}),
    ...(sessionId ? { sessionId } : {}),
    sort: parseSalonSort(get('sort')),
  }
}

type SalonCursor = {
  id: string
  approvedAt: string
  likeCount?: number
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
          { likeCount: { lt: cursor.likeCount || 0 } },
          { likeCount: cursor.likeCount || 0, approvedAt: { lt: approvedAt } },
          { likeCount: cursor.likeCount || 0, approvedAt, id: { lt: cursor.id } },
        ],
      }],
    }
  }
  return {
    ...where,
    AND: [{ OR: [{ approvedAt: { lt: approvedAt } }, { approvedAt, id: { lt: cursor.id } }] }],
  }
}

export async function getSalonPosts(filters: SalonFilters = {}, viewerId?: string | null) {
  const sort = parseSalonSort(filters.sort)
  const cursor = decodeSalonCursor(filters.cursor)
  const where = addCursorWhere(buildSalonFeedWhere(filters), sort, cursor)
  const rows = await prisma.salonPost.findMany({
    where,
    orderBy: sort === 'popular'
      ? [{ likeCount: 'desc' }, { approvedAt: 'desc' }, { id: 'desc' }]
      : [{ approvedAt: 'desc' }, { id: 'desc' }],
    take: SALON_PAGE_SIZE + 1,
    select: salonPostSelect,
  })
  const hasMore = rows.length > SALON_PAGE_SIZE
  const pageRows = rows.slice(0, SALON_PAGE_SIZE)
  const likedIds = viewerId && pageRows.length
    ? new Set((await prisma.salonPostLike.findMany({
      where: { userId: viewerId, postId: { in: pageRows.map((row) => row.id) } },
      select: { postId: true },
    })).map((row) => row.postId))
    : new Set<string>()
  const last = pageRows[pageRows.length - 1]
  return {
    posts: pageRows.map((row) => serializeSalonPost(row, likedIds.has(row.id))),
    hasMore,
    nextCursor: hasMore && last?.approvedAt
      ? encodeSalonCursor({ id: last.id, approvedAt: last.approvedAt.toISOString(), likeCount: last.likeCount })
      : null,
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
