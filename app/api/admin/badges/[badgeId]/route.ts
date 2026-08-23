import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { deleteFromCos } from '@/lib/tencent-cos'
import { PUBLIC_COS_HOST, toPublicMediaUrl, toStoredMediaUrl } from '@/lib/media-url'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { generateBadgeAcquisitionDescription } from '@/lib/badge-rules'
import { BadgeServiceError, badgeAdminSelect, deleteBadgeSafely, writeBadgeAdminAction } from '@/lib/badge-service'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { requireAdmin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { Prisma } from '@prisma/client'
import { getBadgeAvailability, getBadgeOwnershipStats, validateBadgeAvailability } from '@/lib/badge-phase2'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

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
  if (parsed.error || !parsed.data || (!Object.keys(parsed.data).length && parsed.rule === undefined)) return NextResponse.json({ message: parsed.error || '没有可更新的字段' }, { status: 400 })
  const data = { ...parsed.data } as Prisma.BadgeUncheckedUpdateInput
  let targetGeneratedDescription: string | null = null
  if (data.musicTourId && typeof data.musicTourId === 'string') {
    const tour = await prisma.musicTour.findUnique({ where: { id: data.musicTourId }, select: { id: true } })
    if (!tour) return NextResponse.json({ message: '关联的巡演不存在' }, { status: 400 })
  }

  try {
    const previous = await prisma.badge.findUnique({
      where: { id: badgeId },
      select: {
        iconUrl: true,
        grantType: true,
        acquisitionDescription: true,
        acquisitionDescriptionCustomized: true,
        seriesId: true,
        tierGroupCode: true,
        tierLevel: true,
        availableFrom: true,
        availableUntil: true,
        BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, secondaryThreshold: true, configJson: true, isEnabled: true } },
      },
    })
    if (!previous) return NextResponse.json({ message: '更新失败，勋章不存在' }, { status: 404 })

    if (data.seriesId) {
      const series = await prisma.badgeSeries.findUnique({ where: { id: data.seriesId as string }, select: { id: true, code: true } })
      if (!series) return NextResponse.json({ message: '关联的勋章系列不存在' }, { status: 400 })
      if (body.tierEnabled === true) data.tierGroupCode = series.code
    } else if (body.tierEnabled === true && body.legacyTier === true && previous.tierGroupCode && previous.tierLevel) {
      data.tierGroupCode = previous.tierGroupCode
      data.tierLevel = previous.tierLevel
    } else if (body.tierEnabled === true) return NextResponse.json({ message: '分级勋章必须选择勋章系列' }, { status: 400 })
    if (body.tierEnabled === false) {
      data.tierGroupCode = null
      data.tierLevel = null
    }
    const effectiveTierGroupCode = data.tierGroupCode !== undefined ? data.tierGroupCode as string | null : previous.tierGroupCode
    const effectiveTierLevel = data.tierLevel !== undefined ? data.tierLevel as number | null : previous.tierLevel
    if ((effectiveTierGroupCode === null) !== (effectiveTierLevel === null)) return NextResponse.json({ message: 'Tier 系列编码与等级必须同时填写或同时留空' }, { status: 400 })
    const effectiveAvailableFrom = data.availableFrom !== undefined ? data.availableFrom as Date | null : previous.availableFrom
    const effectiveAvailableUntil = data.availableUntil !== undefined ? data.availableUntil as Date | null : previous.availableUntil
    const availabilityError = validateBadgeAvailability(effectiveAvailableFrom, effectiveAvailableUntil)
    if (availabilityError) return NextResponse.json({ message: availabilityError }, { status: 400 })

    const nextGrantType = typeof data.grantType === 'string' ? data.grantType : previous.grantType
    if (previous.BadgeRule?.ruleType === 'BADGE_SERIES_COMPLETE' && nextGrantType !== 'AUTO') {
      return NextResponse.json({ message: '请先在勋章系列设置中解除完成奖励，再修改这枚奖励勋章的发放类型' }, { status: 400 })
    }
    if (data.countsTowardSeriesCompletion === true) {
      const linkedSeries = await prisma.badgeSeries.findFirst({ where: { completionRewardBadgeId: badgeId }, select: { name: true } })
      if (linkedSeries) return NextResponse.json({ message: '系列完成奖励勋章不能计入自身系列完成度，请先解除系列奖励' }, { status: 400 })
    }
    if (data.isEnabled === false || data.isActive === false) {
      const linkedSeries = await prisma.badgeSeries.findFirst({ where: { completionRewardBadgeId: badgeId }, select: { name: true } })
      if (linkedSeries) return NextResponse.json({ message: '请先解除系列完成奖励，再停用这枚奖励勋章' }, { status: 400 })
    }
    if (parsed.rule && nextGrantType !== 'AUTO') return NextResponse.json({ message: '手动或事件勋章不能配置自动获取规则' }, { status: 400 })
    if (parsed.rule?.ruleType === 'CONCERT_SHOW_ATTENDED' || parsed.rule?.ruleType === 'CONCERT_TOUR_ATTENDED') {
      data.category = 'CONCERT'
      const config = parsed.rule.configJson as { concertId?: string; tourId?: string }
      const target = parsed.rule.ruleType === 'CONCERT_SHOW_ATTENDED'
        ? await prisma.musicConcert.findFirst({ where: { id: config.concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } }, select: { id: true, city: true, concertDate: true, MusicTour: { select: { name: true } } } })
        : await prisma.musicTour.findFirst({ where: { id: config.tourId, status: 'PUBLISHED' }, select: { id: true, name: true } })
      if (!target) return NextResponse.json({ message: parsed.rule.ruleType === 'CONCERT_SHOW_ATTENDED' ? '选择的演唱会不存在或未发布' : '选择的巡演不存在或未发布' }, { status: 400 })
      targetGeneratedDescription = parsed.rule.ruleType === 'CONCERT_SHOW_ATTENDED' && 'MusicTour' in target
        ? `观看「${target.MusicTour.name} · ${target.city} · ${target.concertDate.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}」后获得`
        : `观看「${'name' in target ? target.name : ''}」巡演任意一场后获得`
    }
    if (parsed.rule?.ruleType === 'BADGE_SERIES_COMPLETE') {
      const config = parsed.rule.configJson && typeof parsed.rule.configJson === 'object' && !Array.isArray(parsed.rule.configJson) ? parsed.rule.configJson as { seriesId?: unknown } : null
      const seriesId = typeof config?.seriesId === 'string' ? config.seriesId : ''
      const linkedSeries = seriesId ? await prisma.badgeSeries.findFirst({ where: { id: seriesId, completionRewardBadgeId: badgeId }, select: { id: true } }) : null
      if (!linkedSeries) return NextResponse.json({ message: '系列完成规则只能由已配置的勋章系列完成奖励管理' }, { status: 400 })
    }
    const currentRule = previous.BadgeRule
      ? {
          ruleType: previous.BadgeRule.ruleType,
          operator: previous.BadgeRule.operator,
          threshold: previous.BadgeRule.threshold,
          secondaryThreshold: previous.BadgeRule.secondaryThreshold,
          configJson: previous.BadgeRule.configJson,
          isEnabled: previous.BadgeRule.isEnabled,
        }
      : null
    const effectiveRule = nextGrantType === 'AUTO'
      ? parsed.rule !== undefined
        ? parsed.rule
        : currentRule
      : null
    const keepsLegacyAutoFlow = nextGrantType === 'AUTO'
      && previous.grantType === 'AUTO'
      && !previous.BadgeRule
      && (parsed.rule === undefined || parsed.rule === null)
    if (nextGrantType === 'AUTO' && !effectiveRule && !keepsLegacyAutoFlow) return NextResponse.json({ message: '自动授予勋章必须配置获取条件' }, { status: 400 })

    const hasDescription = 'acquisitionDescription' in body
    const requestedDescription = typeof data.acquisitionDescription === 'string' ? data.acquisitionDescription.trim() : ''
    if (nextGrantType === 'AUTO' && effectiveRule) {
      const generatedDescription = targetGeneratedDescription || generateBadgeAcquisitionDescription(effectiveRule.ruleType, effectiveRule.threshold)
      const explicitlyResetToDefault = body.acquisitionDescriptionCustomized === false
      const explicitlyCustomized = body.acquisitionDescriptionCustomized === true
      if (explicitlyResetToDefault) {
        data.acquisitionDescription = generatedDescription
        data.acquisitionDescriptionCustomized = false
      } else if (explicitlyCustomized && hasDescription && requestedDescription) {
        data.acquisitionDescription = requestedDescription
        data.acquisitionDescriptionCustomized = true
      } else if (previous.acquisitionDescriptionCustomized && !hasDescription) {
        data.acquisitionDescription = previous.acquisitionDescription
        data.acquisitionDescriptionCustomized = true
      } else {
        const customized = Boolean(requestedDescription) && requestedDescription !== generatedDescription
        data.acquisitionDescription = customized ? requestedDescription : generatedDescription
        data.acquisitionDescriptionCustomized = customized
      }
    } else if (!hasDescription && previous.acquisitionDescriptionCustomized) {
      data.acquisitionDescription = previous.acquisitionDescription
      data.acquisitionDescriptionCustomized = true
    }
    if (nextGrantType !== 'AUTO') data.acquisitionDescriptionCustomized = false

    const result = await prisma.$transaction(async (tx) => {
      await tx.badge.update({ where: { id: badgeId }, data, select: { id: true } })
      if (nextGrantType === 'AUTO' && effectiveRule) {
        const ruleData = {
          ruleType: effectiveRule.ruleType,
          operator: effectiveRule.operator,
          threshold: effectiveRule.threshold,
          secondaryThreshold: effectiveRule.secondaryThreshold,
          configJson: effectiveRule.configJson ?? Prisma.JsonNull,
          isEnabled: nextGrantType === 'AUTO' ? effectiveRule.isEnabled : false,
        }
        await tx.badgeRule.upsert({
          where: { badgeId },
          create: { badgeId, ...ruleData },
          update: ruleData,
        })
      } else if (nextGrantType !== 'AUTO' && previous.BadgeRule) {
        await tx.badgeRule.delete({ where: { badgeId } })
      }
      const updated = await tx.badge.findUniqueOrThrow({ where: { id: badgeId }, select: badgeAdminSelect })
      const trackingStillValid = updated.grantType === 'AUTO'
        && updated.isEnabled && updated.isActive
        && updated.visibility === 'PUBLIC'
        && updated.BadgeRule?.isEnabled && updated.BadgeRule.operator === 'GTE'
        && updated.BadgeRule.threshold !== null
        && ['PERMANENT', 'AVAILABLE'].includes(getBadgeAvailability(updated))
      if (!trackingStillValid) await tx.userBadgeTracking.deleteMany({ where: { badgeId } })
      const affectedUsers = await tx.user.findMany({ where: { equippedBadgeId: badgeId }, select: { id: true, uid: true } })
      const shouldClearEquipped = data.isEnabled === false || data.isActive === false || data.isWearable === false
      if (shouldClearEquipped) await tx.user.updateMany({ where: { equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })
      if (data.isEnabled === false || data.isActive === false) await tx.userBadgeShowcase.deleteMany({ where: { badgeId } })
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
      if (Object.keys(data).some((field) => field === 'availableFrom' || field === 'availableUntil')) {
        await writeBadgeAdminAction(tx, {
          actorId: guard.user.id,
          action: 'BADGE_AVAILABILITY_UPDATE',
          badgeId,
          detail: {
            availableFrom: effectiveAvailableFrom?.toISOString() || null,
            availableUntil: effectiveAvailableUntil?.toISOString() || null,
          },
        })
      }
      if (Object.keys(data).some((field) => field === 'tierGroupCode' || field === 'tierLevel')) {
        await writeBadgeAdminAction(tx, {
          actorId: guard.user.id,
          action: 'BADGE_TIER_UPDATE',
          badgeId,
          detail: { tierGroupCode: effectiveTierGroupCode, tierLevel: effectiveTierLevel },
        })
      }
      if (previous.BadgeRule && nextGrantType !== 'AUTO') {
        await writeBadgeAdminAction(tx, {
          actorId: guard.user.id,
          action: 'BADGE_AUTO_RULE_DISABLE',
          badgeId,
          detail: { reason: 'grantType changed', ruleId: previous.BadgeRule.id },
        })
      } else if (effectiveRule && (parsed.rule !== undefined || !previous.BadgeRule)) {
        await writeBadgeAdminAction(tx, {
          actorId: guard.user.id,
          action: previous.BadgeRule ? 'BADGE_AUTO_RULE_UPDATE' : 'BADGE_AUTO_RULE_CREATE',
          badgeId,
          detail: { ruleType: effectiveRule.ruleType, operator: effectiveRule.operator, threshold: effectiveRule.threshold, isEnabled: nextGrantType === 'AUTO' && effectiveRule.isEnabled },
        })
      }
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
    const stats = await getBadgeOwnershipStats([badge.id])
    return NextResponse.json({ badge: serializeBadge(badge as unknown as Record<string, unknown>, stats.get(badge.id)) })
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
