import type { Prisma } from '@prisma/client'
import { getForumBoardDisplayName } from '@/lib/boards'
import { getShanghaiDateKey, parseBeijingDate, shiftShanghaiDateKey } from '@/lib/checkin'
import { publicContentImageMarkers, splitContentImages } from '@/lib/content-images'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { publicModerationText } from '@/lib/content-moderation'
import { postContentPlainText, summarizePlainText } from '@/lib/share-metadata'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'

export const RECENT_ACTIVITY_PAGE_SIZE = 20
export const RECENT_ACTIVITY_MAX_PAGE = 10_000

export const recentActivityTabs = ['likes', 'comments', 'views'] as const
export type RecentActivityTab = typeof recentActivityTabs[number]

export const recentActivityRanges = ['today', 'week', 'month', 'all'] as const
export type RecentActivityRange = typeof recentActivityRanges[number]

export function parseRecentActivityTab(value: unknown): RecentActivityTab {
  return recentActivityTabs.includes(value as RecentActivityTab) ? value as RecentActivityTab : 'likes'
}

export function parseRecentActivityRange(value: unknown): RecentActivityRange {
  return recentActivityRanges.includes(value as RecentActivityRange) ? value as RecentActivityRange : 'week'
}

export function parseRecentActivityPage(value: unknown) {
  const parsed = Number.parseInt(typeof value === 'string' || typeof value === 'number' ? String(value) : '', 10)
  return Math.min(RECENT_ACTIVITY_MAX_PAGE, Math.max(1, Number.isFinite(parsed) ? parsed : 1))
}

export type RecentActivityDateRange = Readonly<{
  start: Date | null
  end: Date | null
}>

/**
 * Date filters use Shanghai calendar days rather than the server's local
 * timezone. `end` is exclusive so a record at exactly the next midnight is
 * never included in the previous range.
 */
export function getRecentActivityDateRange(range: RecentActivityRange, now = new Date()): RecentActivityDateRange {
  if (range === 'all') return { start: null, end: null }

  const todayKey = getShanghaiDateKey(now)
  const startKey = range === 'today'
    ? todayKey
    : shiftShanghaiDateKey(todayKey, range === 'week' ? -6 : -29)
  const start = parseBeijingDate(startKey)
  const end = parseBeijingDate(shiftShanghaiDateKey(todayKey, 1))
  if (!start || !end) throw new Error('Unable to calculate Shanghai activity range')
  return { start, end }
}

function dateWhere(range: RecentActivityRange, now = new Date()) {
  const { start, end } = getRecentActivityDateRange(range, now)
  return start && end ? { createdAt: { gte: start, lt: end } } : {}
}

const visiblePostWhere = {
  ...publicPostWhere,
  User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } },
  Board: { isActive: true },
} satisfies Prisma.PostWhereInput

const activityPostSelect = {
  id: true,
  title: true,
  content: true,
  richContent: true,
  moderationStatus: true,
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
  Board: { select: { name: true, slug: true } },
  PostMedia: {
    where: { type: 'IMAGE' as const },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: 9,
    select: { url: true, thumbnail: true },
  },
} satisfies Prisma.PostSelect

type ActivityPostRow = Prisma.PostGetPayload<{ select: typeof activityPostSelect }>

const likeSelect = {
  id: true,
  createdAt: true,
  Post: { select: activityPostSelect },
} satisfies Prisma.LikeSelect

type LikeRow = Prisma.LikeGetPayload<{ select: typeof likeSelect }>

const commentSelect = {
  id: true,
  postId: true,
  content: true,
  moderationStatus: true,
  createdAt: true,
} satisfies Prisma.ReplySelect

type CommentRow = Prisma.ReplyGetPayload<{ select: typeof commentSelect }>

export type RecentActivityPost = Readonly<{
  id: string
  title: string
  summary: string
  author: Readonly<{
    id: string
    uid: number
    name: string
    avatarUrl: string | null
  }>
  board: Readonly<{ name: string; slug: string }>
  imageUrl: string | null
  imageCount: number
}>

export type RecentActivityItem = Readonly<{
  kind: 'LIKE' | 'COMMENT'
  id: string
  occurredAt: string
  commentSummary?: string
  post: RecentActivityPost
}>

export type RecentActivityPage = Readonly<{
  tab: RecentActivityTab
  range: RecentActivityRange
  page: number
  pageSize: number
  items: RecentActivityItem[]
  total?: number
  hasMore: boolean
  available: boolean
  unavailableMessage?: string
}>

function mapPost(row: ActivityPostRow): RecentActivityPost {
  const publicContent = publicContentImageMarkers(row.content)
  const richContent = row.moderationStatus === 'VIOLATION' ? null : row.richContent
  const summarySource = postContentPlainText(publicContent, richContent)
  const embeddedImages = splitContentImages(publicContent).images
  const mediaImages = row.PostMedia.flatMap((media) => {
    const imageUrl = publicImageVariantUrl(media.thumbnail || media.url, 'thumb-md')
    return imageUrl ? [imageUrl] : []
  })
  const imageUrls = [...new Set([...mediaImages, ...embeddedImages])]

  return {
    id: row.id,
    title: publicModerationText(row.title, row.moderationStatus),
    summary: publicModerationText(summarizePlainText(summarySource, 180), row.moderationStatus) || '暂无正文摘要',
    author: {
      id: row.User.id,
      uid: row.User.uid,
      name: getPublicUserDisplayName(row.User),
      avatarUrl: publicImageVariantUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl, 'avatar-sm'),
    },
    board: { name: getForumBoardDisplayName(row.Board), slug: row.Board.slug },
    imageUrl: imageUrls[0] || null,
    imageCount: imageUrls.length,
  }
}

function mapLike(row: LikeRow): RecentActivityItem {
  return {
    kind: 'LIKE',
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    post: mapPost(row.Post),
  }
}

function mapComment(row: CommentRow, post: ActivityPostRow): RecentActivityItem {
  const content = publicContentImageMarkers(row.content)
  return {
    kind: 'COMMENT',
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    commentSummary: publicModerationText(summarizePlainText(postContentPlainText(content), 140), row.moderationStatus) || '评论内容已隐藏',
    post: mapPost(post),
  }
}

export async function getRecentLikesPage(userId: string, range: RecentActivityRange, page: number, now = new Date()) {
  const where: Prisma.LikeWhereInput = {
    userId,
    Post: visiblePostWhere,
    ...dateWhere(range, now),
  }
  const [total, rows] = await Promise.all([
    prisma.like.count({ where }),
    prisma.like.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * RECENT_ACTIVITY_PAGE_SIZE,
      take: RECENT_ACTIVITY_PAGE_SIZE,
      select: likeSelect,
    }),
  ])
  return {
    items: rows.map(mapLike),
    total,
    hasMore: page * RECENT_ACTIVITY_PAGE_SIZE < total,
  }
}

const emptyCommentPage = { items: [] as RecentActivityItem[], hasMore: false }

export async function getRecentCommentsPage(userId: string, range: RecentActivityRange, page: number, now = new Date()) {
  const where: Prisma.ReplyWhereInput = {
    authorId: userId,
    isDeleted: false,
    deletedAt: null,
    Post: visiblePostWhere,
    ...dateWhere(range, now),
  }
  const groups = await prisma.reply.groupBy({
    by: ['postId'],
    where,
    _max: { createdAt: true },
    orderBy: [{ _max: { createdAt: 'desc' } }, { postId: 'desc' }],
    skip: (page - 1) * RECENT_ACTIVITY_PAGE_SIZE,
    take: RECENT_ACTIVITY_PAGE_SIZE + 1,
  })
  if (!groups.length) return emptyCommentPage

  const pageGroups = groups.slice(0, RECENT_ACTIVITY_PAGE_SIZE)
  const latestConditions = pageGroups.flatMap((group) => {
    const createdAt = group._max.createdAt
    return createdAt ? [{ postId: group.postId, createdAt }] : []
  })
  if (!latestConditions.length) return emptyCommentPage

  const [latestRows, posts] = await Promise.all([
    prisma.reply.findMany({
      where: { ...where, OR: latestConditions },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: commentSelect,
    }),
    prisma.post.findMany({
      where: { ...visiblePostWhere, id: { in: pageGroups.map((group) => group.postId) } },
      select: activityPostSelect,
    }),
  ])
  const postById = new Map(posts.map((post) => [post.id, post]))
  const commentByPostId = new Map<string, CommentRow>()
  latestRows.forEach((row) => {
    if (!commentByPostId.has(row.postId)) commentByPostId.set(row.postId, row)
  })
  const items = pageGroups.flatMap((group) => {
    const comment = commentByPostId.get(group.postId)
    const post = postById.get(group.postId)
    return comment && post ? [mapComment(comment, post)] : []
  })

  return {
    items,
    hasMore: groups.length > RECENT_ACTIVITY_PAGE_SIZE,
  }
}

export async function getRecentActivityPage({
  userId,
  tab,
  range,
  page,
  now = new Date(),
}: Readonly<{
  userId: string
  tab: RecentActivityTab
  range: RecentActivityRange
  page: number
  now?: Date
}>): Promise<RecentActivityPage> {
  const safePage = parseRecentActivityPage(page)
  if (tab === 'views') {
    return {
      tab,
      range,
      page: safePage,
      pageSize: RECENT_ACTIVITY_PAGE_SIZE,
      items: [],
      hasMore: false,
      available: false,
      unavailableMessage: '浏览历史需要启用账号级记录，当前暂未开放。',
    }
  }

  if (tab === 'likes') {
    const result = await getRecentLikesPage(userId, range, safePage, now)
    return {
      tab,
      range,
      page: safePage,
      pageSize: RECENT_ACTIVITY_PAGE_SIZE,
      items: result.items,
      total: result.total,
      hasMore: result.hasMore,
      available: true,
    }
  }

  const result = await getRecentCommentsPage(userId, range, safePage, now)
  return {
    tab,
    range,
    page: safePage,
    pageSize: RECENT_ACTIVITY_PAGE_SIZE,
    items: result.items,
    hasMore: result.hasMore,
    available: true,
  }
}
