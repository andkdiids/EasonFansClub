// 演唱会资料库公开页 slug 解析（服务端专用，依赖 prisma）。
//
// 解析规则（不新增数据库字段 / 不迁移 / 不修改数据）：
// - 公开 URL 使用 generateArchiveSlug(MusicTour.name) 作为巡演段。
// - 兼容旧的 CUID 直链：先按 id 精确匹配，再按 slug 匹配；访问旧 id 时由页面 308 跳转到 slug。
// - 城市段使用 generateCitySlug(MusicConcert.city) 大写；同时兼容旧原始 city 直链。

import { prisma } from '@/lib/prisma'
import { generateArchiveSlug, generateCitySlug } from '@/lib/music-slug'

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
