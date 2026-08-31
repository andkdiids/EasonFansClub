import { unstable_cache } from 'next/cache'
import { getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { withForumBoardDisplayName } from '@/lib/boards'
import { getDailyMusicRecommendation, getFallbackDailyMusicRecommendation } from '@/lib/daily-music'
import { safeDb } from '@/lib/db-timeout'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getGuessSongModeHighScores } from '@/lib/guess-song-leaderboard'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { prisma } from '@/lib/prisma'
import { getTodayMonthDay } from '@/lib/today'
import { countTodayBirthdays } from '@/lib/birthday'
import { getTodayCheckInCount } from '@/lib/checkin-stats'
import { getTodayEventRecords } from '@/lib/today-events'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { getEasMusicAlbumLikeStates } from '@/lib/easmusic-likes'
import { htmlToPlainText, summarizePlainText } from '@/lib/share-metadata'
import { ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'

export const homeCacheHeaders = {
  'Cache-Control': 'public, max-age=20, s-maxage=60, stale-while-revalidate=120',
}

// The homepage post module is public featured/pinned content. Keep this cache
// separate from the user-specific /api/home response and its like state.
export const HOME_FEATURED_POSTS_CACHE_KEY = 'home:hot-posts:v2'
export const HOME_FEATURED_POSTS_CACHE_TAG = 'home-featured-posts'
export const HOME_FEATURED_POSTS_CACHE_TTL_SECONDS = 60

const homeDataCacheTtlMs = Number(process.env.HOME_DATA_CACHE_TTL_MS || 30000)
const homeDataCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>()

export function invalidateHomeDataCache() {
  homeDataCache.clear()
}

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

const publicPostModerationStatuses: Array<'APPROVED' | 'VIOLATION'> = ['APPROVED', 'VIOLATION']

export async function getHomePosts(userId?: string) {
  // Only the public post projection and public author badge are cached. The
  // current user's Like relation is deliberately queried after the cache.
  const posts = await getCachedHomePostsWithFallback()
  if (!userId || posts.length === 0) return posts.map((post) => ({ ...post, likedByMe: false }))
  const liked = await prisma.like.findMany({
    where: { userId, postId: { in: posts.map((post) => post.id) } },
    select: { postId: true },
  })
  const likedIds = new Set(liked.map((item) => item.postId))
  return posts.map((post) => ({ ...post, likedByMe: likedIds.has(post.id) }))
}

async function queryHomePosts() {
  const baseWhere = {
    isDeleted: false,
    status: 'PUBLISHED' as const,
    moderationStatus: { in: publicPostModerationStatuses },
    OR: [{ isFeatured: true }, { isPinned: true }],
    User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } },
  }
  const select = {
    id: true,
    title: true,
    summary: true,
    content: true,
    moderationStatus: true,
    likeCount: true,
    replyCount: true,
    viewCount: true,
    isPinned: true,
    isFeatured: true,
    createdAt: true,
    Board: { select: { name: true, slug: true } },
    User: {
      select: {
        id: true,
        uid: true,
        nickname: true,
        usernameModerationStatus: true,
        nicknameModerationStatus: true,
        nicknameViolationDisplay: true,
        level: true,
        Profile: { select: { displayName: true, displayNameModerationStatus: true } },
      },
    },
  }

  const candidates = await prisma.post.findMany({
    where: baseWhere,
    orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: 18,
    select,
  })
  const selected = new Map<string, (typeof candidates)[number]>()
  candidates
    .filter((post) => post.isFeatured || post.isPinned)
    .slice(0, 4)
    .forEach((post) => selected.set(post.id, post))

  candidates.forEach((post) => {
    if (selected.size < 4 && (post.isFeatured || post.isPinned)) selected.set(post.id, post)
  })

  const rows = Array.from(selected.values()).slice(0, 4)

  return rows.map(({ summary, content, moderationStatus, Board, User, ...post }) => ({
    ...post,
    title: publicModerationText(post.title, moderationStatus),
    board: withForumBoardDisplayName(Board),
    author: { ...User, nickname: getPublicUserDisplayName(User), profile: User.Profile },
    content: publicModerationText(summarizePlainText(summary || content), moderationStatus),
  }))
}

async function getHomePostsUncached() {
  return safeDb('Post.findMany home.posts', queryHomePosts(), [], 8000)
}

type HomePostPublicProjection = Awaited<ReturnType<typeof queryHomePosts>>[number]

async function addHomePostPublicDetails(posts: readonly HomePostPublicProjection[]) {
  const equippedBadgeMap = await getEquippedBadgesForUsers(posts.map((post) => post.author.id))
  return posts.map((post) => ({
    ...post,
    author: {
      ...post.author,
      equippedBadge: equippedBadgeMap.get(post.author.id) || null,
      profile: post.author.profile ? {
        ...post.author.profile,
        displayName: getPublicUserDisplayName(post.author),
      } : post.author.profile,
    },
  }))
}

async function loadHomePostsForCache() {
  return addHomePostPublicDetails(await queryHomePosts())
}

const getCachedHomePosts = unstable_cache(
  loadHomePostsForCache,
  [HOME_FEATURED_POSTS_CACHE_KEY],
  {
    revalidate: HOME_FEATURED_POSTS_CACHE_TTL_SECONDS,
    tags: [HOME_FEATURED_POSTS_CACHE_TAG],
  },
)

async function getCachedHomePostsWithFallback() {
  try {
    return await getCachedHomePosts()
  } catch (error) {
    // A cache backend failure must not make the personalized homepage fail.
    // The fallback keeps the existing bounded/degraded DB read behavior.
    console.error('[home.posts.cache]', {
      fallback: true,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return addHomePostPublicDetails(await getHomePostsUncached())
  }
}

export async function getHomeDailyMessages() {
  const messages = await cachedHomeData('home.dailyMessages', getHomeDailyMessagesUncached)
  const equippedBadgeMap = await getEquippedBadgesForUsers(messages.map((message) => message.user.id))
  const withBadges = messages.map((message) => ({ ...message, user: { ...message.user, equippedBadge: equippedBadgeMap.get(message.user.id) || null } }))
  return withBadges
}

async function getHomeDailyMessagesUncached() {
  const today = startOfLocalDay()
  const rows = await safeDb(
    'DailyMessage.findMany home.dailyMessages',
    prisma.dailyMessage.findMany({
      where: {
        date: today,
        isDeleted: false,
        moderationStatus: { in: ['APPROVED', 'VIOLATION'] },
        User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      },
      orderBy: [{ isFeatured: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }],
      take: 4,
      select: {
        id: true,
        mood: true,
        moodType: true,
        moodEmoji: true,
        moodText: true,
        content: true,
        moderationStatus: true,
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            usernameModerationStatus: true,
            nicknameModerationStatus: true,
            nicknameViolationDisplay: true,
            level: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true } },
          },
        },
      },
    }),
    [],
    2500,
  )

  return rows.map(({ User, ...message }) => ({
    ...message,
    user: { ...User, nickname: getPublicUserDisplayName(User), profile: User.Profile },
    content: publicModerationText(excerpt(message.content, 120), message.moderationStatus),
  }))
}

export async function getHomeActivities() {
  const now = new Date()
  return cachedHomeData('home.activities', () => safeDb(
    'Activity.findMany home.activities',
    prisma.activity.findMany({
      where: {
        status: 'PUBLISHED',
        startsAt: { lte: now },
        OR: [{ endsAt: { gt: now } }, { endsAt: null }],
      },
      orderBy: [{ endsAt: 'asc' }, { isPinned: 'desc' }, { isFeatured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 4,
      select: {
        id: true,
        title: true,
        subtitle: true,
        description: true,
        type: true,
        status: true,
        coverUrl: true,
        bannerUrl: true,
        startsAt: true,
        endsAt: true,
        signupLimit: true,
        isFeatured: true,
        isPinned: true,
        sortOrder: true,
        _count: { select: { ActivityRegistration: { where: { status: { in: ['ACTIVE'] } } } } },
      },
    }),
    [],
    5000,
  ).then((activities) => activities.map(({ _count, ...activity }) => ({
    ...activity,
    coverUrl: publicImageVariantUrl(activity.coverUrl || activity.bannerUrl, 'card'),
    signupCount: _count.ActivityRegistration,
  }))))
}

export type HomeAnywhereDoorPost = Readonly<{
  id: string
  authorUsername: string
  title: string
  publishedAt: string
  href: string
}>

export function createHomeAnywhereDoorTitle(caption: string | null | undefined) {
  const plainCaption = htmlToPlainText(caption, { preserveLineBreaks: true })
  const firstLine = plainCaption.split('\n').map((line) => line.trim()).find(Boolean) || `@${ANYWHERE_DOOR_TARGET} 最新更新`
  return summarizePlainText(firstLine, 100) || `@${ANYWHERE_DOOR_TARGET} 最新更新`
}

export async function getHomeAnywhereDoorLatest(): Promise<HomeAnywhereDoorPost | null> {
  return cachedHomeData('home.anywhereDoor.latest', () => safeDb(
    'SocialPost.findFirst home.anywhereDoor.latest',
    prisma.socialPost.findFirst({
      where: { status: 'READY', authorUsername: ANYWHERE_DOOR_TARGET },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, authorUsername: true, caption: true, publishedAt: true },
    }),
    null,
    5000,
  ).then((post) => post ? {
    id: post.id,
    authorUsername: post.authorUsername,
    title: createHomeAnywhereDoorTitle(post.caption),
    publishedAt: post.publishedAt.toISOString(),
    href: `/anywhere-door/${post.id}`,
  } : null))
}

export async function getHomeConcerts() {
  return cachedHomeData('home.concerts', () => safeDb(
    'MusicConcert.findMany home.concerts',
    prisma.musicConcert.findMany({
      where: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
      orderBy: [{ concertDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 4,
      select: {
        id: true,
        title: true,
        concertDate: true,
        city: true,
        venue: true,
        stageType: true,
        posterUrl: true,
        MusicTour: { select: { name: true, posterUrl: true } },
      },
    }).then((concerts) => concerts.map((concert) => {
      const posterUrl = resolveConcertPoster({ posterUrl: concert.posterUrl, tourPosterUrl: concert.MusicTour.posterUrl }).resolvedPosterUrl
      return {
        id: concert.id,
        title: concert.title?.trim() || concert.city,
        concertDate: concert.concertDate.toISOString(),
        city: concert.city,
        venue: concert.venue,
        tourName: concert.MusicTour.name,
        posterUrl: publicImageVariantUrl(posterUrl, 'thumb-sm'),
        href: buildConcertSlugPath(concert.MusicTour.name, concert.city, concert.concertDate, concert.stageType),
      }
    })),
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

export async function getHomeAlbums(userId?: string) {
  const dateKey = getShanghaiDateKey(new Date())
  const albums = await cachedHomeData(`home.albums:${dateKey}`, () => safeDb(
    'MusicAlbum.findMany home.albums',
    prisma.musicAlbum.findMany({
      where: { status: 'PUBLISHED', coverUrl: { not: null } },
      select: { id: true, name: true, releaseYear: true, coverUrl: true },
    }).then((rows) => rows.sort((a, b) => dailyAlbumRank(a.id, dateKey) - dailyAlbumRank(b.id, dateKey)).slice(0, 6).map((album) => ({ ...album, coverUrl: publicImageVariantUrl(album.coverUrl, 'thumb-sm') }))),
    [],
    5000,
  ))
  const likeStates = await getEasMusicAlbumLikeStates(albums.map((album) => album.id), userId)
  return albums.map((album) => ({
    ...album,
    likedByMe: likeStates.get(album.id)?.liked || false,
    likeCount: likeStates.get(album.id)?.likeCount || 0,
  }))
}

function dailyAlbumRank(id: string, seed = getShanghaiDateKey(new Date())) {
  let hash = 2166136261
  for (const character of `${seed}:${id}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export async function getHomeDailyMusicRecommendation(userId?: string, anonymousId?: string) {
  const recommendation = await safeDb('UserDailyMusicRecommendation home.dailyMusic', getDailyMusicRecommendation(userId, anonymousId), null, 8000)
  if (recommendation) return recommendation
  return safeDb('MusicSong.findMany home.dailyMusic.fallback', getFallbackDailyMusicRecommendation(userId, anonymousId), null, 8000)
}

export async function getHomeTodayEvents() {
  const { month, day } = getTodayMonthDay()
  return cachedHomeData(`home.today:${month}-${day}`, () => getTodayEventRecords())
}

export async function getHomeEntertainmentRanking(userId?: string) {
  void userId
  return getGuessSongModeHighScores()
}

export async function getHomeSiteStats() {
  const dateKey = getShanghaiDateKey(new Date())
  const [memberCount, todayCheckIns, todayBirthdays] = await Promise.all([
    safeDb('User.count home.siteStats.members', prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }), 0, 5000),
    getTodayCheckInCount(dateKey),
    safeDb('User.count home.siteStats.birthdays', countTodayBirthdays(dateKey), 0, 5000),
  ])
  return { memberCount, todayCheckIns, todayBirthdays }
}

export async function getHomeUserStats(userId?: string) {
  if (!userId) return null
  const todayKey = getShanghaiDateKey(startOfLocalDay())
  const stats = await safeDb(
    'User.findUnique home.stats',
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        level: true,
        experience: true,
        points: true,
        consecutiveDays: true,
        CheckIn: { where: { checkinDateKey: todayKey }, take: 1, select: { id: true } },
        _count: { select: { CheckIn: true } },
      },
    }),
    null,
    5000,
  )
  if (!stats) return null
  const { CheckIn, _count, ...userStats } = stats
  return {
    ...userStats,
    checkIns: CheckIn,
    _count: { checkIns: _count.CheckIn },
  }
}

/**
 * Read only the already-issued prescription reward for today. The homepage
 * must never call the issuing service or infer this value from the user's
 * total registration-fee balance.
 */
export async function getHomeDailyPrescriptionReward(userId?: string) {
  if (!userId) return null
  const dateKey = getShanghaiDateKey(new Date())
  const draw = await safeDb(
    'EntertainmentDailyDraw.findUnique home.dailyPrescription',
    prisma.entertainmentDailyDraw.findUnique({
      where: { userId_dateKey: { userId, dateKey } },
      select: { points: true },
    }),
    null,
    5000,
  )
  return draw?.points && draw.points > 0 ? draw.points : null
}
