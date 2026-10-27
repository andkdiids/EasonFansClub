import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { activityRegistrationSelect, serializeActivityRegistration } from '@/lib/activity-registration'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1))
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const skip = (page - 1) * pageSize
  const where: Prisma.ActivityRegistrationWhereInput = {
    userId: guard.user.id,
    status: { in: ['ACTIVE', 'CANCELLED'] },
  }

  const [rows, total] = await Promise.all([
    prisma.activityRegistration.findMany({
      where,
      orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pageSize,
      select: {
        ...activityRegistrationSelect,
        Activity: { select: activitySelect },
      },
    }),
    prisma.activityRegistration.count({ where }),
  ])

  const registrations = rows.map((row) => ({
    activity: serializeActivityRow(row.Activity),
    registration: serializeActivityRegistration(row),
  }))
  return NextResponse.json({ registrations, page, pageSize, total, hasMore: skip + rows.length < total }, { headers: privateHeaders })
}
