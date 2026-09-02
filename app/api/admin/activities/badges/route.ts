import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'
import { toPublicMediaUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const badges = await prisma.badge.findMany({
    where: { isEnabled: true, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, iconUrl: true },
    take: 500,
  })
  return NextResponse.json({ badges: badges.map((badge) => ({ ...badge, iconUrl: toPublicMediaUrl(badge.iconUrl) })) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
