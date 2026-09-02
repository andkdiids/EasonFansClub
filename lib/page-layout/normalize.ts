import { PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_HEIGHT } from '@/lib/page-layout/constants'
import type { PageLayoutDevice, PageLayoutGridItem, PageLayoutModuleConfig, PageLayoutPageKey } from '@/lib/page-layout/types'

const deprecatedModules = new Set([
  'home.checkinSummary',
  'home.checkinEntry',
  'home.forumEntry',
  'home.musicEntry',
  'home.featuredPosts',
  'home.dailyMessages',
  'home.music',
  'home.culture',
  'home.latestPosts',
  'home.footer',
  'announcement.header',
  'announcement.pinned',
  'announcement.list',
  'announcement.updateLogEntry',
  'announcement.sidebar',
  'announcement.pagination',
  'profile.calendar',
  'profile.recentMessages',
  'profile.posts',
  'admin.header',
  'admin.registrationStatus',
  'admin.stats',
  'admin.modules',
  'admin.deploymentStatus',
  'profile.intro',
  'profile.stats',
  'profile.friendActivity',
  'profile.wall',
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

function columnsFor(device: PageLayoutDevice) {
  if (device === 'desktop') return 12
  if (device === 'tablet') return 8
  return 4
}

function gridsOverlap(a: PageLayoutGridItem, b: PageLayoutGridItem) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function hasVisibleOverlap(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const visible = items.filter((item) => item.visible && !item.isHidden)
  return visible.some((item, index) => visible.slice(index + 1).some((other) => gridsOverlap(item.grid[device], other.grid[device])))
}

function fitsGrid(grid: PageLayoutGridItem, occupied: Set<string>, columns: number) {
  if (grid.x < 0 || grid.x + grid.w > columns) return false
  for (let y = grid.y; y < grid.y + grid.h; y += 1) {
    for (let x = grid.x; x < grid.x + grid.w; x += 1) {
      if (occupied.has(`${x}:${y}`)) return false
    }
  }
  return true
}

function occupyGrid(grid: PageLayoutGridItem, occupied: Set<string>) {
  for (let y = grid.y; y < grid.y + grid.h; y += 1) {
    for (let x = grid.x; x < grid.x + grid.w; x += 1) occupied.add(`${x}:${y}`)
  }
}

/**
 * Repair only the legacy layouts that contain visible collisions. Normal
 * layouts keep their saved coordinates; repaired layouts are packed with the
 * same top-left, collision-free rule used by the editor's Auto Arrange.
 */
export function compactPageLayoutItems(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  if (!hasVisibleOverlap(items, device)) return items

  const columns = columnsFor(device)
  const occupied = new Set<string>()
  const visible = [...items]
    .filter((item) => item.visible && !item.isHidden)
    .sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order)
  const hidden = items.filter((item) => !item.visible || item.isHidden)
  const arranged = visible.map((item, index) => {
    const current = item.grid[device]
    const width = Math.max(1, Math.min(columns, current.w))
    const height = Math.max(1, Math.min(40, current.h))
    const base = { x: 0, y: 0, w: width, h: height }
    let placed = false
    let nextGrid = base
    for (let y = 0; y < 200 && !placed; y += 1) {
      for (let x = 0; x <= columns - width; x += 1) {
        const candidate = { ...base, x, y }
        if (!fitsGrid(candidate, occupied, columns)) continue
        nextGrid = candidate
        placed = true
        break
      }
    }
    occupyGrid(nextGrid, occupied)
    return {
      ...item,
      order: (index + 1) * 10,
      grid: { ...item.grid, [device]: nextGrid },
    }
  })
  return [...arranged, ...hidden]
}
