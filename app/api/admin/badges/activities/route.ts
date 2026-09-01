import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

/** Activity targets for the badge rule selector; reward configuration is not exposed here. */
export async function GET() {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const activities = await prisma.activity.findMany({
    where: { status: { in: ['DRAFT', 'PUBLISHED', 'CANCELLED'] } },
    orderBy: [{ status: 'asc' }, { startsAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: 500,
    select: { id: true, title: true, status: true, startsAt: true, endsAt: true },
  })
  return NextResponse.json({ activities: activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
    status: activity.status,
    startsAt: activity.startsAt?.toISOString() || null,
    endsAt: activity.endsAt?.toISOString() || null,
  })) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
