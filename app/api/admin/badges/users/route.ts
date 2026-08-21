import { NextResponse } from 'next/server'
import { findUsersForBadgeGrant } from '@/lib/badge-service'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const query = new URL(request.url).searchParams.get('q') || ''
  const users = await findUsersForBadgeGrant(query)
  return NextResponse.json({ users: users.map((user) => ({
    id: user.id,
    uid: user.uid,
    displayName: user.Profile?.displayName || user.nickname || user.username,
    username: user.username,
  })) }, { headers: { 'Cache-Control': 'no-store' } })
}
