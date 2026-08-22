import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getBadgeCollection, getBadgeProfileSummary } from '@/lib/badge-service'
import { parseUidParam } from '@/lib/uid'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { userId } = await context.params
  const uid = parseUidParam(userId)
  if (uid === null || uid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const target = await prisma.user.findFirst({
    where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true },
  })
  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const viewer = await getCurrentUser()
  const collection = new URL(request.url).searchParams.get('preview') === '1'
    ? await getBadgeProfileSummary(target.id, viewer?.id)
    : await getBadgeCollection(target.id, viewer?.id)
  if (!collection) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  return NextResponse.json(collection, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
