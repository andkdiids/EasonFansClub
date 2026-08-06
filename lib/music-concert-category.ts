import { prisma } from '@/lib/prisma'
import { safeDb } from '@/lib/db-timeout'

// 演唱会分类配置（后台可配置，对应 MusicConcertCategory 表）。
// 三大核心分类 slug 固定：main / small / guest，与 MusicTour.category 枚举一一对应。
export type ConcertCategoryConfig = {
  id: string
  name: string
  slug: string
  sortOrder: number
  enabled: boolean
}

// 受保护的核心 slug：与 enum ConcertCategory（MAIN/SMALL/GUEST）绑定，禁止删除（否则巡演失去归类）。
export const RESERVED_CATEGORY_SLUGS = ['main', 'small', 'guest'] as const

// 枚举 → 核心 slug 映射，用于把旧 enum 数据归入可配置分类。
export const CONCERT_CATEGORY_ENUM_TO_SLUG: Record<string, string> = {
  MAIN: 'main',
  SMALL: 'small',
  GUEST: 'guest',
}

let cache: { value: ConcertCategoryConfig[]; at: number } | null = null
const CACHE_TTL = 30_000

async function loadCategories(): Promise<ConcertCategoryConfig[]> {
  const rows = await safeDb(
    'MusicConcertCategory.findMany categories',
    prisma.musicConcertCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, slug: true, sortOrder: true, enabled: true },
    }),
    [],
    6000,
  )
  return rows
}

// 读取全部分类（含禁用），供后台管理使用。失败返回空数组，避免页面崩溃。
export async function getConcertCategories(): Promise<ConcertCategoryConfig[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.value
  const value = await loadCategories().catch(() => [])
  cache = { value, at: Date.now() }
  return value
}

// 读取已启用的分类（按 sortOrder 排序），供前台展示。失败回退到三大核心。
export async function getEnabledConcertCategories(): Promise<ConcertCategoryConfig[]> {
  const all = await getConcertCategories().catch(() => [])
  const enabled = all.filter((category) => category.enabled)
  if (enabled.length) return enabled
  return RESERVED_CATEGORY_SLUGS.map((slug, index) => ({
    id: slug,
    name: slug === 'main' ? '大型演唱会' : slug === 'small' ? '小型企划' : '嘉宾现场',
    slug,
    sortOrder: index + 1,
    enabled: true,
  }))
}

export function isReservedCategorySlug(slug: string): boolean {
  return (RESERVED_CATEGORY_SLUGS as readonly string[]).includes(slug)
}
