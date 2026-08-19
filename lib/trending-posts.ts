import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { publicContentImageMarkers } from '@/lib/content-images'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { publicModerationText, VIOLATION_USER_TEXT } from '@/lib/content-moderation'

export const TRENDING_PAGE_SIZE = 15
export type TrendingRange = 7 | 30

export type TrendingPost = {
  id: string
  authorId: string
  title: string
  summary: string
  viewCount: number
  likeCount: number
  replyCount: number
  favoriteCount: number
  createdAt: Date
  updatedAt: Date
  hotScore: number
  authorUid: number
  authorName: string
  authorAvatarUrl: string | null
  boardName: string
  boardSlug: string
  imageUrl: string | null
  moderationStatus: string
  usernameModerationStatus: string
  nicknameModerationStatus: string
  nicknameViolationDisplay: string | null
  displayNameModerationStatus: string | null
}

type TrendingPostRow = Omit<TrendingPost, 'hotScore'> & {
  hotScore: number | string | Prisma.Decimal
}

function normalizeRange(value: number): TrendingRange {
  return value === 30 ? 30 : 7
}

export const getTrendingPosts = unstable_cache(
  async (rangeValue: number, pageValue: number) => {
    const range = normalizeRange(rangeValue)
    const page = Math.min(100, Math.max(1, Math.trunc(pageValue) || 1))
    const skip = (page - 1) * TRENDING_PAGE_SIZE
    const cutoff = new Date(Date.now() - range * 24 * 60 * 60 * 1000)
    const take = TRENDING_PAGE_SIZE + 1

    // Bounded, indexed time-window query. The score intentionally gives replies
    // and favorites more weight than passive views.
    const rows = await prisma.$queryRaw<TrendingPostRow[]>(Prisma.sql`
      SELECT
        p.id,
        p.title,
        p.moderationStatus,
        COALESCE(NULLIF(p.summary, ''), LEFT(p.content, 180)) AS summary,
        p.viewCount,
        p.likeCount,
        p.replyCount,
        p.favoriteCount,
        p.createdAt,
        p.updatedAt,
        (p.viewCount * 0.08 + p.likeCount * 3 + p.replyCount * 5 + p.favoriteCount * 4) AS hotScore,
        u.id AS authorId,
        u.uid AS authorUid,
        u.usernameModerationStatus,
        u.nicknameModerationStatus,
        u.nicknameViolationDisplay,
        pr.displayNameModerationStatus,
        COALESCE(NULLIF(pr.displayName, ''), u.nickname) AS authorName,
        COALESCE(NULLIF(pr.avatarUrl, ''), u.avatarUrl) AS authorAvatarUrl,
        b.name AS boardName,
        b.slug AS boardSlug,
        (
          SELECT pm.url
          FROM PostMedia pm
          WHERE pm.postId = p.id AND pm.type = 'IMAGE'
          ORDER BY pm.sortOrder ASC, pm.createdAt ASC
          LIMIT 1
        ) AS imageUrl
      FROM Post p
      INNER JOIN User u ON u.id = p.authorId
      INNER JOIN Profile pr ON pr.userId = u.id
      INNER JOIN Board b ON b.id = p.boardId
      WHERE
        p.createdAt >= ${cutoff}
        AND p.status = 'PUBLISHED'
        AND p.moderationStatus IN ('APPROVED', 'VIOLATION')
        AND p.isDeleted = false
        AND u.status = 'ACTIVE'
        AND u.isDeleted = false
        AND b.isActive = true
      ORDER BY
        hotScore DESC,
        p.updatedAt DESC,
        p.createdAt DESC,
        p.id DESC
      LIMIT ${take} OFFSET ${skip}
    `)

    return {
      range,
      page,
      hasMore: rows.length > TRENDING_PAGE_SIZE,
      posts: rows.slice(0, TRENDING_PAGE_SIZE).map((row) => ({
        ...row,
        title: publicModerationText(row.title, row.moderationStatus),
        summary: publicModerationText(publicContentImageMarkers(row.summary), row.moderationStatus),
        // 昵称违规优先展示唯一违规展示昵称，与 getPublicUserDisplayName 保持一致
        authorName: row.nicknameModerationStatus === 'VIOLATION'
          ? (row.nicknameViolationDisplay || VIOLATION_USER_TEXT)
          : row.usernameModerationStatus === 'VIOLATION' || row.displayNameModerationStatus === 'VIOLATION'
            ? VIOLATION_USER_TEXT
            : row.authorName,
        hotScore: Number(row.hotScore),
        authorAvatarUrl: publicImageUrl(row.authorAvatarUrl),
        imageUrl: publicImageUrl(row.imageUrl),
      })),
    }
  },
  ['trending-posts-v1'],
  { revalidate: 60, tags: ['trending-posts'] },
)
