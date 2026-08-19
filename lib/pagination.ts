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
 * 构建分页页码模型。
 *
 * 规则（需求：总页数 > maxVisiblePages 时）：
 *  - 首页「1」与尾页「最后一页」始终显示，确保用户可快速回到第一页 / 最后一页；
 *  - 首页窗口：1..maxVisiblePages + … + 尾页
 *  - 尾页窗口：1 + … + (total-maxVisiblePages+1)..total
 *  - 中间页：1 + … + (current-half)..(current+half) + … + 尾页（中间窗口 = maxVisiblePages-2）
 *  - 总页数 <= maxVisiblePages：全部平铺，保持原显示逻辑。
 *
 * 示例（maxVisiblePages=7，total=108）：
 *  current=108 → [1, …, 102..108]
 *  current=1   → [1..7, …, 108]
 *  current=50  → [1, …, 48..52, …, 108]
 */
export function getPaginationItems(currentPage: number, totalPages: number, maxVisiblePages = 7): PaginationItem[] {
  const safeTotal = Math.max(1, Math.trunc(totalPages) || 1)
  const safeSize = Math.max(1, Math.min(Math.trunc(maxVisiblePages) || 1, safeTotal))
  const current = clampPaginationPage(currentPage, safeTotal)

  const range = (start: number, end: number) => {
    const items: number[] = []
    for (let page = start; page <= end; page += 1) items.push(page)
    return items
  }

  // 总页数不超过窗口：全部平铺
  if (safeTotal <= safeSize) return range(1, safeTotal)

  // 首页窗口：1..safeSize + … + 尾页
  if (current <= safeSize) {
    return [...range(1, safeSize), 'ellipsis', safeTotal]
  }

  // 尾页窗口：1 + … + (total-safeSize+1)..total
  if (current >= safeTotal - safeSize + 1) {
    return [1, 'ellipsis', ...range(safeTotal - safeSize + 1, safeTotal)]
  }

  // 中间页：1 + … + 当前附近窗口 + … + 尾页（中间窗口 = safeSize-2）
  const half = Math.floor((safeSize - 2) / 2)
  const midStart = Math.max(1, current - half)
  const midEnd = Math.min(safeTotal, current + half)
  return [1, 'ellipsis', ...range(midStart, midEnd), 'ellipsis', safeTotal]
}
