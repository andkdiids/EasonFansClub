import { NextResponse } from 'next/server'
import { getHomeDailyMessages, homeCacheHeaders } from '@/lib/home-data'

export async function GET() {
  const messages = await getHomeDailyMessages()
  return NextResponse.json({ messages }, { headers: homeCacheHeaders })
}
