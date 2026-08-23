import { getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { publicContentImageMarkers } from '@/lib/content-images'
import { getDailyMusicRecommendation, getFallbackDailyMusicRecommendation } from '@/lib/daily-music'
import { safeDb } from '@/lib/db-timeout'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getGuessSongModeHighScores } from '@/lib/guess-song-leaderboard'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { prisma } from '@/lib/prisma'
import { getTodayMonthDay } from '@/lib/today'
import { countTodayBirthdays, grantTodayBirthdayRewards } from '@/lib/birthday'
import { getTodayEventRecords } from '@/lib/today-events'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { getEasMusicAlbumLikeStates } from '@/lib/easmusic-likes'

export const homeCacheHeaders = {
  'Cache-Control': 'public, max-age=20, s-maxage=60, stale-while-revalidate=120',
}

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
  const posts = await getHomePostsUncached()
  const remarkMap = await loadFriendRemarkMap(userId, posts.map((post) => post.author.id))
  const equippedBadgeMap = await getEquippedBadgesForUsers(posts.map((post) => post.author.id))
  const displayPosts = posts.map((post) => ({
    ...post,
    author: {
      ...post.author,
      equippedBadge: equippedBadgeMap.get(post.author.id) || null,
      profile: post.author.profile ? {
        ...post.author.profile,
        displayName: resolveFriendDisplayName({
          viewerId: userId,
          targetUserId: post.author.id,
          fallbackName: getPublicUserDisplayName(post.author),
          remarkMap,
        }),
      } : post.author.profile,
    },
  }))
  if (!userId || posts.length === 0) return displayPosts.map((post) => ({ ...post, likedByMe: false }))
  const liked = await prisma.like.findMany({
    where: { userId, postId: { in: posts.map((post) => post.id) } },
    select: { postId: true },
  })
  const likedIds = new Set(liked.map((item) => item.postId))
  return displayPosts.map((post) => ({ ...post, likedByMe: likedIds.has(post.id) }))
}

async function getHomePostsUncached() {
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

  const rows = await safeDb(
    'Post.findMany home.posts',
    prisma.post.findMany({
      where: baseWhere,
      orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
      take: 18,
      select,
    }).then((candidates) => {
      const selected = new Map<string, (typeof candidates)[number]>()
      candidates
        .filter((post) => post.isFeatured || post.isPinned)
        .slice(0, 4)
        .forEach((post) => selected.set(post.id, post))

      candidates.forEach((post) => {
        if (selected.size < 4 && (post.isFeatured || post.isPinned)) selected.set(post.id, post)
      })

      return Array.from(selected.values()).slice(0, 4)
    }),
    [],
    8000,
  )

  return rows.map(({ summary, content, moderationStatus, Board, User, ...post }) => ({
    ...post,
    title: publicModerationText(post.title, moderationStatus),
    board: Board,
    author: { ...User, nickname: getPublicUserDisplayName(User), profile: User.Profile },
    content: publicModerationText(publicContentImageMarkers(excerpt(summary || content)), moderationStatus),
  }))
}

export async function getHomeDailyMessages(userId?: string) {
  const messages = await cachedHomeData('home.dailyMessages', getHomeDailyMessagesUncached)
  const remarkMap = await loadFriendRemarkMap(userId, messages.map((message) => message.user.id))
  const equippedBadgeMap = await getEquippedBadgesForUsers(messages.map((message) => message.user.id))
  const withBadges = messages.map((message) => ({ ...message, user: { ...message.user, equippedBadge: equippedBadgeMap.get(message.user.id) || null } }))
  if (!userId || messages.length === 0) return withBadges
  return withBadges.map((message) => ({
    ...message,
    user: message.user.profile ? {
      ...message.user,
      profile: {
        ...message.user.profile,
        displayName: resolveFriendDisplayName({
          viewerId: userId,
          targetUserId: message.user.id,
          fallbackName: getPublicUserDisplayName(message.user),
          remarkMap,
        }),
      },
    } : message.user,
  }))
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
  return cachedHomeData('home.activities', () => safeDb(
    'Activity.findMany home.activities',
    prisma.activity.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, title: true, description: true, coverUrl: true, startsAt: true, endsAt: true },
    }),
    [],
    5000,
  ).then((activities) => activities.map((activity) => ({ ...activity, coverUrl: publicImageVariantUrl(activity.coverUrl, 'card') }))))
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
  return getGuessSongModeHighScores(userId)
}

// 生日奖励（徽章 + 通知）每日最多触发一次，由首页加载自然带起，无需 cron。
// 失败不影响首页渲染；登录链路已按用户单独兜底，这里只负责把当天未登录的生日用户也覆盖到。
let lastBirthdaySweepDateKey: string | null = null
function triggerBirthdayRewardsSweep() {
  const dateKey = getShanghaiDateKey(new Date())
  if (dateKey === lastBirthdaySweepDateKey) return
  lastBirthdaySweepDateKey = dateKey
  void grantTodayBirthdayRewards().catch(() => {})
}

export async function getHomeSiteStats() {
  const dateKey = getShanghaiDateKey(new Date())
  triggerBirthdayRewardsSweep()
  const [memberCount, todayCheckIns, todayBirthdays] = await Promise.all([
    safeDb('User.count home.siteStats.members', prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }), 0, 5000),
    safeDb('CheckIn.count home.siteStats.today', prisma.checkIn.count({ where: { checkinDateKey: dateKey } }), 0, 5000),
    safeDb('TodayEvent.count home.siteStats.birthdays', countTodayBirthdays(), 0, 5000),
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
