/**
 * Pagination maths for publicly disclosed lottery winner lists.
 *
 * The platform rule is that a completed draw publishes its whole winner list.
 * The only cap allowed is a per-response page size, never a total cap: every
 * winner must stay reachable page by page, so a big batch can never silently
 * drop the tail of the list.
 *
 * This module is intentionally free of Prisma/DB imports so the boundary rules
 * can be unit tested without a database.
 */

export const PUBLIC_WINNER_DEFAULT_PAGE_SIZE = 20
export const PUBLIC_WINNER_MAX_PAGE_SIZE = 100

export type PublicWinnerPagination = { page?: number | string | null; pageSize?: number | string | null }

function positiveInteger(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback
}

/**
 * Clamps untrusted query input into a safe page window. Never throws:
 * non-numeric, negative, zero, NaN and oversized values all fall back to a
 * valid window so a malformed link can never break the public list.
 */
export function normalizePublicWinnerPagination(input?: PublicWinnerPagination | null) {
  const page = Math.max(1, positiveInteger(input?.page, 1))
  const pageSize = Math.min(PUBLIC_WINNER_MAX_PAGE_SIZE, Math.max(1, positiveInteger(input?.pageSize, PUBLIC_WINNER_DEFAULT_PAGE_SIZE)))
  return { page, pageSize }
}

/**
 * Resolves the database window (SKIP/TAKE) plus the metadata the client needs.
 * `total` is always the full count of winners, so `items` can be a single page
 * while the UI still reports the real number of winners.
 *
 * A page past the end is clamped to the last page instead of returning an empty
 * window: a stale link can never make a published winner list look incomplete.
 */
export function resolvePublicWinnerWindow(input: { page?: number | string | null; pageSize?: number | string | null; total: number }) {
  const requested = normalizePublicWinnerPagination(input)
  const pageSize = requested.pageSize
  const total = Math.max(0, Number.isFinite(input.total) ? Math.floor(input.total) : 0)
  const totalPages = Math.ceil(total / pageSize)
  const page = totalPages ? Math.min(requested.page, totalPages) : 1
  return { page, pageSize, total, totalPages, skip: (page - 1) * pageSize, take: pageSize }
}
