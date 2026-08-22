import { NextResponse } from 'next/server'
import { toPublicMediaUrl } from '@/lib/media-url'
import { requireAdmin } from '@/lib/security'
import { badgeAdminSelect, listBadgesForAdmin, writeBadgeAdminAction } from '@/lib/badge-service'
import { getBadgeAvailability, getBadgeOwnershipStats } from '@/lib/badge-phase2'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { generateBadgeAcquisitionDescription } from '@/lib/badge-rules'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function serializeBadge(badge: Record<string, unknown>, stats?: { ownerCount: number; totalUsers: number; rate: number; display: string }) {
  const count = badge._count && typeof badge._count === 'object' ? (badge._count as { UserBadge?: number }).UserBadge || 0 : 0
  const { BadgeRule, ...rest } = badge
  return {
    ...rest,
    rule: BadgeRule || null,
    iconUrl: toPublicMediaUrl(typeof badge.iconUrl === 'string' ? badge.iconUrl : null),
    ownerCount: stats?.ownerCount ?? count,
    ownershipStats: stats || null,
    availabilityStatus: getBadgeAvailability({ availableFrom: badge.availableFrom instanceof Date ? badge.availableFrom : badge.availableFrom ? new Date(String(badge.availableFrom)) : null, availableUntil: badge.availableUntil instanceof Date ? badge.availableUntil : badge.availableUntil ? new Date(String(badge.availableUntil)) : null }),
  }
}

export async function GET(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { searchParams } = new URL(request.url)
  const enabledParam = searchParams.get('enabled')
  const badges = await listBadgesForAdmin({
    query: searchParams.get('q') || undefined,
    enabled: enabledParam === 'true' ? true : enabledParam === 'false' ? false : undefined,
    visibility: searchParams.get('visibility') || undefined,
    grantType: searchParams.get('grantType') || undefined,
    rarity: searchParams.get('rarity') || undefined,
    seriesId: searchParams.get('seriesId') || undefined,
    tierGroupCode: searchParams.get('tierGroupCode') || undefined,
    availability: searchParams.get('availability') || undefined,
    order: ['sortOrder', 'ownerCount', 'rate', 'createdAt'].includes(searchParams.get('order') || '') ? searchParams.get('order') as 'sortOrder' | 'ownerCount' | 'rate' | 'createdAt' : undefined,
  })
  const stats = await getBadgeOwnershipStats(badges.map((badge) => badge.id))
  return NextResponse.json({ badges: badges.map((badge) => serializeBadge(badge as unknown as Record<string, unknown>, stats.get(badge.id))) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const parsed = parseBadgeDefinition(body as Record<string, unknown>)
  if (parsed.error || !parsed.data) return NextResponse.json({ message: parsed.error || '勋章参数无效' }, { status: 400 })
  const data = { ...parsed.data } as Prisma.BadgeUncheckedCreateInput
  if (parsed.rule) {
    const generatedDescription = generateBadgeAcquisitionDescription(parsed.rule.ruleType, parsed.rule.threshold)
    const requestedDescription = typeof body.acquisitionDescription === 'string' ? body.acquisitionDescription.trim() : ''
    const customized = body.acquisitionDescriptionCustomized === false
      ? false
      : Boolean(requestedDescription) && (
        body.acquisitionDescriptionCustomized === true || requestedDescription !== generatedDescription
      )
    data.acquisitionDescription = customized ? requestedDescription : generatedDescription
    data.acquisitionDescriptionCustomized = customized
  } else {
    data.acquisitionDescriptionCustomized = false
  }
  if (data.musicTourId) {
    const tour = await prisma.musicTour.findUnique({ where: { id: data.musicTourId }, select: { id: true } })
    if (!tour) return NextResponse.json({ message: '关联的巡演不存在' }, { status: 400 })
  }
  if (data.seriesId) {
    const series = await prisma.badgeSeries.findUnique({ where: { id: data.seriesId }, select: { id: true } })
    if (!series) return NextResponse.json({ message: '关联的勋章系列不存在' }, { status: 400 })
  }

  try {
    const badge = await prisma.$transaction(async (tx) => {
      const created = await tx.badge.create({ data, select: { id: true, name: true, code: true } })
      if (parsed.rule) {
        await tx.badgeRule.create({
          data: {
            badgeId: created.id,
            ruleType: parsed.rule.ruleType,
            operator: parsed.rule.operator,
            threshold: parsed.rule.threshold,
            secondaryThreshold: parsed.rule.secondaryThreshold,
            isEnabled: parsed.rule.isEnabled,
          },
        })
      }
      const badgeWithRule = await tx.badge.findUniqueOrThrow({ where: { id: created.id }, select: badgeAdminSelect })
      await writeBadgeAdminAction(tx, {
        actorId: guard.user.id,
        action: 'BADGE_CREATE',
        badgeId: created.id,
        detail: {
          badgeName: created.name,
          code: created.code,
          ...(parsed.rule ? {
            autoRule: {
              ruleType: parsed.rule.ruleType,
              operator: parsed.rule.operator,
              threshold: parsed.rule.threshold,
              isEnabled: parsed.rule.isEnabled,
            },
          } : {}),
        },
      })
      if (parsed.rule) await writeBadgeAdminAction(tx, {
        actorId: guard.user.id,
        action: 'BADGE_AUTO_RULE_CREATE',
        badgeId: created.id,
        detail: { ruleType: parsed.rule.ruleType, operator: parsed.rule.operator, threshold: parsed.rule.threshold },
      })
      return badgeWithRule
    })
    return NextResponse.json({ badge: serializeBadge(badge as unknown as Record<string, unknown>) }, { status: 201 })
  } catch (error) {
    const duplicated = error instanceof Error && /P2002|Unique constraint/i.test(error.message)
    return NextResponse.json({ message: duplicated ? '创建失败：名称、code 或标识已经存在' : '创建失败，请稍后重试' }, { status: duplicated ? 409 : 500 })
  }
}
