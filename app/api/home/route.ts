import { NextResponse } from 'next/server'
import {
  getHomeActivities,
  getHomeAlbums,
  getHomePosts,
  getHomeUserStats,
} from '@/lib/home-data'
import { getCurrentUser } from '@/lib/auth'
import { getGrowthSummary } from '@/lib/growth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    const [posts, activities, albums, stats] = await Promise.all([
      getHomePosts(user?.id),
      getHomeActivities(),
      getHomeAlbums(),
      getHomeUserStats(user?.id),
    ])

    const growth = stats ? await getGrowthSummary(stats.experience) : null
    return NextResponse.json({ posts, messages: [], activities, tracks: [], albums, stats: stats && growth ? { ...stats, ...growth } : stats }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
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
