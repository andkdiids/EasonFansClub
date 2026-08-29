import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

/** Only activity-rule materials are selectable from the activity editor. */
export async function GET(request: Request) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const activityId = sanitizeText(params.get('activityId'), 191)
  const query = sanitizeText(params.get('q'), 100)
  const materials = await prisma.materialRedemption.findMany({
    where: {
      redemptionRule: 'ACTIVITY_REGISTRATION_REQUIRED',
      status: { not: 'ARCHIVED' },
      ...(query ? { title: { contains: query } } : {}),
      OR: [{ linkedActivityId: null }, ...(activityId ? [{ linkedActivityId: activityId }] : [])],
    },
    orderBy: [{ title: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    select: { id: true, title: true, stockRemaining: true, stockTotal: true, status: true, linkedActivityId: true },
  })
  return NextResponse.json({ materials: materials.map((material) => ({ ...material, isCurrent: Boolean(activityId && material.linkedActivityId === activityId) })) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
