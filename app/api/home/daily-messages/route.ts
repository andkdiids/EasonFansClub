import { NextResponse } from 'next/server'
import { startOfLocalDay } from '@/lib/checkin'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const today = startOfLocalDay()
  const messages = await safeDb(
    'home.dailyMessages',
    prisma.dailyMessage.findMany({
      where: {
        date: today,
        isDeleted: false,
        user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      },
      orderBy: [{ isFeatured: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }],
      take: 4,
      select: {
        id: true,
        mood: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            uid: true,
            nickname: true,
            level: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
    [],
  )

  return NextResponse.json({ messages })
}
