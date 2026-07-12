import { NextResponse } from 'next/server'
import {
  getHomeActivities,
  getHomeDailyMessages,
  getHomePosts,
  getHomeTracks,
  homeCacheHeaders,
} from '@/lib/home-data'

export async function GET() {
  try {
    const [posts, messages, activities, tracks] = await Promise.all([
      getHomePosts(),
      getHomeDailyMessages(),
      getHomeActivities(),
      getHomeTracks(),
    ])

    return NextResponse.json({ posts, messages, activities, tracks }, { headers: homeCacheHeaders })
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
