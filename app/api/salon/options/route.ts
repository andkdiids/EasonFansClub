import { NextResponse } from 'next/server'
import { getSalonOptions } from '@/lib/salon'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getSalonOptions(), {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  })
}
