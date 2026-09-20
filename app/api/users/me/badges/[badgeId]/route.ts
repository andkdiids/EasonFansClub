import { NextResponse } from 'next/server'
import { getBadgeDetailForUser } from '@/lib/badge-service'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

/** Current-user-only detail refresh; progress is calculated server-side. */
export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const viewer = guard.user

  const { badgeId } = await context.params
  const badge = await getBadgeDetailForUser(viewer.id, badgeId)
  if (!badge) return NextResponse.json({ message: '勋章不存在或暂不可查看' }, { status: 404 })

  return NextResponse.json({ badge }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
