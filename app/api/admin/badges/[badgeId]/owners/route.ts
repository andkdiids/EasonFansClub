import { NextResponse } from 'next/server'
import { listBadgeOwners } from '@/lib/badge-service'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  const owners = await listBadgeOwners(badgeId)
  return NextResponse.json({ owners: owners.map((owner) => ({
    ...owner,
    awardedAt: owner.awardedAt.toISOString(),
    obtainedAt: owner.obtainedAt.toISOString(),
    expiresAt: owner.expiresAt?.toISOString() || null,
    expiredAt: owner.expiredAt?.toISOString() || null,
    revokedAt: owner.revokedAt?.toISOString() || null,
    user: {
      ...owner.User,
      displayName: getPublicUserDisplayName(owner.User),
    },
  })) }, { headers: { 'Cache-Control': 'no-store' } })
}
