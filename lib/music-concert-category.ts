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

// 核心 slug → 枚举 映射（反向），用于把选中的分类回写 MusicTour.category 枚举（保持旧字段兼容）。
export const MUSIC_CONCERT_CATEGORY_SLUG_TO_ENUM: Record<string, 'MAIN' | 'SMALL' | 'GUEST'> = {
  main: 'MAIN',
  small: 'SMALL',
  guest: 'GUEST',
}

// 根据分类 slug 推导兼容枚举值；非核心分类（如音乐节）回退到 MAIN 作为粗分类桶。
export function slugToConcertCategoryEnum(slug: string | null | undefined): 'MAIN' | 'SMALL' | 'GUEST' {
  if (!slug) return 'MAIN'
  return MUSIC_CONCERT_CATEGORY_SLUG_TO_ENUM[slug] ?? 'MAIN'
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

// 常见中文分类名 → 英文 slug 映射（避免引入拼音依赖，且更可控、更友好）。
// 注意：核心分类（大型演唱会/小型企划/嘉宾现场）不在映射中，它们必须使用保留 slug（main/small/guest）。
export const CATEGORY_NAME_SLUG_MAP: Record<string, string> = {
  小型演出: 'small-show',
  音乐节: 'music-festival',
  电台节目: 'radio-show',
  电台: 'radio-show',
  其他企划: 'other-project',
  演唱会: 'concert',
  巡演: 'tour',
  现场: 'live',
  综艺: 'variety-show',
  访谈: 'interview',
  签售: 'fan-meeting',
  见面会: 'fan-meeting',
  颁奖: 'awards',
  音乐剧: 'musical',
  直播: 'live-stream',
  线上演出: 'online-show',
  商演: 'commercial-show',
  公益: 'charity-show',
}

// 根据分类名生成 slug：优先使用映射表；否则保留中文/ASCII（与巡演 slug 约定一致），转小写并清理连字符。
export function slugifyCategoryName(name: string): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return ''
  if (CATEGORY_NAME_SLUG_MAP[trimmed]) return CATEGORY_NAME_SLUG_MAP[trimmed]
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// 校验分类 slug：允许小写字母、数字、中文与连字符，且以字母/数字/中文开头。
// 与旧版仅允许 ASCII 不同，这里允许中文，使中文分类名也能拥有合法 slug。
export function isValidCategorySlug(value: string): boolean {
  return /^[a-z0-9一-龥][a-z0-9一-龥-]*$/.test(value)
}

// 保证 slug 唯一：命中已存在记录时自动追加 -2 / -3 … 直到可用（excludeId 用于更新时排除自身）。
export async function ensureUniqueCategorySlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug || 'category'
  let attempt = 1
  for (;;) {
    const clash = await prisma.musicConcertCategory
      .findUnique({ where: { slug } })
      .catch(() => null)
    if (!clash || clash.id === excludeId) return slug
    attempt += 1
    slug = `${baseSlug}-${attempt}`
  }
}
