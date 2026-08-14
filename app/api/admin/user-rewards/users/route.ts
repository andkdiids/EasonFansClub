import { NextResponse } from 'next/server'
import { searchUserRewardUsers, USER_REWARD_PERMISSION } from '@/lib/user-rewards'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin(USER_REWARD_PERMISSION)
  if (!guard.user) return guard.response

  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 80)
  if (!query) return NextResponse.json({ users: [] })

  const users = await searchUserRewardUsers(query)
  return NextResponse.json({ users }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
