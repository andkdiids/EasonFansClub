import type { Prisma } from '@prisma/client'

export const POST_REPLY_PAGE_SIZE = 20
export const postReplySortValues = ['latest', 'hot'] as const
export type PostReplySort = typeof postReplySortValues[number]

export function parsePostReplySort(value: string | null | undefined): PostReplySort {
  return postReplySortValues.includes(value as PostReplySort) ? value as PostReplySort : 'latest'
}

export function getPostReplyOrderBy(sort: PostReplySort): Prisma.ReplyOrderByWithRelationInput[] {
  return sort === 'hot'
    ? [{ likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }]
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

export function canPinPostReply({ currentUserId, postAuthorId, parentId }: {
  currentUserId?: string | null
  postAuthorId?: string | null
  parentId: string | null
}) {
  return Boolean(currentUserId && postAuthorId && currentUserId === postAuthorId && parentId === null)
}
