import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  getHomeActivities,
  getHomeAlbums,
  getHomeConcerts,
  getHomeDailyMusicRecommendation,
  getHomeEntertainmentRanking,
  getHomePosts,
  getHomeSiteStats,
  getHomeTodayEvents,
  getHomeUserStats,
} from '@/lib/home-data'
import { getCurrentUser } from '@/lib/auth'
import { DAILY_MUSIC_ANONYMOUS_COOKIE } from '@/lib/daily-music'
import { getGrowthSummary } from '@/lib/growth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const cookieStore = await cookies()
    const user = await getCurrentUser()
    const existingAnonymousId = cookieStore.get(DAILY_MUSIC_ANONYMOUS_COOKIE)?.value
    const anonymousId = user ? undefined : existingAnonymousId || randomUUID()
    const [posts, activities, concerts, albums, stats, dailyMusic, siteStats, todayEvents, entertainmentRanking] = await Promise.all([
      getHomePosts(user?.id),
      getHomeActivities(),
      getHomeConcerts(),
      getHomeAlbums(),
      getHomeUserStats(user?.id),
      getHomeDailyMusicRecommendation(user?.id, anonymousId),
      getHomeSiteStats(),
      getHomeTodayEvents(),
      getHomeEntertainmentRanking(user?.id),
    ])

    const growth = stats ? await getGrowthSummary(stats.experience) : null
    const response = NextResponse.json({ posts, messages: [], activities, concerts, tracks: [], albums, stats: stats && growth ? { ...stats, ...growth } : stats, dailyMusic, siteStats, todayEvents, entertainmentRanking }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
    if (!user && anonymousId && !existingAnonymousId) {
      response.cookies.set(DAILY_MUSIC_ANONYMOUS_COOKIE, anonymousId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return response
  } catch (error) {
    console.error('[api/home] prisma module loading failed', {
      queries: [
        { model: 'Post', query: 'findMany', feature: 'home.posts' },
        { model: 'Activity', query: 'findMany', feature: 'home.activities' },
        { model: 'MusicAlbum', query: 'findMany', feature: 'home.albums' },
        { model: 'User', query: 'findUnique', feature: 'home.stats' },
      ],
    }, error)
    throw error
  }
}
