import type { Prisma } from '@prisma/client'

export const POST_REPLY_PAGE_SIZE = 20
export const postReplySortValues = ['floor', 'hot'] as const
export type PostReplySort = typeof postReplySortValues[number]
export const postReplyDirectionValues = ['asc', 'desc'] as const
export type PostReplyDirection = typeof postReplyDirectionValues[number]
export type PostReplyNavigationReason = 'pagination' | 'sort' | 'target-comment' | 'target-reply' | null
export type PostReplyPagination = { page: number; pageSize: number; total: number; totalPages: number }

export function parsePostReplySort(value: string | null | undefined): PostReplySort {
  if (value === 'latest') return 'floor'
  return postReplySortValues.includes(value as PostReplySort) ? value as PostReplySort : 'floor'
}

export function parsePostReplyDirection(value: string | null | undefined, legacySort?: string | null): PostReplyDirection {
  if (legacySort === 'latest') return 'desc'
  return value === 'desc' ? 'desc' : 'asc'
}

export function getPostReplyOrderBy(sort: PostReplySort, direction: PostReplyDirection = 'asc'): Prisma.ReplyOrderByWithRelationInput[] {
  return sort === 'hot'
    ? [{ likeCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }]
    : direction === 'desc'
      ? [{ createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'asc' }, { id: 'asc' }]
}

/**
 * Calculate the floor for a zero-based position in a canonical root-reply
 * sequence. The UI must use the persisted/computed floor on each reply, not
 * the index of the currently rendered (possibly pinned or re-sorted) array.
 */
export function getCommentFloor({ page, pageSize, index }: Readonly<{ page: number; pageSize: number; index: number }>) {
  const safePage = Number.isFinite(page) && Math.trunc(page) > 0 ? Math.trunc(page) : 1
  const safePageSize = Number.isFinite(pageSize) && Math.trunc(pageSize) > 0 ? Math.trunc(pageSize) : 1
  const safeIndex = Number.isFinite(index) && Math.trunc(index) >= 0 ? Math.trunc(index) : 0
  return (safePage - 1) * safePageSize + safeIndex + 1
}

/**
 * Build stable floor numbers from roots already ordered by createdAt ASC and
 * id ASC. Pinned roots are intentionally included in this source sequence so
 * moving one to the top of the UI never changes its real floor or closes a
 * floor number gap in the normal list.
 */
export function buildPostReplyFloorMap<T extends { id: string; parentId?: string | null }>(rootReplies: readonly T[], pageSize = POST_REPLY_PAGE_SIZE) {
  const safePageSize = Number.isFinite(pageSize) && Math.trunc(pageSize) > 0 ? Math.trunc(pageSize) : 1
  const canonicalRoots = rootReplies.filter((reply) => reply.parentId === undefined || reply.parentId === null)
  return new Map(canonicalRoots.map((reply, index) => {
    const page = Math.floor(index / safePageSize) + 1
    const pageIndex = index % safePageSize
    return [reply.id, getCommentFloor({ page, pageSize: safePageSize, index: pageIndex })] as const
  }))
}

export function getPostReplyTotalPages(total: number, pageSize = POST_REPLY_PAGE_SIZE) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

export function clampPostReplyPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, Math.trunc(page) || 1), Math.max(1, totalPages))
}

export function getPostReplyOffset(page: number, pageSize = POST_REPLY_PAGE_SIZE) {
  return (Math.max(1, Math.trunc(page) || 1) - 1) * Math.max(1, Math.trunc(pageSize) || 1)
}

export function shouldScrollToPostRepliesTop(reason: PostReplyNavigationReason, hasTargetNavigation: boolean) {
  return !hasTargetNavigation && (reason === 'pagination' || reason === 'sort')
}

/**
 * Split the root replies visible to the current viewer without changing the
 * persisted pin state or the server-side pagination order.
 *
 * `viewerRoots` is intentionally supplied separately: it can contain replies
 * from a different page, so a viewer can see their own root replies at the
 * top without loading every paginated root into the normal list.
 */
export function splitViewerPostReplyRoots<
  T extends { id: string; parentId: string | null; isPinned: boolean },
>(visibleRoots: readonly T[], viewerRoots: readonly T[]) {
  const viewerRootIds = new Set<string>()
  const my = viewerRoots.filter((reply) => {
    if (reply.parentId !== null || viewerRootIds.has(reply.id)) return false
    viewerRootIds.add(reply.id)
    return true
  })
  const visible = visibleRoots.filter((reply) => !viewerRootIds.has(reply.id))

  return {
    my,
    visible,
    pinned: visible.filter((reply) => reply.isPinned),
    normal: visible.filter((reply) => !reply.isPinned),
  }
}

export function canPinPostReply({ currentUserId, postAuthorId, parentId }: {
  currentUserId?: string | null
  postAuthorId?: string | null
  parentId: string | null
}) {
  return Boolean(currentUserId && postAuthorId && currentUserId === postAuthorId && parentId === null)
}
