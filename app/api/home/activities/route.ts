import { NextResponse } from 'next/server'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const activities = await safeDb(
    'home.activities',
    prisma.activity.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, title: true, description: true, coverUrl: true, startsAt: true },
    }),
    [],
  )

  return NextResponse.json({ activities })
}
