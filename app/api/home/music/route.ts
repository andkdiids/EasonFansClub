import { NextResponse } from 'next/server'
import { getHomeTracks, homeCacheHeaders } from '@/lib/home-data'

export async function GET() {
  const tracks = await getHomeTracks()
  return NextResponse.json({ tracks }, { headers: homeCacheHeaders })
}
