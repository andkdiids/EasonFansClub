import { prisma } from '@/lib/prisma'
import { emitRealtime, emitRealtimeToAdmins } from '@/lib/realtime'
import { toPublicMediaUrl } from '@/lib/media-url'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { getStickerPackReviewNotificationLink } from '@/lib/sticker-pack-editing'
import type { Prisma, StickerReportReason } from '@prisma/client'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createManyNotifications, createNotification } from '@/lib/notification-write'

/** 选择器可见表情：未隐藏、未下架、所属合集已通过审核。 */
const VISIBLE_STICKER_WHERE = {
  isHidden: false,
  enabled: true,
  moderationStatus: 'NORMAL' as const,
  pack: { status: 'APPROVED' as const, moderationStatus: 'NORMAL' as const },
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
  packId?: string
}

export type StickerPackLite = {
  id: string
  name: string
  iconUrl: string | null
  coverUrl: string | null
  type: 'STATIC' | 'GIF'
}

export type PickerData = {
  packs: StickerPackLite[]
  stickersByPack: Record<string, PickerSticker[]>
  recent: PickerSticker[]
  systemEmojis: string[]
  searchIndex: PickerSticker[]
}

const SYSTEM_EMOJI_SET: readonly string[] = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','💋','👄','💯','💢','💥','💫','💦','💨','🕳️','💣','🧨','🎉','🎊','🎁','🎂','🎈','🎀','🎐','🎑','🧧','🌹','🥀','🌺','🌻','🌼','🌷','🌸','💐',
  '👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','✋','🤚','🖐️','🖖','👋','🤝','🙏','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤜','💪','🦾','🤳','💅','🦵','🦿','🦶','👂','🦻','👃','🧠','👀','👁️','👄','👅','💋','😶','🫦','🫥','🫧',
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦣','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐫','🐪','🐭','🦥','🦦','🦨','🦘','🐁','🐀','🐿️','🦔',
  '🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🫔','🥫','🍝','🍜','🍲','🍛','🍣','🥟','🦐','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂','🥃','🥤','🧋','🧃','🧉','🧊',
] as const

const emojiSet = (() => {
  const seen = new Set<string>()
  for (const e of SYSTEM_EMOJI_SET) seen.add(e)
  return [...seen]
})()

function toPicker(sticker: {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  packId?: string
}): PickerSticker {
  return {
    id: sticker.id,
    name: sticker.name,
    url: toPublicMediaUrl(sticker.url) || sticker.url,
    type: sticker.type,
    packId: sticker.packId,
  }
}

/**
 * 我上传的表情：合集创作者是我、合集已通过、未隐藏。
 */
export async function getMyStickers(userId: string): Promise<StickerView[]> {
  const stickers = await prisma.sticker.findMany({
    where: {
      isHidden: false,
      moderationStatus: 'NORMAL',
      pack: { creatorId: userId, status: 'APPROVED', moderationStatus: 'NORMAL' },
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
  return stickers.map((s) => ({ ...s, url: toPublicMediaUrl(s.url) || s.url, createdAt: s.createdAt.toISOString() }))
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
 * 微信式选择器数据：用户已添加的表情包（UserStickerPack）+ 每个表情包的可见表情 + 最近使用 + 系统 emoji + 搜索索引。
 *
 * 与原 `getPickerData` 不同：
 *  - 数据结构与微信对齐：按用户已添加的「表情包」分页。
 *  - 搜索索引从「全站可见 + 我添加过的」合集合并。
 */
export async function getPickerData(userId: string): Promise<PickerData> {
  // 1. 用户的 UserStickerPack 列表（按最近添加时间倒序）
  const addedRows = await prisma.userStickerPack.findMany({
    where: { user: { id: userId }, pack: VISIBLE_STICKER_WHERE.pack },
    orderBy: { createdAt: 'desc' },
    select: {
      pack: {
        select: {
          id: true,
          name: true,
          coverUrl: true,
          type: true,
          stickers: {
            where: { isHidden: false, enabled: true, moderationStatus: 'NORMAL' },
            orderBy: { sort: 'asc' },
            select: { id: true, name: true, url: true, type: true, packId: true, sort: true },
          },
        },
      },
    },
  })

  const packs: StickerPackLite[] = []
  const stickersByPack: Record<string, PickerSticker[]> = {}
  for (const row of addedRows) {
    const pack = row.pack
    packs.push({
      id: pack.id,
      name: pack.name,
      coverUrl: toPublicMediaUrl(pack.coverUrl),
      iconUrl: toPublicMediaUrl(pack.stickers[0]?.url) || toPublicMediaUrl(pack.coverUrl),
      type: pack.type,
    })
    stickersByPack[pack.id] = pack.stickers.map(toPicker)
  }

  // 2. 最近使用表情（全部用户已可见的表情）
  const recent = await getRecentStickers(userId, 8)

  // 3. 搜索索引：用户已添加的合集 + 官方推荐合集（兜底，方便查找新表情）
  const userStickerIds = new Set<string>()
  for (const pack of packs) stickersByPack[pack.id]?.forEach((s) => userStickerIds.add(s.id))

  const officialSample = await prisma.sticker.findMany({
    where: { ...VISIBLE_STICKER_WHERE, pack: { ...VISIBLE_STICKER_WHERE.pack, isOfficial: true } },
    orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
    take: 80,
    select: { id: true, name: true, url: true, type: true, packId: true },
  })
  const officialList: PickerSticker[] = officialSample.map(toPicker)
  // 把最近使用也合并进搜索索引
  const indexMap = new Map<string, PickerSticker>()
  for (const s of [...recent, ...officialList]) {
    if (!indexMap.has(s.id)) indexMap.set(s.id, s)
  }
  for (const list of Object.values(stickersByPack)) {
    for (const s of list) {
      if (!indexMap.has(s.id)) indexMap.set(s.id, s)
    }
  }
  const searchIndex = [...indexMap.values()]

  return {
    packs,
    stickersByPack,
    recent,
    systemEmojis: emojiSet,
    searchIndex,
  }
}

/** 我的上传（选择器用，不含 usageCount）。 */
export async function getMyUploadStickers(userId: string): Promise<PickerSticker[]> {
  const stickers = await prisma.sticker.findMany({
    where: { isHidden: false, moderationStatus: 'NORMAL', pack: { creatorId: userId, status: 'APPROVED', moderationStatus: 'NORMAL' } },
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
    url: toPublicMediaUrl(s.url) || s.url,
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
          creator: { select: { id: true, nickname: true, uid: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
        },
      },
    },
  })
  return {
    id: sticker.id,
    name: sticker.name,
    url: toPublicMediaUrl(sticker.url) || sticker.url,
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

// ===========================================================================
// 微信式表情商店 / 用户表情库（UserStickerPack）
// ===========================================================================

export type StorePackItem = {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  iconUrl: string | null
  type: 'STATIC' | 'GIF'
  category: string | null
  isOfficial: boolean
  creator: { id: string; nickname: string; uid: number } | null
  stickerCount: number
  downloadCount: number
  addedByCount: number
  added: boolean
  createdAt: string
}

export type StickerStoreSort = 'hot' | 'new' | 'official'

export function getStorePackOrderBy(sort: StickerStoreSort): Prisma.StickerPackOrderByWithRelationInput | Prisma.StickerPackOrderByWithRelationInput[] {
  if (sort === 'hot') {
    return [
      { UserStickerPack: { _count: 'desc' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]
  }

  return { createdAt: 'desc' }
}

/**
 * 获取表情包汇总计数。
 * `UserStickerPack` 的记录代表一个用户将合集添加到表情库，按合集计数即为商店下载量。
 * `Sticker.usageCount` 只代表发送/使用次数，不能用于热门合集排序。
 */
async function aggregatePackUsage(packIds: string[]): Promise<Map<string, { stickerCount: number; downloadCount: number; addedByCount: number; usageCount: number }>> {
  const result = new Map<string, { stickerCount: number; downloadCount: number; addedByCount: number; usageCount: number }>()
  if (packIds.length === 0) return result
  const groups = await prisma.sticker.groupBy({
    by: ['packId'],
    where: { packId: { in: packIds }, isHidden: false, enabled: true, moderationStatus: 'NORMAL', pack: { status: 'APPROVED', moderationStatus: 'NORMAL' } },
    _count: { _all: true },
    _sum: { usageCount: true },
  })
  for (const g of groups) {
    result.set(g.packId, {
      stickerCount: g._count._all,
      downloadCount: 0,
      addedByCount: 0,
      usageCount: g._sum.usageCount ?? 0,
    })
  }
  // 每个 UserStickerPack 记录代表一次用户添加/下载，按合集统计全局下载量。
  const addedGroups = await prisma.userStickerPack.groupBy({
    by: ['packId'],
    where: { packId: { in: packIds } },
    _count: { _all: true },
  })
  for (const g of addedGroups) {
    const prev = result.get(g.packId) ?? { stickerCount: 0, downloadCount: 0, addedByCount: 0, usageCount: 0 }
    result.set(g.packId, { ...prev, downloadCount: g._count._all, addedByCount: g._count._all })
  }
  return result
}

/**
 * 表情商店列表：所有通过审核的表情包（官方 + 用户），按下载量排序。
 */
export async function getStorePacks(opts: {
  userId: string
  page?: number
  pageSize?: number
  sort?: StickerStoreSort
  category?: string | null
}): Promise<{ packs: StorePackItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(60, Math.max(8, opts.pageSize ?? 24))
  const sort = opts.sort ?? 'hot'

  const where: { status: 'APPROVED'; moderationStatus: 'NORMAL'; category?: string; isOfficial?: boolean } = { status: 'APPROVED', moderationStatus: 'NORMAL' }
  if (opts.category) where.category = opts.category
  if (sort === 'official') where.isOfficial = true

  const [packs, total] = await Promise.all([
    prisma.stickerPack.findMany({
      where,
      orderBy: getStorePackOrderBy(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        coverUrl: true,
        type: true,
        category: true,
        isOfficial: true,
        createdAt: true,
        creator: { select: { id: true, nickname: true, uid: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
      },
    }),
    prisma.stickerPack.count({ where }),
  ])

  const agg = await aggregatePackUsage(packs.map((p) => p.id))
  const addedSet = await getUserAddedPackIds(opts.userId, packs.map((p) => p.id))
  // 热门顺序已经由数据库在 skip/take 之前完成；其他分类继续使用创建时间顺序。
  let ordered = packs
  if (sort === 'official') {
    // 保留官方分类原有的当前页使用次数排序，不影响热门的全局下载排序。
    ordered = [...packs].sort((a, b) => (agg.get(b.id)?.usageCount ?? 0) - (agg.get(a.id)?.usageCount ?? 0))
  }

  const items = ordered.map<StorePackItem>((pack) => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    coverUrl: toPublicMediaUrl(pack.coverUrl),
    iconUrl: null,
    type: pack.type,
    category: pack.category,
    isOfficial: pack.isOfficial,
    creator: pack.creator ? {
      id: pack.creator.id,
      uid: pack.creator.uid,
      nickname: getPublicUserDisplayName(pack.creator),
    } : null,
    stickerCount: agg.get(pack.id)?.stickerCount ?? 0,
    downloadCount: agg.get(pack.id)?.downloadCount ?? 0,
    addedByCount: agg.get(pack.id)?.addedByCount ?? 0,
    added: addedSet.has(pack.id),
    createdAt: pack.createdAt.toISOString(),
  }))

  return { packs: items, total, page, pageSize }
}

/** 用户已添加某个或多个表情包？返回命中 id Set。 */
async function getUserAddedPackIds(userId: string, packIds: string[]): Promise<Set<string>> {
  if (packIds.length === 0) return new Set()
  const rows = await prisma.userStickerPack.findMany({
    where: { userId, packId: { in: packIds } },
    select: { packId: true },
  })
  return new Set(rows.map((r) => r.packId))
}

export type StorePackDetail = StorePackItem & {
  copyright: string | null
  stickers: PickerSticker[]
}

/**
 * 表情包详情（含全部可见表情 + 用户是否已添加）。
 */
export async function getStorePackDetail(packId: string, userId: string | null): Promise<StorePackDetail | null> {
  const pack = await prisma.stickerPack.findFirst({
    where: { id: packId, status: 'APPROVED', moderationStatus: 'NORMAL' },
    select: {
      id: true,
      name: true,
      description: true,
      coverUrl: true,
      type: true,
      category: true,
      isOfficial: true,
      createdAt: true,
      creator: { select: { id: true, nickname: true, uid: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
      stickers: {
        where: { isHidden: false, enabled: true, moderationStatus: 'NORMAL' },
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, url: true, type: true, packId: true },
      },
    },
  })
  if (!pack) return null
  const agg = await aggregatePackUsage([pack.id])
  const addedSet = userId ? await getUserAddedPackIds(userId, [pack.id]) : new Set<string>()
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    coverUrl: toPublicMediaUrl(pack.coverUrl),
    iconUrl: null,
    type: pack.type,
    category: pack.category,
    isOfficial: pack.isOfficial,
    creator: pack.creator ? {
      id: pack.creator.id,
      uid: pack.creator.uid,
      nickname: getPublicUserDisplayName(pack.creator),
    } : null,
    copyright: null,
    stickerCount: pack.stickers.length,
    downloadCount: agg.get(pack.id)?.downloadCount ?? 0,
    addedByCount: agg.get(pack.id)?.addedByCount ?? 0,
    added: addedSet.has(pack.id),
    createdAt: pack.createdAt.toISOString(),
    stickers: pack.stickers.map(toPicker),
  }
}

/**
 * 表情包商店分类列表（去重）。
 */
export async function getStoreCategories(): Promise<string[]> {
  const rows = await prisma.stickerPack.findMany({
    where: { status: 'APPROVED', moderationStatus: 'NORMAL' },
    select: { category: true },
    distinct: ['category'],
  })
  return rows.map((r) => r.category).filter((c): c is string => Boolean(c))
}

/**
 * 添加表情包到用户表情库。已添加则幂等。
 */
export async function addPackToLibrary(userId: string, packId: string): Promise<{ added: boolean }> {
  const exists = await prisma.userStickerPack.findUnique({
    where: { userId_packId: { userId, packId } },
    select: { id: true },
  })
  if (exists) return { added: true }
  // 校验合集存在且通过审核
  const pack = await prisma.stickerPack.findFirst({
    where: { id: packId, status: 'APPROVED', moderationStatus: 'NORMAL' },
    select: { id: true },
  })
  if (!pack) throw new Error('表情包不存在或未上架')
  await prisma.userStickerPack.create({ data: { userId, packId } })
  return { added: true }
}

/**
 * 取消添加表情包（不删除官方资源，仅取消本地添加）。
 */
export async function removePackFromLibrary(userId: string, packId: string): Promise<{ removed: boolean }> {
  const exists = await prisma.userStickerPack.findUnique({
    where: { userId_packId: { userId, packId } },
    select: { id: true },
  })
  if (!exists) return { removed: false }
  await prisma.userStickerPack.delete({ where: { userId_packId: { userId, packId } } })
  return { removed: true }
}

/**
 * 用户已添加的表情包（用于「我的表情库」页面）。
 */
export async function getMyLibraryPacks(userId: string): Promise<StorePackItem[]> {
  const rows = await prisma.userStickerPack.findMany({
    where: { userId, pack: { status: 'APPROVED', moderationStatus: 'NORMAL' } },
    orderBy: { createdAt: 'desc' },
    select: {
      pack: {
        select: {
          id: true,
          name: true,
          description: true,
          coverUrl: true,
          type: true,
          category: true,
          isOfficial: true,
          createdAt: true,
          creator: { select: { id: true, nickname: true, uid: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
        },
      },
    },
  })
  const packs = rows.map((r) => r.pack)
  const agg = await aggregatePackUsage(packs.map((p) => p.id))
  const items = packs.map<StorePackItem>((pack) => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    coverUrl: toPublicMediaUrl(pack.coverUrl),
    iconUrl: null,
    type: pack.type,
    category: pack.category,
    isOfficial: pack.isOfficial,
    creator: pack.creator ? { ...pack.creator, nickname: getPublicUserDisplayName(pack.creator) } : null,
    stickerCount: agg.get(pack.id)?.stickerCount ?? 0,
    downloadCount: agg.get(pack.id)?.downloadCount ?? 0,
    addedByCount: agg.get(pack.id)?.addedByCount ?? 0,
    added: true,
    createdAt: pack.createdAt.toISOString(),
  }))
  // 按最近添加顺序
  return items
}

// ===========================================================================
// 用户上传表情包（提交审核）
// ===========================================================================

export type SubmitStickerPackInput = {
  creatorId: string
  name: string
  description?: string | null
  copyright?: string | null
  coverUrl?: string | null
  bannerUrl?: string | null
  iconUrl?: string | null
  type: 'STATIC' | 'GIF'
  category?: string | null
  stickers: Array<{ name: string | null; url: string; type: 'STATIC' | 'GIF' }>
}

/**
 * 用户提交表情包：新建 Pack（status=PENDING）+ 多张 Sticker。返回 packId 与初审信息。
 */
export async function submitStickerPack(input: SubmitStickerPackInput): Promise<{ packId: string; status: 'PENDING' }> {
  if (!input.name?.trim()) throw new Error('请填写表情包名称')
  if (input.stickers.length < 6 || input.stickers.length > 60) {
    throw new Error('一个表情包需要包含 6–60 张表情')
  }
  const result = await prisma.$transaction(async (tx) => {
    const pack = await tx.stickerPack.create({
      data: {
        name: input.name.trim().slice(0, 40),
        description: input.description?.slice(0, 200) || null,
        coverUrl: input.coverUrl || null,
        creatorId: input.creatorId,
        type: input.type,
        status: 'PENDING',
        category: input.category?.slice(0, 40) || null,
      },
    })
    await tx.sticker.createMany({
      data: input.stickers.map((s, idx) => ({
        packId: pack.id,
        name: s.name?.slice(0, 4) || null,
        url: s.url,
        type: s.type,
        sort: idx,
        enabled: true,
      })),
    })

    return pack
  }, { timeout: 15_000, maxWait: 5_000 })
  await safeNotificationWrite(
    async () => {
      const [creator, administrators] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: input.creatorId }, select: { nickname: true } }),
        prisma.user.findMany({
          where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
          select: { id: true },
        }),
      ])
      if (!administrators.length) return
      await createManyNotifications({
        data: administrators.map((administrator) => ({
          recipientId: administrator.id,
          actorId: input.creatorId,
          type: 'ADMIN' as const,
          title: '新的表情包审核申请',
          content: `用户 ${creator.nickname} 提交了表情包《${result.name}》，请前往审核中心处理。`,
          link: '/admin/stickers',
          key: `sticker-pack-review:${result.id}`,
        })),
        skipDuplicates: true,
      })
    },
    { operation: 'sticker-pack-submitted', userId: input.creatorId, notificationType: 'ADMIN' },
  )
  void emitRealtimeToAdmins('notification')
  return { packId: result.id, status: 'PENDING' }
}

// ===========================================================================
// 表情包审核（管理员）
// ===========================================================================

export type PendingPackRow = {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  type: 'STATIC' | 'GIF'
  category: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  reviewedAt: string | null
  creator: { id: string; nickname: string; uid: number }
  stickerCount: number
  sampleStickers: PickerSticker[]
  createdAt: string
}

/**
 * 列出待审核的表情包。带每包前 6 张样本图。
 */
export async function listReviewPacks(filter: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING'): Promise<PendingPackRow[]> {
  const packs = await prisma.stickerPack.findMany({
    where: { status: filter },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      coverUrl: true,
      type: true,
      category: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      creator: { select: { id: true, nickname: true, uid: true } },
      stickers: {
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, url: true, type: true, packId: true },
      },
    },
  })
  return packs.map<PendingPackRow>((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    coverUrl: toPublicMediaUrl(p.coverUrl),
    type: p.type,
    category: p.category,
    status: p.status as 'PENDING' | 'APPROVED' | 'REJECTED',
    rejectionReason: p.rejectionReason,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    creator: p.creator,
    stickerCount: p.stickers.length,
    sampleStickers: p.stickers.slice(0, 6).map(toPicker),
    createdAt: p.createdAt.toISOString(),
  }))
}

/**
 * 审核表情包：approve 或 reject。通过会发送 ADMIN 通知，拒绝会附带原因。
 */
export async function reviewStickerPack(input: {
  packId: string
  reviewerId: string
  action: 'APPROVE' | 'REJECT'
  reason?: string | null
}): Promise<{ status: 'APPROVED' | 'REJECTED'; packName: string }> {
  const pack = await prisma.stickerPack.findUnique({
    where: { id: input.packId },
    select: { id: true, name: true, creatorId: true, status: true },
  })
  if (!pack) throw new Error('表情包不存在')
  if (pack.status !== 'PENDING') throw new Error('该表情包当前不在待审核状态')
  const rejectionReason = input.reason?.trim().slice(0, 500) || ''
  if (input.action === 'REJECT' && !rejectionReason) throw new Error('请填写拒绝原因')
  const now = new Date()
  const newStatus: 'APPROVED' | 'REJECTED' = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  await prisma.stickerPack.update({
    where: { id: input.packId },
    data: {
      status: newStatus,
      rejectionReason: input.action === 'REJECT' ? rejectionReason : null,
      reviewedAt: now,
    },
  })
  const title = input.action === 'APPROVE' ? `你的表情包《${pack.name}》已通过审核` : `你的表情包《${pack.name}》未通过审核`
  const content =
    input.action === 'APPROVE'
      ? '已经上架表情商店，快去查看吧！'
      : `原因：${rejectionReason}`
  await safeNotificationWrite(
    () => createNotification({
      data: {
        recipientId: pack.creatorId,
        actorId: input.reviewerId,
        type: 'ADMIN',
        title,
        content,
        link: getStickerPackReviewNotificationLink(input.packId, newStatus),
        key: `sticker-pack-review:${input.packId}:${newStatus.toLowerCase()}:${now.getTime()}`,
      },
    }),
    { operation: 'sticker-pack-review', userId: pack.creatorId, notificationType: 'ADMIN' },
  )
  emitRealtime(pack.creatorId, 'notification')
  return { status: newStatus, packName: pack.name }
}
