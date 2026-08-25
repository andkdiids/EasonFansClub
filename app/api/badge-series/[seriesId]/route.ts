import { NextResponse } from 'next/server'
import { getBadgeCollection } from '@/lib/badge-service'
import { getCurrentUser } from '@/lib/auth'
import { parseUidParam } from '@/lib/uid'
import { prisma } from '@/lib/prisma'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ seriesId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { seriesId } = await context.params
  if (!seriesId || seriesId.length > 191) return NextResponse.json({ message: '系列不存在' }, { status: 404 })
  const viewer = await getCurrentUser()
  const requestedUid = new URL(request.url).searchParams.get('user')
  let targetId = viewer?.id || null
  if (requestedUid) {
    const uid = parseUidParam(requestedUid)
    if (uid === null || uid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
    const target = await prisma.user.findFirst({ where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }, select: { id: true } })
    targetId = target?.id || null
  }
  if (!targetId) return unauthenticatedResponse('请先登录或指定有效用户')
  const [series, collection] = await Promise.all([
    prisma.badgeSeries.findUnique({ where: { id: seriesId }, select: { id: true, code: true, name: true, description: true, sortOrder: true, isEnabled: true, completionRewardBadgeId: true } }),
    getBadgeCollection(targetId, viewer?.id),
  ])
  if (!series || !collection) return NextResponse.json({ message: '系列不存在' }, { status: 404 })
  const items = collection.items.filter((badge) => badge.series?.id === series.id)
  const reward = items.find((badge) => badge.id === series.completionRewardBadgeId) || null
  const visibleItems = items.filter((badge) => badge.status !== 'HIDDEN' || collection.isSelf)
  const collected = visibleItems.filter((badge) => badge.status === 'OBTAINED').length
  const total = visibleItems.length
  return NextResponse.json({ series, collected, total, percentage: total ? Math.floor((collected / total) * 100) : 0, completed: total > 0 && collected === total, reward, items: visibleItems }, { headers: { 'Cache-Control': 'private, no-store' } })
}
