import { NextResponse } from 'next/server'
import { getHomePosts } from '@/lib/home-data'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  const user = await getCurrentUser()
  const posts = await getHomePosts(user?.id)
  return NextResponse.json({ posts }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
