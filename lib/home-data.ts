import { startOfLocalDay } from '@/lib/checkin'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export const homeCacheHeaders = {
  'Cache-Control': 'public, max-age=20, s-maxage=60, stale-while-revalidate=120',
}

function excerpt(value: string | null | undefined, length = 180) {
  if (!value) return ''
  return value.length > length ? `${value.slice(0, length)}...` : value
}

export async function getHomePosts() {
  const baseWhere = {
    isDeleted: false,
    status: 'PUBLISHED' as const,
    author: { status: 'ACTIVE' as const, isDeleted: false, profile: { isNot: null } },
  }
  const featuredWhere = { ...baseWhere, isFeatured: true }
  const select = {
    id: true,
    title: true,
    summary: true,
    content: true,
    likeCount: true,
    replyCount: true,
    viewCount: true,
    isPinned: true,
    isFeatured: true,
    createdAt: true,
    board: { select: { name: true, slug: true } },
    author: {
      select: {
        uid: true,
        nickname: true,
        level: true,
        profile: { select: { displayName: true } },
      },
    },
  }

  const rows = await safeDb(
    'Post.findMany home.posts.featured',
    Promise.all([
      prisma.post.findMany({
        where: featuredWhere,
        orderBy: [{ likeCount: 'desc' }, { createdAt: 'desc' }],
        take: 3,
        select,
      }),
      prisma.post.findMany({
        where: featuredWhere,
        orderBy: [{ replyCount: 'desc' }, { createdAt: 'desc' }],
        take: 3,
        select,
      }),
      prisma.post.findMany({
        where: baseWhere,
        orderBy: [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        select,
      }),
    ]).then(([likeCandidates, replyCandidates, fallbackCandidates]) => {
      const selected = new Map<string, (typeof likeCandidates)[number]>()
      likeCandidates.slice(0, 2).forEach((post) => selected.set(post.id, post))
      replyCandidates.filter((post) => !selected.has(post.id)).slice(0, 1).forEach((post) => selected.set(post.id, post))

      if (selected.size < 3) {
        ;[...likeCandidates, ...replyCandidates, ...fallbackCandidates]
          .filter((post) => !selected.has(post.id))
          .forEach((post) => {
            if (selected.size < 3) selected.set(post.id, post)
          })
      }

      return Array.from(selected.values()).slice(0, 3)
    }),
    [],
    2500,
  )

  return rows.map(({ summary, content, ...post }) => ({
    ...post,
    content: excerpt(summary || content),
  }))
}

export async function getHomeDailyMessages() {
  const today = startOfLocalDay()
  const rows = await safeDb(
    'DailyMessage.findMany home.dailyMessages',
    prisma.dailyMessage.findMany({
      where: {
        date: today,
        isDeleted: false,
        user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      },
      orderBy: [{ isFeatured: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }],
      take: 4,
      select: {
        id: true,
        mood: true,
        content: true,
        user: {
          select: {
            uid: true,
            nickname: true,
            level: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
    [],
    2500,
  )

  return rows.map((message) => ({ ...message, content: excerpt(message.content, 120) }))
}

export async function getHomeActivities() {
  return safeDb(
    'Activity.findMany home.activities',
    prisma.activity.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, title: true, description: true, coverUrl: true, startsAt: true },
    }),
    [],
    2000,
  )
}

export async function getHomeTracks() {
  return safeDb(
    'MusicTrack.findMany home.music',
    prisma.musicTrack.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 4,
      select: { id: true, title: true, artist: true, isPlayable: true },
    }),
    [],
    2000,
  )
}
