import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  getHomeActivities,
  getHomeAlbums,
  getHomeAnywhereDoorLatest,
  getHomeDailyMusicRecommendation,
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
    const [activities, albums, stats, dailyMusic, siteStats, todayEvents, anywhereDoor] = await Promise.all([
      getHomeActivities(),
      getHomeAlbums(user?.id),
      getHomeUserStats(user?.id),
      getHomeDailyMusicRecommendation(user?.id, anonymousId),
      getHomeSiteStats(),
      getHomeTodayEvents(),
      getHomeAnywhereDoorLatest(),
    ])

    const growth = stats ? await getGrowthSummary(stats.experience) : null
    const response = NextResponse.json({ messages: [], activities, albums, stats: stats && growth ? { ...stats, ...growth } : stats, dailyMusic, siteStats, todayEvents, anywhereDoor, entertainmentRanking: null }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
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
        { model: 'Activity', query: 'findMany', feature: 'home.activities' },
        { model: 'MusicAlbum', query: 'findMany', feature: 'home.albums' },
        { model: 'User', query: 'findUnique', feature: 'home.stats' },
        { model: 'SocialPost', query: 'findFirst', feature: 'home.anywhereDoor' },
      ],
    }, error)
    throw error
  }
}
