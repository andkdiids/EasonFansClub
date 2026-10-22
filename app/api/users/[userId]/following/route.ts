import { NextResponse } from 'next/server'
import { getProfileConnectionPage } from '@/lib/profile-connections'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { userId } = await context.params
  const target = await prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }, select: { id: true } })
  if (!target) return NextResponse.json({ message: '用户不存在或不可用' }, { status: 404, headers: PRIVATE_HEADERS })
  const params = new URL(request.url).searchParams
  const page = Math.min(10_000, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1))
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  try {
    const result = await getProfileConnectionPage(target.id, 'following', page, pageSize)
    return NextResponse.json(result, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[profile.following]', { viewerId: guard.user.id, targetId: target.id, error })
    return NextResponse.json({ message: '关注列表暂时无法加载，请稍后重试' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}
