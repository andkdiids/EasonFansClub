import { Prisma } from '@prisma/client'
import { isAnywhereDoorAccountUsername, readManualAnywhereDoorAvatar, resolveAnywhereDoorAvatar, safePublicAnywhereDoorAvatarUrl } from '@/lib/anywhere-door/avatar'
import { isPublicMediaProxyUrl, toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'

export const DEFAULT_SOCIAL_PAGE_SIZE = 20
export const MAX_SOCIAL_PAGE_SIZE = 50

type SocialCursor = { publishedAt: string; id: string }

export type SocialPostMediaView = {
  id: string
  type: 'IMAGE' | 'VIDEO'
  url: string
  thumbnailUrl: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  sortOrder: number
}

export type SocialPostView = {
  id: string
  externalId: string
  shortcode: string | null
  authorUsername: string
  authorAvatarUrl: string | null
  caption: string | null
  publishedAt: string
  permalink: string | null
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'REEL'
  media: SocialPostMediaView[]
  likeCount: number
  commentCount: number
  viewerLiked: boolean
}

export type SocialReplyView = {
  id: string
  content: string
  createdAt: string
  author: { id: string; nickname: string }
  canDelete: boolean
}

export type SocialCommentView = SocialReplyView & {
  replies: SocialReplyView[]
  replyCount: number
  repliesNextCursor?: string | null
}

export type SocialPostDetailView = SocialPostView & {
  comments: SocialCommentView[]
  commentsNextCursor: string | null
}

type SocialPostRow = Prisma.SocialPostGetPayload<{ select: typeof publicPostSelect }>

/* Keep the public projection explicit so a pending optional avatar migration
   cannot take the feed down before the column exists in a local database. */
const publicPostSelect = {
  id: true,
  platform: true,
  externalId: true,
  shortcode: true,
  authorUsername: true,
  authorDisplayName: true,
  caption: true,
  permalink: true,
  publishedAt: true,
  syncedAt: true,
  mediaType: true,
  status: true,
  provider: true,
  createdAt: true,
  updatedAt: true,
  media: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { likes: true, comments: true } },
} satisfies Prisma.SocialPostSelect

function pageSize(value: number | string | null | undefined, fallback = DEFAULT_SOCIAL_PAGE_SIZE) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.min(MAX_SOCIAL_PAGE_SIZE, Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : fallback))
}

export function encodeSocialCursor(cursor: SocialCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeSocialCursor(value: string | null | undefined): SocialCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SocialCursor>
    const date = new Date(String(decoded.publishedAt || ''))
    if (!decoded.id || !/^[a-zA-Z0-9_-]{1,191}$/.test(decoded.id) || !Number.isFinite(date.getTime())) return null
    return { id: decoded.id, publishedAt: date.toISOString() }
  } catch {
    return null
  }
}

function safePublicMediaUrl(value?: string | null) {
  const url = toPublicMediaUrl(value)
  if (!url) return null
  if (isPublicMediaProxyUrl(url)) return url
  try {
    const parsed = new URL(url, 'https://local.invalid')
    return parsed.origin === 'https://local.invalid' && parsed.pathname.startsWith('/') && !parsed.username && !parsed.password
      ? url
      : null
  } catch {
    return null
  }
}

let authorAvatarColumnAvailable: boolean | null = null

/**
 * Reads the optional avatar column in one bounded query. The query is
 * intentionally best-effort so a database awaiting the accompanying
 * migration continues to render the source fallback instead of failing the
 * whole public feed.
 */
export async function readStoredAuthorAvatarUrls(postIds: readonly string[]) {
  if (!postIds.length || authorAvatarColumnAvailable === false) return new Map<string, string>()
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; authorAvatarUrl: string | null }>>(Prisma.sql`SELECT id, authorAvatarUrl FROM SocialPost WHERE id IN (${Prisma.join([...postIds])})`)
    authorAvatarColumnAvailable = true
    const result = new Map<string, string>()
    for (const row of rows) {
      const url = safePublicAnywhereDoorAvatarUrl(row.authorAvatarUrl)
      if (url) result.set(row.id, url)
    }
    return result
  } catch {
    authorAvatarColumnAvailable = false
    return new Map<string, string>()
  }
}

function serializeMedia(row: SocialPostRow['media'][number]): SocialPostMediaView | null {
  const url = safePublicMediaUrl(row.storageUrl)
  if (!url) return null
  return {
    id: row.id,
    type: row.type,
    url,
    thumbnailUrl: safePublicMediaUrl(row.thumbnailUrl),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sortOrder: row.sortOrder,
  }
}

async function viewerLikeIds(postIds: string[], viewerId?: string | null) {
  if (!viewerId || !postIds.length) return new Set<string>()
  const rows = await prisma.socialPostLike.findMany({
    where: { userId: viewerId, postId: { in: postIds } },
    select: { postId: true },
  })
  return new Set(rows.map((row) => row.postId))
}

function serializePost(row: SocialPostRow, likedIds: Set<string>, autoAvatarUrl?: string | null, manualAvatarUrl?: string | null): SocialPostView {
  const avatar = resolveAnywhereDoorAvatar({
    manualAvatarUrl: isAnywhereDoorAccountUsername(row.authorUsername) ? manualAvatarUrl : null,
    autoAvatarUrl,
  })
  return {
    id: row.id,
    externalId: row.externalId,
    shortcode: row.shortcode,
    authorUsername: row.authorUsername,
    authorAvatarUrl: avatar.url,
    caption: row.caption,
    publishedAt: row.publishedAt.toISOString(),
    permalink: row.permalink,
    mediaType: row.mediaType,
    media: row.media.map(serializeMedia).filter((media): media is SocialPostMediaView => Boolean(media)),
    likeCount: row._count.likes,
    commentCount: row._count.comments,
    viewerLiked: likedIds.has(row.id),
  }
}

export async function getPublicSocialPostFeed(options: { cursor?: string | null; limit?: number; viewerId?: string | null } = {}) {
  const take = pageSize(options.limit)
  const cursor = decodeSocialCursor(options.cursor)
  const where: Prisma.SocialPostWhereInput = {
    status: 'READY',
    ...(cursor ? {
      OR: [
        { publishedAt: { lt: new Date(cursor.publishedAt) } },
        { publishedAt: new Date(cursor.publishedAt), id: { lt: cursor.id } },
      ],
    } : {}),
  }
  const rows = await prisma.socialPost.findMany({
    where,
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    select: publicPostSelect,
  })
  const hasMore = rows.length > take
  const pageRows = rows.slice(0, take)
  const [likedIds, authorAvatarUrls, manualAvatarUrl] = await Promise.all([
    viewerLikeIds(pageRows.map((row) => row.id), options.viewerId),
    readStoredAuthorAvatarUrls(pageRows.map((row) => row.id)),
    readManualAnywhereDoorAvatar(),
  ])
  const last = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map((row) => serializePost(row, likedIds, authorAvatarUrls.get(row.id), manualAvatarUrl)),
    nextCursor: hasMore && last ? encodeSocialCursor({ publishedAt: last.publishedAt.toISOString(), id: last.id }) : null,
  }
}

const commentAuthorSelect = {
  id: true,
  nickname: true,
} satisfies Prisma.UserSelect

function publicCommentAuthor(author: { id: string; nickname: string }) {
  return { id: author.id, nickname: author.nickname }
}

type SocialCommentCursor = { createdAt: string; id: string }

export function encodeSocialCommentCursor(cursor: SocialCommentCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeSocialCommentCursor(value: string | null | undefined): SocialCommentCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SocialCommentCursor>
    const date = new Date(String(decoded.createdAt || ''))
    if (!decoded.id || !/^[a-zA-Z0-9_-]{1,191}$/.test(decoded.id) || !Number.isFinite(date.getTime())) return null
    return { id: decoded.id, createdAt: date.toISOString() }
  } catch {
    return null
  }
}

export async function getPublicSocialPostComments(options: {
  postId: string
  parentId?: string | null
  cursor?: string | null
  limit?: number | string | null
  viewerId?: string | null
}) {
  const parentId = options.parentId || null
  const take = pageSize(options.limit, parentId ? 3 : DEFAULT_SOCIAL_PAGE_SIZE)
  const cursor = decodeSocialCommentCursor(options.cursor)
  const where: Prisma.SocialPostCommentWhereInput = {
    postId: options.postId,
    deletedAt: null,
    parentId,
    ...(cursor ? {
      OR: [
        { createdAt: { gt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
      ],
    } : {}),
  }

  const rows = await prisma.socialPostComment.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: take + 1,
    include: {
      author: { select: commentAuthorSelect },
      _count: { select: { replies: true } },
    },
  })
  const hasMore = rows.length > take
  const pageRows = rows.slice(0, take)
  const last = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && last ? encodeSocialCommentCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null

  if (parentId) {
    return {
      comments: pageRows.map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
        author: publicCommentAuthor(comment.author),
        canDelete: comment.author.id === options.viewerId,
        replies: [],
        replyCount: 0,
        repliesNextCursor: null,
      })),
      nextCursor,
      replyCount: await prisma.socialPostComment.count({ where: { postId: options.postId, parentId, deletedAt: null } }),
    }
  }

  return {
    comments: pageRows.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      author: publicCommentAuthor(comment.author),
      canDelete: comment.author.id === options.viewerId,
      replies: [],
      replyCount: comment._count.replies,
      repliesNextCursor: comment._count.replies > 0 ? null : null,
    })),
    nextCursor,
    replyCount: null,
  }
}

export async function getPublicSocialPostDetail(id: string, viewerId?: string | null): Promise<SocialPostDetailView | null> {
  const row = await prisma.socialPost.findFirst({ where: { id, status: 'READY' }, select: publicPostSelect })
  if (!row) return null
  const [likedIds, authorAvatarUrls, manualAvatarUrl] = await Promise.all([
    viewerLikeIds([row.id], viewerId),
    readStoredAuthorAvatarUrls([row.id]),
    readManualAnywhereDoorAvatar(),
  ])
  const post = serializePost(row, likedIds, authorAvatarUrls.get(row.id), manualAvatarUrl)
  const comments = await getPublicSocialPostComments({ postId: id, viewerId })
  return {
    ...post,
    comments: comments.comments,
    commentsNextCursor: comments.nextCursor,
  }
}

export async function getAdminSocialPosts(options: { status?: string | null; page?: number; pageSize?: number } = {}) {
  const take = pageSize(options.pageSize || 20)
  const page = Math.max(1, Math.floor(options.page || 1))
  const status = options.status && ['DISCOVERED', 'DOWNLOADING', 'READY', 'FAILED', 'HIDDEN', 'SOURCE_DELETED'].includes(options.status)
    ? options.status as Prisma.SocialPostWhereInput['status']
    : undefined
  const where: Prisma.SocialPostWhereInput = status ? { status } : {}
  const [rows, total] = await Promise.all([
    prisma.socialPost.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * take,
      take,
      select: publicPostSelect,
    }),
    prisma.socialPost.count({ where }),
  ])
  const likedIds = new Set<string>()
  return { items: rows.map((row) => ({ ...serializePost(row, likedIds), status: row.status })), total, page, pageSize: take }
}

export async function getRecentSocialSyncLogs(limit = 20) {
  return prisma.socialSyncLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.min(50, Math.max(1, Math.floor(limit))),
    select: {
      id: true, provider: true, target: true, startedAt: true, finishedAt: true,
      actor: true, runId: true, datasetId: true, runStatus: true,
      runStartedAt: true, runFinishedAt: true, usageTotalUsd: true, billableResults: true,
      status: true, foundCount: true, createdCount: true, updatedCount: true,
      mediaCount: true, notificationCount: true, baselineImport: true, durationMs: true, errorCode: true, errorMessage: true,
    },
  })
}
