import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const messages = await safeDb(
    'profile.messages',
    prisma.dailyMessage.findMany({
      where: { userId: user.id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, mood: true, content: true, createdAt: true },
    }),
    [],
  )

  return NextResponse.json({ messages })
}
