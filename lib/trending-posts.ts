import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

export const TRENDING_PAGE_SIZE = 15
export type TrendingRange = 7 | 30

export type TrendingPost = {
  id: string
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
        COALESCE(NULLIF(p.summary, ''), LEFT(p.content, 180)) AS summary,
        p.viewCount,
        p.likeCount,
        p.replyCount,
        p.favoriteCount,
        p.createdAt,
        p.updatedAt,
        (p.viewCount * 0.08 + p.likeCount * 3 + p.replyCount * 5 + p.favoriteCount * 4) AS hotScore,
        u.uid AS authorUid,
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
        hotScore: Number(row.hotScore),
      })),
    }
  },
  ['trending-posts-v1'],
  { revalidate: 60, tags: ['trending-posts'] },
)
