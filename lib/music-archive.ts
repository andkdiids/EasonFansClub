// 演唱会资料库公开页 slug 解析（服务端专用，依赖 prisma）。
//
// 解析规则（不新增数据库字段 / 不迁移 / 不修改数据）：
// - 公开 URL 使用 generateArchiveSlug(MusicTour.name) 作为巡演段。
// - 兼容旧的 CUID 直链：先按 id 精确匹配，再按 slug 匹配；访问旧 id 时由页面 308 跳转到 slug。
// - 城市段使用 generateCitySlug(MusicConcert.city) 大写；同时兼容旧原始 city 直链。
// - 单场段使用 generateDateSlug(MusicConcert.concertDate) 的 YYYYMMDD；兼容旧 concertId 直链。

import { prisma } from '@/lib/prisma'
import { generateArchiveSlug, generateCitySlug, generateDateSlug } from '@/lib/music-slug'

export async function resolveTourByArchiveSlug(slug: string): Promise<{ id: string; name: string } | null> {
  const byId = await prisma.musicTour.findFirst({
    where: { id: slug, status: 'PUBLISHED' },
    select: { id: true, name: true },
  })
  if (byId) return byId
  const candidates = await prisma.musicTour.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, name: true },
  })
  const match = candidates.find((tour) => generateArchiveSlug(tour.name) === slug)
  return match ? { id: match.id, name: match.name } : null
}

export async function resolveCitySlugToCity(tourId: string, citySlug: string): Promise<string | null> {
  const rows = await prisma.musicConcert.findMany({
    where: { tourId, status: 'PUBLISHED' },
    distinct: ['city'],
    select: { city: true },
    orderBy: { city: 'asc' },
  })
  const decoded = decodeURIComponent(citySlug)
  // 兼容三种输入：中文原始城市（香港）、规范大写 slug（HONG-KONG）、小写 slug（hong-kong）
  const target = citySlug.toLowerCase()
  const match = rows.find(
    (row) => generateCitySlug(row.city).toLowerCase() === target || row.city === decoded,
  )
  return match ? match.city : null
}

export type ResolvedConcertSlug = {
  id: string
  tourSlug: string
  citySlug: string
  dateSlug: string
}

// 依据 巡演slug + 城市slug + 日期slug 解析单场。
// 兼容输入：tourSlug 可为 CUID 或 slug；citySlug 可为中文/大写 slug/小写 slug；dateSlug 为 YYYYMMDD。
// 返回规范三段 slug（用于 308 跳转）与真实 concert id（用于查详情）。
export async function resolveConcertBySlug(
  tourSlug: string,
  citySlug: string,
  dateSlug: string,
): Promise<ResolvedConcertSlug | null> {
  const tour = await resolveTourByArchiveSlug(tourSlug)
  if (!tour) return null
  const city = await resolveCitySlugToCity(tour.id, citySlug)
  if (!city) return null
  const concerts = await prisma.musicConcert.findMany({
    where: { tourId: tour.id, city, status: 'PUBLISHED' },
    select: { id: true, concertDate: true },
  })
  const match = concerts.find((c) => generateDateSlug(c.concertDate) === dateSlug)
  if (!match) return null
  return {
    id: match.id,
    tourSlug: generateArchiveSlug(tour.name),
    citySlug: generateCitySlug(city),
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
      MusicTour: { select: { id: true, name: true, status: true } },
    },
  })
  if (!concert || !concert.MusicTour || concert.MusicTour.status !== 'PUBLISHED') return null
  return {
    tourSlug: generateArchiveSlug(concert.MusicTour.name),
    citySlug: generateCitySlug(concert.city),
    dateSlug: generateDateSlug(concert.concertDate),
  }
}
