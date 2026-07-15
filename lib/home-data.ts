import { startOfLocalDay } from '@/lib/checkin'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export const homeCacheHeaders = {
  'Cache-Control': 'public, max-age=20, s-maxage=60, stale-while-revalidate=120',
}

const homeDataCacheTtlMs = Number(process.env.HOME_DATA_CACHE_TTL_MS || 30000)
const homeDataCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>()

async function cachedHomeData<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const cached = homeDataCache.get(key)
  if (cached && cached.expiresAt > now) return cached.promise as Promise<T>

  const promise = loader().catch((error) => {
    homeDataCache.delete(key)
    throw error
  })
  homeDataCache.set(key, { expiresAt: now + homeDataCacheTtlMs, promise })
  return promise
}

function excerpt(value: string | null | undefined, length = 180) {
  if (!value) return ''
  return value.length > length ? `${value.slice(0, length)}...` : value
}

export async function getHomePosts() {
  return cachedHomeData('home.posts', getHomePostsUncached)
}

async function getHomePostsUncached() {
  const baseWhere = {
    isDeleted: false,
    status: 'PUBLISHED' as const,
    author: { status: 'ACTIVE' as const, isDeleted: false, profile: { isNot: null } },
  }
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
    'Post.findMany home.posts',
    prisma.post.findMany({
      where: baseWhere,
      orderBy: [{ isFeatured: 'desc' }, { likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      select,
    }).then((candidates) => {
      const selected = new Map<string, (typeof candidates)[number]>()
      candidates
        .filter((post) => post.isFeatured)
        .slice(0, 3)
        .forEach((post) => selected.set(post.id, post))

      candidates.forEach((post) => {
        if (selected.size < 3) selected.set(post.id, post)
      })

      return Array.from(selected.values()).slice(0, 3)
    }),
    [],
    8000,
  )

  return rows.map(({ summary, content, ...post }) => ({
    ...post,
    content: excerpt(summary || content),
  }))
}

export async function getHomeDailyMessages() {
  return cachedHomeData('home.dailyMessages', getHomeDailyMessagesUncached)
}

async function getHomeDailyMessagesUncached() {
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
  return cachedHomeData('home.activities', () => safeDb(
    'Activity.findMany home.activities',
    prisma.activity.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, title: true, description: true, coverUrl: true, startsAt: true },
    }),
    [],
    5000,
  ))
}

export async function getHomeTracks() {
  return cachedHomeData('home.tracks', () => safeDb(
    'MusicTrack.findMany home.music',
    prisma.musicTrack.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 4,
      select: { id: true, title: true, artist: true, isPlayable: true },
    }),
    [],
    5000,
  ))
}
