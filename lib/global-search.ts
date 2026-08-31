import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'
import { POST_HOT_SCORE_SQL } from '@/lib/post-hot-score'

export const GLOBAL_SEARCH_USER_LIMIT = 10
export const GLOBAL_SEARCH_POST_PAGE_SIZE = 20
export const GLOBAL_SEARCH_MAX_PAGE = 100

export type GlobalSearchPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

const globalSearchUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  experience: true,
  createdAt: true,
  lastActiveAt: true,
  Profile: {
    select: {
      displayName: true,
      displayNameModerationStatus: true,
      avatarUrl: true,
      bio: true,
      bioModerationStatus: true,
    },
  },
  _count: {
    select: {
      Post: {
        where: { ...publicPostWhere, Board: { isActive: true } },
      },
    },
  },
} satisfies Prisma.UserSelect

export type GlobalSearchUser = Prisma.UserGetPayload<{ select: typeof globalSearchUserSelect }>

/**
 * Global search intentionally follows the public nickname/display-name
 * contract. `username` remains a login handle in this project and is not
 * exposed as a public search field.
 */
export function buildGlobalSearchUserWhere(keyword: string): Prisma.UserWhereInput {
  const numericUid = /^\d+$/.test(keyword) ? Number(keyword) : null

  return {
    uid: { gt: 0 },
    isDeleted: false,
    status: 'ACTIVE',
    Profile: { isNot: null },
    OR: [
      ...(Number.isSafeInteger(numericUid) && Number(numericUid) > 0 ? [{ uid: Number(numericUid) }] : []),
      { nickname: { contains: keyword } },
      { Profile: { displayName: { contains: keyword } } },
    ],
  }
}

export async function findGlobalSearchUsers(keyword: string): Promise<GlobalSearchUser[]> {
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) return []

  return prisma.user.findMany({
    where: buildGlobalSearchUserWhere(normalizedKeyword),
    select: globalSearchUserSelect,
    take: GLOBAL_SEARCH_USER_LIMIT,
  })
}

type GlobalSearchPostRow = {
  id: string
  title: string
  content: string
  summary: string | null
  ipRegion: string | null
  viewCount: number
  likeCount: number
  replyCount: number
  isPinned: boolean
  isFeatured: boolean
  createdAt: Date
  updatedAt: Date
  contentType: string
  favoriteCount: number
  isLocked: boolean
  isRecommended: boolean
  publishedAt: Date
  shareCount: number
  moderationStatus: string
  hotScore: number | string | bigint | Prisma.Decimal
  authorId: string
  authorUid: number
  authorNickname: string
  authorUsernameModerationStatus: string
  authorNicknameModerationStatus: string
  authorNicknameViolationDisplay: string | null
  authorAvatarUrl: string | null
  authorLevel: number
  authorDisplayName: string
  authorDisplayNameModerationStatus: string
  authorProfileAvatarUrl: string | null
  boardName: string
  boardSlug: string
}

export type GlobalSearchPost = Omit<GlobalSearchPostRow, 'hotScore' | 'authorUid' | 'authorNickname' | 'authorUsernameModerationStatus' | 'authorNicknameModerationStatus' | 'authorNicknameViolationDisplay' | 'authorAvatarUrl' | 'authorLevel' | 'authorDisplayName' | 'authorDisplayNameModerationStatus' | 'authorProfileAvatarUrl' | 'boardName' | 'boardSlug'> & {
  hotScore: number
  User: {
    id: string
    uid: number
    nickname: string
    usernameModerationStatus: string
    nicknameModerationStatus: string
    nicknameViolationDisplay: string | null
    level: number
    avatarUrl: string | null
    Profile: {
      displayName: string
      displayNameModerationStatus: string
      avatarUrl: string | null
    }
  }
  Board: { name: string; slug: string }
}

type GlobalSearchCountRow = { total: number | string | bigint }

function buildSearchPostFrom(keyword: string, authorIds: readonly string[]) {
  const pattern = `%${keyword}%`
  const authorMatch = authorIds.length
    ? Prisma.sql`p.authorId IN (${Prisma.join(authorIds)})`
    : Prisma.sql`1 = 0`

  return Prisma.sql`
    FROM Post p
    INNER JOIN User u ON u.id = p.authorId
    INNER JOIN Profile pr ON pr.userId = u.id
    INNER JOIN Board b ON b.id = p.boardId
    WHERE
      p.isDeleted = false
      AND p.status = 'PUBLISHED'
      AND p.moderationStatus IN ('APPROVED', 'VIOLATION')
      AND u.status = 'ACTIVE'
      AND u.isDeleted = false
      AND b.isActive = true
      AND (
        p.title LIKE ${pattern}
        OR p.content LIKE ${pattern}
        OR p.summary LIKE ${pattern}
        OR ${authorMatch}
      )
  `
}

function normalizeTotal(value: GlobalSearchCountRow['total']) {
  return Math.max(0, Number(value) || 0)
}

export function parseGlobalSearchPage(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || '1'), 10)
  return Math.min(GLOBAL_SEARCH_MAX_PAGE, Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : 1))
}

export function getGlobalSearchPagination(totalValue: number, requestedPage: number): GlobalSearchPagination {
  const total = Math.max(0, Math.trunc(totalValue) || 0)
  const totalPages = Math.min(GLOBAL_SEARCH_MAX_PAGE, Math.max(1, Math.ceil(total / GLOBAL_SEARCH_POST_PAGE_SIZE)))
  const page = Math.min(GLOBAL_SEARCH_MAX_PAGE, Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages))
  return {
    page,
    pageSize: GLOBAL_SEARCH_POST_PAGE_SIZE,
    total,
    totalPages,
    hasMore: page < totalPages,
  }
}

function mapGlobalSearchPost(row: GlobalSearchPostRow): GlobalSearchPost {
  const {
    hotScore,
    authorUid,
    authorNickname,
    authorUsernameModerationStatus,
    authorNicknameModerationStatus,
    authorNicknameViolationDisplay,
    authorAvatarUrl,
    authorLevel,
    authorDisplayName,
    authorDisplayNameModerationStatus,
    authorProfileAvatarUrl,
    boardName,
    boardSlug,
    ...post
  } = row

  return {
    ...post,
    hotScore: Number(hotScore),
    User: {
      id: row.authorId,
      uid: authorUid,
      nickname: authorNickname,
      usernameModerationStatus: authorUsernameModerationStatus,
      nicknameModerationStatus: authorNicknameModerationStatus,
      nicknameViolationDisplay: authorNicknameViolationDisplay,
      level: authorLevel,
      avatarUrl: authorAvatarUrl,
      Profile: {
        displayName: authorDisplayName,
        displayNameModerationStatus: authorDisplayNameModerationStatus,
        avatarUrl: authorProfileAvatarUrl,
      },
    },
    Board: { name: boardName, slug: boardSlug },
  }
}

export async function searchPublicPosts(keyword: string, authorIds: readonly string[], requestedPage = 1) {
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) {
    return { posts: [] as GlobalSearchPost[], pagination: getGlobalSearchPagination(0, requestedPage) }
  }

  const uniqueAuthorIds = [...new Set(authorIds.filter(Boolean))]
  const fromWhere = buildSearchPostFrom(normalizedKeyword, uniqueAuthorIds)

  return prisma.$transaction(async (tx) => {
    const countRows = await tx.$queryRaw<GlobalSearchCountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT p.id) AS total
      ${fromWhere}
    `)
    const pagination = getGlobalSearchPagination(normalizeTotal(countRows[0]?.total || 0), requestedPage)
    const offset = (pagination.page - 1) * pagination.pageSize
    const rows = await tx.$queryRaw<GlobalSearchPostRow[]>(Prisma.sql`
      SELECT DISTINCT
        p.id,
        p.title,
        p.content,
        p.summary,
        p.ipRegion,
        p.viewCount,
        p.likeCount,
        p.replyCount,
        p.isPinned,
        p.isFeatured,
        p.createdAt,
        p.updatedAt,
        p.contentType,
        p.favoriteCount,
        p.isLocked,
        p.isRecommended,
        p.publishedAt,
        p.shareCount,
        p.moderationStatus,
        ${POST_HOT_SCORE_SQL} AS hotScore,
        u.id AS authorId,
        u.uid AS authorUid,
        u.nickname AS authorNickname,
        u.usernameModerationStatus AS authorUsernameModerationStatus,
        u.nicknameModerationStatus AS authorNicknameModerationStatus,
        u.nicknameViolationDisplay AS authorNicknameViolationDisplay,
        u.avatarUrl AS authorAvatarUrl,
        u.level AS authorLevel,
        pr.displayName AS authorDisplayName,
        pr.displayNameModerationStatus AS authorDisplayNameModerationStatus,
        pr.avatarUrl AS authorProfileAvatarUrl,
        b.name AS boardName,
        b.slug AS boardSlug
      ${fromWhere}
      ORDER BY
        hotScore DESC,
        p.createdAt DESC,
        p.id DESC
      LIMIT ${pagination.pageSize} OFFSET ${offset}
    `)

    return { posts: rows.map(mapGlobalSearchPost), pagination }
  })
}
