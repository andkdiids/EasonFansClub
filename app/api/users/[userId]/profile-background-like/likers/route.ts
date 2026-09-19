import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { listProfileBackgroundLikers, PROFILE_BACKGROUND_LIKER_PAGE_SIZE } from '@/lib/profile-background-likes'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { userId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(userId)) {
    return NextResponse.json({ ok: false, message: '用户不存在或不可用' }, { status: 404 })
  }
  const owner = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true },
  })
  if (!owner) return NextResponse.json({ ok: false, message: '用户不存在或不可用' }, { status: 404 })

  const viewer = await getCurrentUser()
  const requestedPage = Number(new URL(request.url).searchParams.get('page'))
  const result = await listProfileBackgroundLikers({
    profileOwnerId: owner.id,
    viewerId: viewer?.id,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: PROFILE_BACKGROUND_LIKER_PAGE_SIZE,
  })
  return NextResponse.json({ ok: true, ...result }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
