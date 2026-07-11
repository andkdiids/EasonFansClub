import { NextResponse } from 'next/server'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const tracks = await safeDb(
    'home.music',
    prisma.musicTrack.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 4,
      select: { id: true, title: true, artist: true, isPlayable: true },
    }),
    [],
  )

  return NextResponse.json({ tracks })
}
