// 演唱会资料库公开页 slug 解析（服务端专用，依赖 prisma）。
//
// 解析规则（不新增数据库字段 / 不迁移 / 不修改数据）：
// - 公开 URL 使用 generateArchiveSlug(MusicTour.name) 作为巡演段。
// - 兼容旧的 CUID 直链：先按 id 精确匹配，再按 slug 匹配；访问旧 id 时由页面 308 跳转到 slug。
// - 城市段使用「城市分组 slug」：基础城市 + 类型后缀（-ENCORE / -FINAL），避免同一城市
//   的首次/返场/最终站场次路由冲突。普通城市 slug 与原 generateCitySlug 一致（向后兼容）。
//   同时兼容旧的原始 city 直链与旧版 city slug 直链。
// - 单场段使用 generateDateSlug(MusicConcert.concertDate) 的 YYYYMMDD；兼容旧 concertId 直链。

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateArchiveSlug, generateCitySlug, generateDateSlug, cityGroupSlug, generateCityGroupSlug, effectiveCityGroup, type CityGroupType, type ConcertStageType } from '@/lib/music-slug'

// includeDrafts: 仅管理员预览（?preview=1）时为 true，放宽 status 过滤，允许查看草稿巡演。
export async function resolveTourByArchiveSlug(slug: string, includeDrafts = false): Promise<{ id: string; name: string } | null> {
  const byId = await prisma.musicTour.findFirst({
    where: { id: slug, ...(includeDrafts ? {} : { status: 'PUBLISHED' }) },
    select: { id: true, name: true },
  })
  if (byId) return byId
  const candidates = await prisma.musicTour.findMany({
    where: { ...(includeDrafts ? {} : { status: 'PUBLISHED' }) },
    select: { id: true, name: true },
  })
  const match = candidates.find((tour) => generateArchiveSlug(tour.name) === slug)
  return match ? { id: match.id, name: match.name } : null
}

export type ResolvedCityGroup = {
  base: string
  type: CityGroupType
  // 精确匹配成员（原始 city 字符串 + stageType），用于详情查询时区分同城市不同场次类型。
  // 新数据 city 为干净真实城市（如「香港」），普通场与返场场 city 相同、stageType 不同，
  // 必须用（city, stageType）组合才能正确隔离；旧数据 city 带标签（如「香港（返场）」），
  // stageType 默认 NORMAL，组合匹配同样有效。
  members: { city: string; stageType: ConcertStageType }[]
}

// 由分组精确成员生成查询条件（区分同城市不同场次类型）。
export function buildCityGroupWhere(group: ResolvedCityGroup): Prisma.MusicConcertWhereInput {
  const pairs = group.members.map((member) => ({ city: member.city, stageType: member.stageType }))
  if (pairs.length === 1) return { ...pairs[0] }
  return { OR: pairs }
}

// 依据「城市分组 slug」解析分组（服务端专用）。
// 兼容输入：新分组 slug（HONG-KONG / HONG-KONG-ENCORE / MACAU-FINAL）、
// 旧版 city slug（例如 澳门最终站）、中文原始 city（香港 / 澳门（最终站））。
export async function resolveCityGroupSlug(tourId: string, groupSlug: string, includeDrafts = false): Promise<ResolvedCityGroup | null> {
  const rows = await prisma.musicConcert.findMany({
    where: { tourId, ...(includeDrafts ? {} : { status: 'PUBLISHED' }) },
    distinct: ['city', 'stageType'],
    select: { city: true, stageType: true },
    orderBy: [{ city: 'asc' }, { stageType: 'asc' }],
  })
  let decoded = groupSlug
  try {
    decoded = decodeURIComponent(groupSlug)
  } catch {
    // Malformed percent-encoding should behave like an unknown city instead
    // of throwing out of the route and producing a client-side error page.
  }
  const target = groupSlug.toLowerCase()
  // 按（基础城市 + 类型）聚合为分组；类型由 stageType 优先、city 标签回退决定。
  const groups = new Map<string, ResolvedCityGroup>()
  for (const row of rows) {
    const { base, type } = effectiveCityGroup(row.city, row.stageType)
    const key = cityGroupSlug(base, type)
    const member = { city: row.city, stageType: (row.stageType || 'NORMAL') as ConcertStageType }
    const existing = groups.get(key)
    if (existing) {
      if (!existing.members.some((m) => m.city === member.city && m.stageType === member.stageType)) existing.members.push(member)
    } else {
      groups.set(key, { base, type, members: [member] })
    }
  }
  for (const [key, group] of groups) {
    const matchNew = key.toLowerCase() === target
    const matchOld = group.members.some((m) => generateCitySlug(m.city).toLowerCase() === target)
    const matchRaw = group.members.some((m) => m.city === decoded)
    if (matchNew || matchOld || matchRaw) return group
  }
  return null
}

export type ResolvedConcertSlug = {
  id: string
  tourSlug: string
  citySlug: string
  dateSlug: string
}

// 依据 巡演slug + 城市分组slug + 日期slug 解析单场。
// 兼容输入：tourSlug 可为 CUID 或 slug；citySlug 可为新分组 slug / 旧 city slug / 中文原始 city；
// dateSlug 为 YYYYMMDD。返回规范三段 slug（用于 308 跳转）与真实 concert id（用于查详情）。
export async function resolveConcertBySlug(
  tourSlug: string,
  citySlug: string,
  dateSlug: string,
  includeDrafts = false,
): Promise<ResolvedConcertSlug | null> {
  const tour = await resolveTourByArchiveSlug(tourSlug, includeDrafts)
  if (!tour) return null
  const group = await resolveCityGroupSlug(tour.id, citySlug, includeDrafts)
  if (!group) return null
  const concerts = await prisma.musicConcert.findMany({
    where: { tourId: tour.id, ...buildCityGroupWhere(group), ...(includeDrafts ? {} : { status: 'PUBLISHED' }) },
    orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, concertDate: true, startTime: true },
  })
  // 优先按「日期 + 开始时间」精确匹配（同一天多场），其次回退到纯日期（兼容旧 YYYYMMDD 直链）。
  const match = concerts.find((c) => generateDateSlug(c.concertDate, c.startTime) === dateSlug)
    || concerts.find((c) => generateDateSlug(c.concertDate) === dateSlug)
  if (!match) return null
  return {
    id: match.id,
    tourSlug: generateArchiveSlug(tour.name),
    citySlug: cityGroupSlug(group.base, group.type),
    dateSlug,
  }
}

// 依据旧 concertId 反查其规范 slug 路径（用于旧 URL 308 跳转到新 slug 地址）。
export async function resolveConcertSlugPath(
  concertId: string,
): Promise<{ tourSlug: string; citySlug: string; dateSlug: string } | null> {
  const concert = await prisma.musicConcert.findFirst({
    where: { id: concertId, status: 'PUBLISHED' },
    select: {
      concertDate: true,
      city: true,
      stageType: true,
      MusicTour: { select: { id: true, name: true, status: true } },
    },
  })
  if (!concert || !concert.MusicTour || concert.MusicTour.status !== 'PUBLISHED') return null
  return {
    tourSlug: generateArchiveSlug(concert.MusicTour.name),
    citySlug: generateCityGroupSlug(concert.city, concert.stageType),
    dateSlug: generateDateSlug(concert.concertDate),
  }
}
