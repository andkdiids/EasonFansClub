import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getUserBadgeShowcase } from '@/lib/badge-service'
import { parseUidParam } from '@/lib/uid'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { userId } = await context.params
  const uid = parseUidParam(userId)
  if (uid === null || uid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const target = await prisma.user.findFirst({ where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }, select: { id: true } })
  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const viewer = await getCurrentUser()
  return NextResponse.json({ showcase: await getUserBadgeShowcase(target.id, viewer?.id) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
