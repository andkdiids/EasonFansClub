import { NextResponse } from 'next/server'
import { getPersonalLiveOverview, PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  return NextResponse.json(await getPersonalLiveOverview(guard.user.id), { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}
