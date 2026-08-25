import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getBadgeDetailForUser } from '@/lib/badge-service'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

/** Current-user-only detail refresh; progress is calculated server-side. */
export async function GET(_request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  if (!viewer) return unauthenticatedResponse()

  const { badgeId } = await context.params
  const badge = await getBadgeDetailForUser(viewer.id, badgeId)
  if (!badge) return NextResponse.json({ message: '勋章不存在或暂不可查看' }, { status: 404 })

  return NextResponse.json({ badge }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
