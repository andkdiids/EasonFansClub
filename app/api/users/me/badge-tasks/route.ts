import { NextResponse } from 'next/server'
import { getBadgeTaskCenter } from '@/lib/badge-phase5'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const result = await getBadgeTaskCenter(guard.user.id)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
