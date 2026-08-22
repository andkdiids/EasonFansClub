import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'
import { writeBadgeAdminAction } from '@/lib/badge-service'

const SERIES_CODE_PATTERN = /^[A-Z0-9_]{2,64}$/

export type BadgeSeriesInput = {
  code?: unknown
  name?: unknown
  description?: unknown
  sortOrder?: unknown
  isEnabled?: unknown
}
export function parseBadgeSeriesInput(body: BadgeSeriesInput, partial = false) {
  const data: Prisma.BadgeSeriesUncheckedCreateInput = {} as Prisma.BadgeSeriesUncheckedCreateInput
  if (!partial || 'code' in body) {
    const code = sanitizeText(body.code, 64).toUpperCase()
    if (!SERIES_CODE_PATTERN.test(code)) return { error: '系列 code 只能使用 2～64 位大写字母、数字或下划线' }
    data.code = code
  }
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
    const series = await tx.badgeSeries.create({ data: input.data })
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
    const series = await tx.badgeSeries.findUnique({ where: { id: input.seriesId }, select: { id: true, code: true, name: true } })
    if (!series) throw new Error('勋章系列不存在')
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
