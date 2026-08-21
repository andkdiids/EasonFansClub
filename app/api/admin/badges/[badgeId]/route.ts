import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { deleteFromCos } from '@/lib/tencent-cos'
import { PUBLIC_COS_HOST, toPublicMediaUrl, toStoredMediaUrl } from '@/lib/media-url'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { BadgeServiceError, badgeAdminSelect, deleteBadgeSafely, writeBadgeAdminAction } from '@/lib/badge-service'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { requireAdmin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

function serializeBadge(badge: Record<string, unknown>) {
  const count = badge._count && typeof badge._count === 'object' ? (badge._count as { UserBadge?: number }).UserBadge || 0 : 0
  return { ...badge, iconUrl: toPublicMediaUrl(typeof badge.iconUrl === 'string' ? badge.iconUrl : null), ownerCount: count }
}

function badgeStorageKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(toStoredMediaUrl(value) || value)
    if (parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST.toLowerCase()) return null
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    return key.startsWith('badges/') ? key : null
  } catch {
    return null
  }
}

async function cleanupBadgeImage(value: unknown) {
  const key = badgeStorageKey(value)
  if (!key) return
  try {
    await deleteFromCos(key)
  } catch (error) {
    // Image cleanup is intentionally best-effort: a successful DB update must
    // not be reported as failed just because an old immutable object is gone.
    console.warn('[badge-image.cleanup]', { key, error: error instanceof Error ? error.message : String(error) })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const parsed = parseBadgeDefinition(body as Record<string, unknown>, true)
  if (parsed.error || !parsed.data || !Object.keys(parsed.data).length) return NextResponse.json({ message: parsed.error || '没有可更新的字段' }, { status: 400 })
  const data = parsed.data as Prisma.BadgeUncheckedUpdateInput
  if (data.musicTourId && typeof data.musicTourId === 'string') {
    const tour = await prisma.musicTour.findUnique({ where: { id: data.musicTourId }, select: { id: true } })
    if (!tour) return NextResponse.json({ message: '关联的巡演不存在' }, { status: 400 })
  }

  try {
    const previous = await prisma.badge.findUnique({ where: { id: badgeId }, select: { iconUrl: true } })
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.badge.update({ where: { id: badgeId }, data, select: badgeAdminSelect })
      const affectedUsers = await tx.user.findMany({ where: { equippedBadgeId: badgeId }, select: { id: true, uid: true } })
      const shouldClearEquipped = data.isEnabled === false || data.isActive === false || data.isWearable === false
      if (shouldClearEquipped) await tx.user.updateMany({ where: { equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })
      const action = data.isEnabled === false || data.isActive === false
        ? 'BADGE_DISABLE'
        : data.isEnabled === true || data.isActive === true
          ? 'BADGE_ENABLE'
          : 'BADGE_UPDATE'
      await writeBadgeAdminAction(tx, {
        actorId: guard.user.id,
        action,
        badgeId,
        detail: { changedFields: Object.keys(data) },
      })
      return { updated, affectedUsers }
    })
    const badge = result.updated
    if ('iconUrl' in data && previous?.iconUrl && previous.iconUrl !== data.iconUrl) void cleanupBadgeImage(previous.iconUrl)
    revalidatePath('/profile')
    revalidatePath('/admin/badges')
    for (const affectedUser of result.affectedUsers) {
      invalidateCurrentUserCache(affectedUser.id)
      revalidatePath(`/user/${formatUid(affectedUser.uid)}`)
      revalidatePath(`/user/${formatUid(affectedUser.uid)}/badges`)
    }
    return NextResponse.json({ badge: serializeBadge(badge as unknown as Record<string, unknown>) })
  } catch (error) {
    const duplicated = error instanceof Error && /P2002|Unique constraint/i.test(error.message)
    return NextResponse.json({ message: duplicated ? '更新失败：名称、code 或标识已经存在' : '更新失败，勋章可能不存在' }, { status: duplicated ? 409 : 404 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params

  try {
    const existing = await prisma.badge.findUnique({ where: { id: badgeId }, select: { iconUrl: true } })
    await deleteBadgeSafely(badgeId, guard.user.id)
    if (existing?.iconUrl) void cleanupBadgeImage(existing.iconUrl)
    revalidatePath('/admin/badges')
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof BadgeServiceError && error.code === 'HAS_OWNERS') return NextResponse.json({ message: error.message, code: error.code }, { status: 409 })
    return NextResponse.json({ message: error instanceof Error ? error.message : '删除失败' }, { status: 404 })
  }
}
