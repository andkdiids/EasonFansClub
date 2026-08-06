import { prisma } from '@/lib/prisma'
import type { StickerReportReason } from '@prisma/client'

/** 选择器可见表情：未隐藏、未下架、所属合集已通过审核。 */
const VISIBLE_STICKER_WHERE = {
  isHidden: false,
  enabled: true,
  pack: { status: 'APPROVED' as const },
}

export type StickerView = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  usageCount: number
  packId: string
  createdAt: string
}

export type PickerSticker = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
}

function toPicker(sticker: {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
}): PickerSticker {
  return { id: sticker.id, name: sticker.name, url: sticker.url, type: sticker.type }
}

/**
 * 我上传的表情：合集创作者是我、合集已通过、未隐藏。
 */
export async function getMyStickers(userId: string): Promise<StickerView[]> {
  const stickers = await prisma.sticker.findMany({
    where: {
      isHidden: false,
      pack: { creatorId: userId, status: 'APPROVED' },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      url: true,
      type: true,
      usageCount: true,
      packId: true,
      createdAt: true,
    },
  })
  return stickers.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))
}

/**
 * 我的收藏（按收藏时间倒序）。
 */
export async function getMyFavorites(userId: string): Promise<PickerSticker[]> {
  const rows = await prisma.stickerFavorite.findMany({
    where: { userId, sticker: VISIBLE_STICKER_WHERE },
    orderBy: { createdAt: 'desc' },
    select: { sticker: { select: { id: true, name: true, url: true, type: true } } },
  })
  return rows.map((r) => toPicker(r.sticker))
}

/**
 * 最近使用（按 lastUsedAt 倒序，取前 N）。
 */
export async function getRecentStickers(userId: string, limit = 28): Promise<PickerSticker[]> {
  const rows = await prisma.stickerUsage.findMany({
    where: { userId, sticker: VISIBLE_STICKER_WHERE },
    orderBy: { lastUsedAt: 'desc' },
    take: limit,
    select: { sticker: { select: { id: true, name: true, url: true, type: true } } },
  })
  return rows.map((r) => toPicker(r.sticker))
}

/**
 * 官方表情（全部官方合集下、已通过、未隐藏的表情，按合集分类与排序）。
 */
export async function getOfficialStickers(): Promise<PickerSticker[]> {
  const stickers = await prisma.sticker.findMany({
    where: { ...VISIBLE_STICKER_WHERE, pack: { ...VISIBLE_STICKER_WHERE.pack, isOfficial: true } },
    orderBy: [{ pack: { category: 'asc' } }, { pack: { createdAt: 'asc' } }, { sort: 'asc' }],
    select: { id: true, name: true, url: true, type: true },
  })
  return stickers.map(toPicker)
}

/**
 * 统一选择器数据：最近使用 / 收藏 / 官方 / 我的上传。
 * 排序规则：最近使用 > 使用次数 > 创建时间。
 */
export async function getPickerData(userId: string): Promise<{
  recent: PickerSticker[]
  favorites: PickerSticker[]
  official: PickerSticker[]
  myUploads: PickerSticker[]
}> {
  const [recent, favorites, official, myUploads] = await Promise.all([
    getRecentStickers(userId),
    getMyFavorites(userId),
    getOfficialStickers(),
    getMyUploadStickers(userId),
  ])
  return { recent, favorites, official, myUploads }
}

/** 我的上传（选择器用，不含 usageCount）。 */
export async function getMyUploadStickers(userId: string): Promise<PickerSticker[]> {
  const stickers = await prisma.sticker.findMany({
    where: { isHidden: false, pack: { creatorId: userId, status: 'APPROVED' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, url: true, type: true },
  })
  return stickers.map(toPicker)
}

/**
 * 记录一次使用：全局 usageCount +1；按用户 upsert 使用记录（count+1, lastUsedAt 刷新）。
 * 在发送评论/私信表情时调用。返回 false 表示表情不可见（被隐藏/未过审）。
 */
export async function recordStickerUsage(userId: string, stickerId: string): Promise<boolean> {
  const sticker = await prisma.sticker.findFirst({
    where: { id: stickerId, ...VISIBLE_STICKER_WHERE },
    select: { id: true },
  })
  if (!sticker) return false

  await prisma.$transaction([
    prisma.sticker.update({ where: { id: stickerId }, data: { usageCount: { increment: 1 } } }),
    prisma.stickerUsage.upsert({
      where: { userId_stickerId: { userId, stickerId } },
      create: { userId, stickerId, count: 1, lastUsedAt: new Date() },
      update: { count: { increment: 1 }, lastUsedAt: new Date() },
    }),
  ])
  return true
}

/**
 * 切换收藏：已收藏则取消，未收藏则添加。返回最新状态（isFavorited）。
 */
export async function toggleStickerFavorite(userId: string, stickerId: string): Promise<{ isFavorited: boolean }> {
  const existing = await prisma.stickerFavorite.findUnique({
    where: { userId_stickerId: { userId, stickerId } },
    select: { id: true },
  })
  if (existing) {
    await prisma.stickerFavorite.delete({ where: { userId_stickerId: { userId, stickerId } } })
    return { isFavorited: false }
  }
  await prisma.stickerFavorite.create({ data: { userId, stickerId } })
  return { isFavorited: true }
}

export type ReportStickerInput = {
  userId: string
  stickerId: string
  reason: StickerReportReason
  detail?: string
}

/**
 * 提交举报：去重（同一用户对同一表情的待处理举报只保留一条）。
 */
export async function reportSticker(input: ReportStickerInput): Promise<{ reported: boolean }> {
  const { userId, stickerId, reason, detail } = input
  const duplicate = await prisma.stickerReport.findFirst({
    where: { userId, stickerId, status: 'PENDING' },
    select: { id: true },
  })
  if (duplicate) return { reported: false }
  await prisma.stickerReport.create({
    data: {
      userId,
      stickerId,
      reason,
      detail: detail ? String(detail).slice(0, 500) : null,
    },
  })
  return { reported: true }
}

/** 判断某表情是否对当前用户可见（用于发送前校验）。 */
export async function isStickerVisible(stickerId: string): Promise<boolean> {
  const sticker = await prisma.sticker.findFirst({
    where: { id: stickerId, ...VISIBLE_STICKER_WHERE },
    select: { id: true },
  })
  return Boolean(sticker)
}

// ============ 后台管理 ============

export type AdminStickerFilter = 'ALL' | 'USER' | 'OFFICIAL' | 'REPORTED' | 'HIDDEN'

export type AdminStickerRow = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  usageCount: number
  isHidden: boolean
  enabled: boolean
  isOfficial: boolean
  category: string | null
  packName: string
  creator: { id: string; nickname: string; uid: number } | null
  reportCount: number
  createdAt: string
}

/**
 * 后台表情列表（单条记录 = 一个表情）。支持按来源/被举报/已隐藏筛选。
 */
export async function getAdminStickers(filter: AdminStickerFilter): Promise<AdminStickerRow[]> {
  const where: Record<string, unknown> = {}
  if (filter === 'OFFICIAL') where.pack = { isOfficial: true }
  else if (filter === 'USER') where.pack = { isOfficial: false }
  else if (filter === 'HIDDEN') where.isHidden = true
  else if (filter === 'REPORTED') where.reports = { some: { status: 'PENDING' } }

  const stickers = await prisma.sticker.findMany({
    where,
    orderBy: [{ isHidden: 'asc' }, { usageCount: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      url: true,
      type: true,
      usageCount: true,
      isHidden: true,
      enabled: true,
      pack: { select: { name: true, isOfficial: true, category: true, creator: { select: { id: true, nickname: true, uid: true } } } },
      reports: { where: { status: 'PENDING' }, select: { id: true } },
      createdAt: true,
    },
  })

  return stickers.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type,
    usageCount: s.usageCount,
    isHidden: s.isHidden,
    enabled: s.enabled,
    isOfficial: s.pack.isOfficial,
    category: s.pack.category,
    packName: s.pack.name,
    creator: s.pack.creator,
    reportCount: s.reports.length,
    createdAt: s.createdAt.toISOString(),
  }))
}

/**
 * 隐藏/恢复表情（违规处理）。隐藏后从所有选择器移除。
 */
export async function setStickerHidden(stickerId: string, hidden: boolean, reason?: string): Promise<void> {
  await prisma.sticker.update({
    where: { id: stickerId },
    data: {
      isHidden: hidden,
      hiddenAt: hidden ? new Date() : null,
      hiddenReason: hidden ? (reason ? String(reason).slice(0, 200) : '违规') : null,
    },
  })
  if (hidden) {
    await prisma.stickerReport.updateMany({
      where: { stickerId, status: 'PENDING' },
      data: { status: 'HIDDEN', handledAt: new Date() },
    })
  }
}

/**
 * 热门表情排行。
 * @param range 'total' 总使用最多；'week' 近 7 天使用最多。
 */
export async function getHotStickers(range: 'total' | 'week', limit = 20): Promise<PickerSticker[]> {
  if (range === 'total') {
    const stickers = await prisma.sticker.findMany({
      where: VISIBLE_STICKER_WHERE,
      orderBy: { usageCount: 'desc' },
      take: limit,
      select: { id: true, name: true, url: true, type: true },
    })
    return stickers.map(toPicker)
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const grouped = await prisma.stickerUsage.groupBy({
    by: ['stickerId'],
    where: { lastUsedAt: { gte: since } },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
    take: limit,
  })
  const ids = grouped.map((g) => g.stickerId)
  if (ids.length === 0) return []
  const stickers = await prisma.sticker.findMany({
    where: { id: { in: ids }, ...VISIBLE_STICKER_WHERE },
    select: { id: true, name: true, url: true, type: true },
  })
  const order = new Map(ids.map((id, i) => [id, i]))
  return stickers
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map(toPicker)
}

/**
 * 后台：上架/下架单个表情（官方表情的启用关闭用 enabled，与违规隐藏 isHidden 区分）。
 */
export async function setStickerEnabled(stickerId: string, enabled: boolean): Promise<void> {
  await prisma.sticker.update({ where: { id: stickerId }, data: { enabled } })
}

/**
 * 后台：删除单个表情（含其合集为空时保留合集）。级联删除收藏/使用/举报记录。
 */
export async function deleteStickerAsAdmin(stickerId: string): Promise<void> {
  await prisma.sticker.delete({ where: { id: stickerId } })
}

export type StickerReportView = {
  id: string
  reason: StickerReportReason
  detail: string | null
  status: 'PENDING' | 'HIDDEN' | 'DISMISSED'
  createdAt: string
  reporter: { id: string; nickname: string; uid: number } | null
}

/** 后台：查看某个表情的全部举报记录。 */
export async function getStickerReports(stickerId: string): Promise<StickerReportView[]> {
  const rows = await prisma.stickerReport.findMany({
    where: { stickerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reason: true,
      detail: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, nickname: true, uid: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    detail: r.detail,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reporter: r.user,
  }))
}

/** 后台：忽略某条举报（标记 DISMISSED，不处理表情）。 */
export async function dismissStickerReport(reportId: string): Promise<void> {
  await prisma.stickerReport.update({
    where: { id: reportId },
    data: { status: 'DISMISSED', handledAt: new Date() },
  })
}

/**
 * 后台：创建官方表情。生成官方合集（isOfficial=true, status=APPROVED）与单张表情。
 * 图片已由调用方上传至存储，url 直接传入。
 */
export async function createOfficialSticker(input: {
  creatorId: string
  name: string | null
  url: string
  category?: string | null
  type: 'STATIC' | 'GIF'
}): Promise<AdminStickerRow> {
  const pack = await prisma.stickerPack.create({
    data: {
      name: input.name ? input.name : '官方表情',
      creatorId: input.creatorId,
      type: input.type,
      status: 'APPROVED',
      isOfficial: true,
      category: input.category || null,
    },
  })
  const sticker = await prisma.sticker.create({
    data: {
      packId: pack.id,
      name: input.name,
      url: input.url,
      type: input.type,
      enabled: true,
    },
    select: {
      id: true,
      name: true,
      url: true,
      type: true,
      usageCount: true,
      isHidden: true,
      enabled: true,
      createdAt: true,
      pack: {
        select: {
          name: true,
          isOfficial: true,
          category: true,
          creator: { select: { id: true, nickname: true, uid: true } },
        },
      },
    },
  })
  return {
    id: sticker.id,
    name: sticker.name,
    url: sticker.url,
    type: sticker.type,
    usageCount: sticker.usageCount,
    isHidden: sticker.isHidden,
    enabled: sticker.enabled,
    isOfficial: sticker.pack.isOfficial,
    category: sticker.pack.category,
    packName: sticker.pack.name,
    creator: sticker.pack.creator,
    reportCount: 0,
    createdAt: sticker.createdAt.toISOString(),
  }
}
