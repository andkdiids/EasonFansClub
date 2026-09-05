/**
 * Browser-safe Salon types, constants and pure helpers.
 *
 * `lib/salon` owns Prisma queries and cursor (de)serialisation that relies on
 * the Node `Buffer` global, so it is server-only. Client components were
 * importing `salonCategoryLabel` from it, which pulled that whole server graph
 * — including Prisma and, through friend-remarks -> friends -> notifications ->
 * badge-service, `node:crypto` — into the browser bundle.
 *
 * Everything here is a plain value, type or pure function. Client components
 * must import from this module; server code can keep importing from
 * '@/lib/salon', which re-exports all of it.
 */

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

export type SalonRecommendationSeed = {
  value: string
  startedAt: Date
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
