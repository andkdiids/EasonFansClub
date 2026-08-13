export type PaginationItem = number | 'ellipsis'

export function scrollToSectionTop(element: { scrollIntoView: (options?: ScrollIntoViewOptions) => void } | null | undefined) {
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function clampPaginationPage(page: number, totalPages: number) {
  const safeTotal = Math.max(1, Math.trunc(totalPages) || 1)
  return Math.min(Math.max(1, Math.trunc(page) || 1), safeTotal)
}

export function parsePaginationJump(value: string, totalPages: number) {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null
  return clampPaginationPage(parsed, totalPages)
}

/**
 * Build a compact page-number model without duplicating the first or last
 * page when they are already part of the seven-page window.
 */
export function getPaginationItems(currentPage: number, totalPages: number, maxVisiblePages = 7): PaginationItem[] {
  const safeTotal = Math.max(1, Math.trunc(totalPages) || 1)
  const safeSize = Math.max(1, Math.min(Math.trunc(maxVisiblePages) || 1, safeTotal))
  const current = clampPaginationPage(currentPage, safeTotal)
  const half = Math.floor(safeSize / 2)
  let start = Math.max(1, current - half)
  const end = Math.min(safeTotal, start + safeSize - 1)
  start = Math.max(1, end - safeSize + 1)

  const items: PaginationItem[] = []
  if (start > 1 && end < safeTotal) items.push(1, 'ellipsis')
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < safeTotal) items.push('ellipsis', safeTotal)
  return items
}
