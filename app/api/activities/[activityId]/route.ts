import { NextResponse } from 'next/server'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } },
    select: activitySelect,
  })
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })

  return NextResponse.json({ activity: serializeActivityRow(activity) })
}
