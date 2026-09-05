import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { equipBadge, BadgeServiceError, reorderEquippedBadges, unequipBadge } from '@/lib/badge-service'
import { formatUid } from '@/lib/uid'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

function errorResponse(error: unknown) {
  if (error instanceof BadgeServiceError) {
    const status = error.code === 'NOT_OWNED' || error.code === 'BADGE_DISABLED' || error.code === 'BADGE_NOT_WEARABLE' || error.code === 'INVALID_EQUIPPED_ORDER' ? 400 : 404
    return NextResponse.json({ message: error.message, code: error.code }, { status })
  }
  return NextResponse.json({ message: '勋章状态更新失败，请稍后再试' }, { status: 500 })
}

async function revalidateBadgeViews(userId: string, uid: number) {
  invalidateCurrentUserCache(userId)
  revalidatePath('/profile')
  revalidatePath(`/user/${formatUid(uid)}`)
  revalidatePath(`/user/${formatUid(uid)}/badges`)
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'users-me-badge-equip',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '勋章佩戴操作过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null) as { badgeId?: unknown } | null
  const badgeId = typeof body?.badgeId === 'string' ? body.badgeId.trim() : ''
  if (!badgeId || badgeId.length > 191) return NextResponse.json({ message: '请选择有效勋章' }, { status: 400 })

  try {
    const result = await equipBadge(guard.user.id, badgeId)
    await revalidateBadgeViews(guard.user.id, guard.user.uid)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'users-me-badge-unequip',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '勋章佩戴操作过于频繁，请稍后再试')
  if (limited) return limited

  try {
    const body = await request.json().catch(() => null) as { badgeId?: unknown } | null
    const badgeId = typeof body?.badgeId === 'string' ? body.badgeId.trim() : null
    if (badgeId !== null && (!badgeId || badgeId.length > 191)) return NextResponse.json({ message: '请选择有效勋章' }, { status: 400 })
    const result = await unequipBadge(guard.user.id, badgeId)
    await revalidateBadgeViews(guard.user.id, guard.user.uid)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'users-me-badge-reorder',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '勋章排序操作过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null) as { badgeIds?: unknown } | null
  if (!Array.isArray(body?.badgeIds) || body.badgeIds.some((badgeId) => typeof badgeId !== 'string')) {
    return NextResponse.json({ message: '请提交完整的勋章顺序' }, { status: 400 })
  }

  try {
    const result = await reorderEquippedBadges(guard.user.id, body.badgeIds as string[])
    await revalidateBadgeViews(guard.user.id, guard.user.uid)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
