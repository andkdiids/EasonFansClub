import { NextResponse } from 'next/server'
import { activityDisplayStatusLabels, activityTypeValues, sortActivities, type ActivityDisplayStatus, type ActivityStatusValue, type ActivityTypeValue } from '@/lib/activity'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const publicDatabaseStatuses: ActivityStatusValue[] = ['PUBLISHED']

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const requestedStatus = params.get('status')?.trim().toUpperCase() || 'ALL'
  const requestedType = params.get('type')?.trim().toUpperCase() || 'ALL'
  const query = params.get('q')?.trim().toLowerCase() || ''
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '24', 10) || 24))

  const rows = await prisma.activity.findMany({
    where: { status: { in: publicDatabaseStatuses } },
    orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }, { startsAt: 'asc' }, { createdAt: 'desc' }],
    take: 300,
    select: activitySelect,
  })
  const now = new Date()
  let activities = rows.map((row) => serializeActivityRow(row, now))

  if (requestedStatus !== 'ALL' && requestedStatus in activityDisplayStatusLabels) {
    activities = activities.filter((activity) => activity.displayStatus === requestedStatus as ActivityDisplayStatus)
  }
  if (requestedType !== 'ALL' && activityTypeValues.includes(requestedType as ActivityTypeValue)) {
    activities = activities.filter((activity) => activity.type === requestedType)
  }
  if (query) {
    activities = activities.filter((activity) => `${activity.title}\n${activity.subtitle || ''}\n${activity.description}\n${activity.locationName || ''}\n${activity.organizer || ''}`.toLowerCase().includes(query))
  }

  const sorted = sortActivities(activities, now)
  const total = sorted.length
  const start = (page - 1) * pageSize
  return NextResponse.json({
    activities: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  })
}
