import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getHomeEntertainmentRanking } from '@/lib/home-data'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  const entertainmentRanking = await getHomeEntertainmentRanking(user?.id)
  return NextResponse.json(
    { entertainmentRanking },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } },
  )
}
