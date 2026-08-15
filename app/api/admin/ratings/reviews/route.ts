import { NextResponse } from 'next/server'
import { getAdminRatingOverview } from '@/lib/rating-service'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('rating_manage')
  if (!guard.user) return guard.response
  return NextResponse.json(await getAdminRatingOverview(), { headers: { 'Cache-Control': 'private, no-store' } })
}
