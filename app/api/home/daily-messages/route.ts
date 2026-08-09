import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getHomeDailyMessages, homeCacheHeaders } from '@/lib/home-data'

export async function GET() {
  const user = await getCurrentUser()
  const messages = await getHomeDailyMessages(user?.id)
  return NextResponse.json({ messages }, { headers: user ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : homeCacheHeaders })
}
