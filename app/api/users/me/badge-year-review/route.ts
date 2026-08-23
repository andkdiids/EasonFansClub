import { NextResponse } from 'next/server'
import { getBadgeYearReview } from '@/lib/badge-phase5'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const year = Number(new URL(request.url).searchParams.get('year'))
  const result = await getBadgeYearReview(guard.user.id, year)
  if (!result) return NextResponse.json({ message: '请选择有效年份' }, { status: 400 })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
