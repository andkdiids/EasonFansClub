import { PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_HEIGHT } from '@/lib/page-layout/constants'
import type { PageLayoutGridItem, PageLayoutPageKey } from '@/lib/page-layout/types'

const deprecatedModules = new Set([
  'profile.intro',
  'profile.stats',
  'profile.friendActivity',
  'forum.board',
  'forum.header',
  'forum.categoryNav',
  'forum.createPost',
  'forum.pinnedPosts',
  'forum.featuredPosts',
  'forum.latestPosts',
  'forum.hotPosts',
  'forum.sidebar',
  'forum.pagination',
  'checkin.stats',
  'checkin.today',
  'checkin.formOrMood',
  'checkin.messages',
])

export function isDeprecatedLayoutModule(pageKey: PageLayoutPageKey, key: string) {
  return deprecatedModules.has(key)
    || (pageKey === 'announcement' && key === 'announcement.board')
}

export function calculateGridHeightFromPixels(pixelHeight: number) {
  return Math.max(1, Math.ceil((Math.max(0, pixelHeight) + PAGE_LAYOUT_ROW_GAP) / (PAGE_LAYOUT_ROW_HEIGHT + PAGE_LAYOUT_ROW_GAP)))
}

export function normalizeLayoutItemHeight(
  grid: PageLayoutGridItem,
  fallback: PageLayoutGridItem,
  options: { minH?: number; maxH?: number; auto?: boolean } = {},
) {
  const minH = Math.max(1, options.minH ?? 1)
  const maxH = Math.max(minH, Math.min(options.maxH ?? 40, 40))
  const requested = options.auto && grid.h > Math.max(fallback.h * 2, 12) ? fallback.h : grid.h
  return { ...grid, h: Math.max(minH, Math.min(maxH, requested)) }
}
