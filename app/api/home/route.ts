import { NextResponse } from 'next/server'
import {
  getHomeActivities,
  getHomeDailyMessages,
  getHomePosts,
  getHomeTracks,
} from '@/lib/home-data'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    const [posts, messages, activities, tracks] = await Promise.all([
      getHomePosts(user?.id),
      getHomeDailyMessages(),
      getHomeActivities(),
      getHomeTracks(),
    ])

    return NextResponse.json({ posts, messages, activities, tracks }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
  } catch (error) {
    console.error('[api/home] prisma module loading failed', {
      queries: [
        { model: 'Post', query: 'findMany', feature: 'home.posts' },
        { model: 'DailyMessage', query: 'findMany', feature: 'home.dailyMessages' },
        { model: 'Activity', query: 'findMany', feature: 'home.activities' },
        { model: 'MusicTrack', query: 'findMany', feature: 'home.music' },
      ],
    }, error)
    throw error
  }
}
