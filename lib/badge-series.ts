import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'
import { writeBadgeAdminAction } from '@/lib/badge-service'
import { randomUUID } from 'node:crypto'

export type BadgeSeriesInput = {
  code?: unknown
  name?: unknown
  description?: unknown
  sortOrder?: unknown
  isEnabled?: unknown
  completionRewardBadgeId?: unknown
}
export function parseBadgeSeriesInput(body: BadgeSeriesInput, partial = false) {
  const data: Prisma.BadgeSeriesUncheckedCreateInput = {} as Prisma.BadgeSeriesUncheckedCreateInput
  // Series code is an immutable implementation detail generated on create.
  if (!partial || 'name' in body) {
    const name = sanitizeText(body.name, 120)
    if (!name) return { error: '请填写系列名称' }
    data.name = name
  }
  if (!partial || 'description' in body) {
    const description = sanitizeText(body.description, 500)
    data.description = description || null
  }
  if (!partial || 'sortOrder' in body) {
    const sortOrder = Number(body.sortOrder ?? 0)
    if (!Number.isSafeInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000) return { error: '系列排序必须是有效整数' }
    data.sortOrder = sortOrder
  }
  if ('isEnabled' in body) {
    if (typeof body.isEnabled !== 'boolean') return { error: '系列状态无效' }
    data.isEnabled = body.isEnabled
  }
  if ('completionRewardBadgeId' in body) {
    if (body.completionRewardBadgeId === null || body.completionRewardBadgeId === '') data.completionRewardBadgeId = null
    else if (typeof body.completionRewardBadgeId !== 'string' || !body.completionRewardBadgeId.trim() || body.completionRewardBadgeId.trim().length > 191) return { error: '系列完成奖励勋章标识无效' }
    else data.completionRewardBadgeId = body.completionRewardBadgeId.trim()
  }
  return { data }
}

export async function listBadgeSeriesForAdmin() {
  return prisma.badgeSeries.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { Badges: true } } },
  })
}

export async function createBadgeSeries(input: { actorId: string; data: Prisma.BadgeSeriesUncheckedCreateInput }) {
  return prisma.$transaction(async (tx) => {
    const code = `SERIES_${Date.now().toString(36).toUpperCase()}_${randomUUID().slice(0, 8).toUpperCase()}`
    const series = await tx.badgeSeries.create({ data: { ...input.data, code } })
    if (input.data.completionRewardBadgeId) await configureCompletionReward(tx, input.actorId, series.id, input.data.completionRewardBadgeId)
    await writeBadgeAdminAction(tx, {
      actorId: input.actorId,
      action: 'BADGE_SERIES_CREATE',
      detail: { seriesId: series.id, code: series.code, name: series.name },
    })
    return series
  })
}

export async function updateBadgeSeries(input: { actorId: string; seriesId: string; data: Prisma.BadgeSeriesUncheckedUpdateInput }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.badgeSeries.findUnique({ where: { id: input.seriesId }, select: { id: true, completionRewardBadgeId: true } })
    if (!current) throw new Error('勋章系列不存在')
    if (Object.prototype.hasOwnProperty.call(input.data, 'completionRewardBadgeId')) {
      const nextReward = input.data.completionRewardBadgeId as string | null
      if (current.completionRewardBadgeId && current.completionRewardBadgeId !== nextReward) await removeCompletionRewardRule(tx, current.completionRewardBadgeId, input.seriesId)
      if (nextReward) await configureCompletionReward(tx, input.actorId, input.seriesId, nextReward)
    }
    const series = await tx.badgeSeries.update({ where: { id: input.seriesId }, data: input.data })
    await writeBadgeAdminAction(tx, {
      actorId: input.actorId,
      action: 'BADGE_SERIES_UPDATE',
      detail: { seriesId: series.id, changedFields: Object.keys(input.data) },
    })
    return series
  })
}

/** Deleting a series only ungroups its badges; it never deletes Badge/UserBadge data. */
export async function deleteBadgeSeriesSafely(input: { actorId: string; seriesId: string }) {
  return prisma.$transaction(async (tx) => {
    const series = await tx.badgeSeries.findUnique({ where: { id: input.seriesId }, select: { id: true, code: true, name: true, completionRewardBadgeId: true } })
    if (!series) throw new Error('勋章系列不存在')
    if (series.completionRewardBadgeId) await removeCompletionRewardRule(tx, series.completionRewardBadgeId, input.seriesId)
    const affected = await tx.badge.updateMany({ where: { seriesId: input.seriesId }, data: { seriesId: null } })
    await tx.badgeSeries.delete({ where: { id: input.seriesId } })
    await writeBadgeAdminAction(tx, {
      actorId: input.actorId,
      action: 'BADGE_SERIES_DELETE',
      detail: { seriesId: series.id, code: series.code, name: series.name, ungroupedBadgeCount: affected.count },
    })
    return { ...series, ungroupedBadgeCount: affected.count }
  })
}

async function removeCompletionRewardRule(tx: Prisma.TransactionClient, badgeId: string, seriesId: string) {
  const rule = await tx.badgeRule.findUnique({ where: { badgeId }, select: { id: true, ruleType: true, configJson: true } })
  const config = rule?.configJson && typeof rule.configJson === 'object' && !Array.isArray(rule.configJson) ? rule.configJson as { seriesId?: unknown } : null
  if (rule?.ruleType === 'BADGE_SERIES_COMPLETE' && config?.seriesId === seriesId) await tx.badgeRule.delete({ where: { badgeId } })
}

async function configureCompletionReward(tx: Prisma.TransactionClient, actorId: string, seriesId: string, rewardBadgeId: string) {
  const reward = await tx.badge.findUnique({
    where: { id: rewardBadgeId },
    select: { id: true, name: true, isEnabled: true, isActive: true, grantType: true, seriesId: true, countsTowardSeriesCompletion: true, BadgeRule: { select: { id: true, ruleType: true, configJson: true } } },
  })
  if (!reward) throw new Error('系列完成奖励勋章不存在')
  if (!reward.isEnabled || !reward.isActive) throw new Error('系列完成奖励勋章必须处于启用状态')
  if (reward.grantType !== 'AUTO') throw new Error('系列完成奖励勋章必须使用系统自动授予')
  if (reward.seriesId === seriesId && reward.countsTowardSeriesCompletion) {
    await tx.badge.update({ where: { id: rewardBadgeId }, data: { countsTowardSeriesCompletion: false } })
  }
  const currentRule = reward.BadgeRule
  if (currentRule && (currentRule.ruleType !== 'BADGE_SERIES_COMPLETE' || !isSeriesRuleFor(currentRule.configJson, seriesId))) {
    throw new Error('该勋章已有其他自动规则，不能直接设为系列完成奖励')
  }
  await tx.badgeRule.upsert({
    where: { badgeId: rewardBadgeId },
    create: { badgeId: rewardBadgeId, ruleType: 'BADGE_SERIES_COMPLETE', operator: 'GTE', threshold: null, configJson: { seriesId }, isEnabled: true },
    update: { ruleType: 'BADGE_SERIES_COMPLETE', operator: 'GTE', threshold: null, configJson: { seriesId }, isEnabled: true },
  })
  await writeBadgeAdminAction(tx, {
    actorId,
    action: 'BADGE_SERIES_REWARD_UPDATE',
    detail: { seriesId, rewardBadgeId, rewardBadgeName: reward.name },
  })
}

function isSeriesRuleFor(configJson: unknown, seriesId: string) {
  return Boolean(configJson && typeof configJson === 'object' && !Array.isArray(configJson) && (configJson as { seriesId?: unknown }).seriesId === seriesId)
}
