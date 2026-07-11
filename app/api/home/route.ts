import { NextResponse } from 'next/server'
import {
  getHomeActivities,
  getHomeDailyMessages,
  getHomePosts,
  getHomeTracks,
  homeCacheHeaders,
} from '@/lib/home-data'

export async function GET() {
  const [posts, messages, activities, tracks] = await Promise.all([
    getHomePosts(),
    getHomeDailyMessages(),
    getHomeActivities(),
    getHomeTracks(),
  ])

  return NextResponse.json({ posts, messages, activities, tracks }, { headers: homeCacheHeaders })
}
