export const HOME_TODAY_PAGE_SIZE = 2

export function getHomeTodayPageCount(totalItems: number, pageSize = HOME_TODAY_PAGE_SIZE) {
  if (!Number.isFinite(totalItems) || totalItems <= 0 || pageSize <= 0) return 0
  return Math.ceil(totalItems / pageSize)
}

export function normalizeHomeTodayIndex(index: number, totalItems: number, pageSize = 1) {
  const pageCount = getHomeTodayPageCount(totalItems, pageSize)
  if (pageCount === 0) return 0
  const normalized = Number.isFinite(index) ? Math.trunc(index) : 0
  return ((normalized % pageCount) + pageCount) % pageCount
}

export function getHomeTodayPageItems<T>(items: readonly T[], pageIndex: number, pageSize = HOME_TODAY_PAGE_SIZE) {
  const safePageIndex = normalizeHomeTodayIndex(pageIndex, items.length, pageSize)
  const start = safePageIndex * pageSize
  return {
    pageIndex: safePageIndex,
    pageCount: getHomeTodayPageCount(items.length, pageSize),
    items: items.slice(start, start + pageSize),
  }
}
