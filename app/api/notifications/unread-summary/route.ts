import { NextResponse } from 'next/server'
import { getUnreadSummary } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  return NextResponse.json(await getUnreadSummary(guard.user.id), {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
  })
}
