import { NextResponse } from 'next/server'
import { generateBadgeShareCard } from '@/lib/badge-share-card'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'users-me-badge-share-card',
    ip: { limit: 10, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  }, '分享卡片生成过于频繁，请稍后再试')
  if (limited) return limited
  const { badgeId } = await context.params
  if (!badgeId || badgeId.length > 191) return NextResponse.json({ message: '勋章标识无效' }, { status: 400 })
  try {
    const image = await generateBadgeShareCard(guard.user.id, badgeId)
    if (!image) return NextResponse.json({ message: '只能分享自己已经获得的勋章' }, { status: 403 })
    return new Response(image, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="badge-${encodeURIComponent(badgeId)}.png"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[badge.share-card]', { userId: guard.user.id, badgeId, error })
    return NextResponse.json({ message: '分享卡片生成失败，请稍后再试' }, { status: 500 })
  }
}
