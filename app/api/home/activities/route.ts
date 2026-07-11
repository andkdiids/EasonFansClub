import { NextResponse } from 'next/server'
import { getHomeActivities, homeCacheHeaders } from '@/lib/home-data'

export async function GET() {
  const activities = await getHomeActivities()
  return NextResponse.json({ activities }, { headers: homeCacheHeaders })
}
