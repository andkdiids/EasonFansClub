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
