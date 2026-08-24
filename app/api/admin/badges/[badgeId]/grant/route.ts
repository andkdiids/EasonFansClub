import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { grantBadge } from '@/lib/badge-service'
import { getBadgeAvailability } from '@/lib/badge-phase2'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { BADGE_RULE_REGISTRY, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import { getBatchHistoricalBadgeMetrics, getHistoricalQualificationWindow } from '@/lib/badge-historical'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { formatUid } from '@/lib/uid'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

async function resolveTarget(body: Record<string, unknown>) {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const uidRaw = typeof body.uid === 'number' ? body.uid : Number.parseInt(String(body.uid || ''), 10)
  return prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      ...(userId ? { id: userId } : Number.isInteger(uidRaw) && uidRaw > 0 ? { uid: uidRaw } : { id: '__missing__' }),
    },
    select: { id: true, uid: true },
  })
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  const params = new URL(request.url).searchParams
  const target = await resolveTarget({ userId: params.get('userId') || '', uid: params.get('uid') || '' })
  if (!target) return NextResponse.json({ message: '目标用户不存在或已停用' }, { status: 404 })
  const badge = await prisma.badge.findUnique({
    where: { id: badgeId },
    select: {
      id: true,
      name: true,
      grantType: true,
      isEnabled: true,
      isActive: true,
      availableFrom: true,
      availableUntil: true,
      BadgeRule: { select: { ruleType: true, threshold: true, configJson: true, isEnabled: true } },
    },
  })
  if (!badge) return NextResponse.json({ message: '勋章不存在' }, { status: 404 })
  const owned = await prisma.userBadge.findUnique({ where: { userId_badgeId: { userId: target.id, badgeId } }, select: { id: true, obtainedAt: true } })
  const ruleType = badge.BadgeRule?.ruleType as SupportedBadgeRuleType | undefined
  const limited = Boolean(badge.availableFrom || badge.availableUntil)
  let currentMetric: number | null = null
  let historicalMetric: number | null = null
  if (ruleType && badge.BadgeRule?.isEnabled && ruleType !== 'BADGE_SERIES_COMPLETE') {
    try {
      if (ruleType === 'CONCERT_SHOW_ATTENDED' || ruleType === 'CONCERT_TOUR_ATTENDED') {
        const config = badge.BadgeRule.configJson && typeof badge.BadgeRule.configJson === 'object' && !Array.isArray(badge.BadgeRule.configJson) ? badge.BadgeRule.configJson as { concertId?: unknown; tourId?: unknown } : null
        const count = await prisma.userMusicConcert.count({
          where: {
            userId: target.id,
            ...(ruleType === 'CONCERT_SHOW_ATTENDED'
              ? { concertId: typeof config?.concertId === 'string' ? config.concertId : '__invalid__' }
              : { MusicConcert: { tourId: typeof config?.tourId === 'string' ? config.tourId : '__invalid__' } }),
          },
        })
        currentMetric = count > 0 ? 1 : 0
      } else currentMetric = await getUserBadgeMetric(target.id, ruleType)
    } catch {
      currentMetric = null
    }
  }
  if (limited && ruleType && badge.BadgeRule?.isEnabled && BADGE_RULE_REGISTRY[ruleType].supportsHistoricalBackfill) {
    try {
      const targetWithCreatedAt = await prisma.user.findUnique({ where: { id: target.id }, select: { id: true, createdAt: true } })
      if (targetWithCreatedAt) {
        const window = getHistoricalQualificationWindow({ availableFrom: badge.availableFrom, availableUntil: badge.availableUntil })
        historicalMetric = (await getBatchHistoricalBadgeMetrics([targetWithCreatedAt], ruleType, badge.BadgeRule.configJson, window)).get(target.id) ?? null
      }
    } catch {
      historicalMetric = null
    }
  }
  return NextResponse.json({
    user: target,
    badge: { id: badge.id, name: badge.name, grantType: badge.grantType, isEnabled: badge.isEnabled && badge.isActive, availability: getBadgeAvailability(badge), availableFrom: badge.availableFrom?.toISOString() || null, availableUntil: badge.availableUntil?.toISOString() || null },
    rule: badge.BadgeRule ? { ruleType: badge.BadgeRule.ruleType, threshold: badge.BadgeRule.threshold, isEnabled: badge.BadgeRule.isEnabled, historicalSupported: Boolean(ruleType && BADGE_RULE_REGISTRY[ruleType].supportsHistoricalBackfill), historicalBasis: ruleType ? BADGE_RULE_REGISTRY[ruleType].historicalBasis : null } : null,
    ownership: owned ? { owned: true, obtainedAt: owned.obtainedAt.toISOString() } : { owned: false, obtainedAt: null },
    currentMetric,
    historicalMetric,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求无效' }, { status: 400 })
  const target = await resolveTarget(body as Record<string, unknown>)
  if (!target) return NextResponse.json({ message: '目标用户不存在或已停用' }, { status: 404 })

  try {
    const badge = await prisma.badge.findUnique({ where: { id: badgeId }, select: { name: true, availableFrom: true, availableUntil: true } })
    if (!badge) return NextResponse.json({ message: '勋章不存在' }, { status: 404 })
    const limited = Boolean(badge.availableFrom || badge.availableUntil)
    const grantReason = sanitizeText(body.grantReason, 500) || null
    if (limited && !grantReason) return NextResponse.json({ message: '限定勋章手动补发必须填写补发原因' }, { status: 400 })
    const result = await grantBadge({
      userId: target.id,
      badgeId,
      actorId: guard.user.id,
      sourceType: limited ? 'ADMIN_BACKFILL' : sanitizeText(body.sourceType, 32) || 'MANUAL',
      sourceId: sanitizeText(body.sourceId, 191) || null,
      grantReason,
      ...(limited ? { availabilityMode: 'ADMIN_MANUAL' as const } : {}),
    })
    if (!result.created) return NextResponse.json({ ...result, message: '该用户已经拥有此勋章' }, { status: 409 })
    invalidateCurrentUserCache(target.id)
    revalidatePath(`/user/${formatUid(target.uid)}`)
    revalidatePath(`/user/${formatUid(target.uid)}/badges`)
    await prisma.$transaction(async (tx) => {
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user!.id,
          action: limited ? 'BADGE_MANUAL_BACKFILL' : 'BADGE_GRANT_REQUEST',
          targetUserId: target.id,
          detail: { badgeId, badgeName: badge.name, availability: getBadgeAvailability(badge), reason: grantReason, sourceType: limited ? 'ADMIN_BACKFILL' : sanitizeText(body.sourceType, 32) || 'MANUAL' },
        },
      })
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '发放失败' }, { status: 400 })
  }
}
