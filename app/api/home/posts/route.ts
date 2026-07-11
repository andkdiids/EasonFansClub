import { NextResponse } from 'next/server'
import { getHomePosts, homeCacheHeaders } from '@/lib/home-data'

export async function GET() {
  const posts = await getHomePosts()
  return NextResponse.json({ posts }, { headers: homeCacheHeaders })
}
