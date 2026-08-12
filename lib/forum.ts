export const forumSortValues = ['latest', 'latest-reply', 'featured', 'pinned', 'most-replies'] as const
export type ForumSort = typeof forumSortValues[number]

export function parseForumSort(value: string | null): ForumSort {
  return forumSortValues.includes(value as ForumSort) ? value as ForumSort : 'latest'
}

export function excerptForumPost(value: string | null | undefined, length = 180) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length)}…` : text
}

export function getForumTotalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

export function clampForumPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, Math.trunc(page) || 1), Math.max(1, totalPages))
}

export function getForumPageWindow(currentPage: number, totalPages: number, size = 3) {
  const safeTotal = Math.max(1, totalPages)
  const safeSize = Math.max(1, Math.min(Math.trunc(size) || 1, safeTotal))
  const current = clampForumPage(currentPage, safeTotal)
  const offset = Math.floor(safeSize / 2)
  const start = Math.max(1, Math.min(current - offset, safeTotal - safeSize + 1))
  return Array.from({ length: safeSize }, (_, index) => start + index)
}

export function getForumOffset(page: number, pageSize: number) {
  return (Math.max(1, Math.trunc(page) || 1) - 1) * Math.max(1, Math.trunc(pageSize) || 1)
}

export function buildForumHref(pathname: string, currentQuery: string, values: Record<string, string | number | null>) {
  const next = new URLSearchParams(currentQuery)
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === '' || (key === 'page' && value === 1)) next.delete(key)
    else next.set(key, String(value))
  })
  const query = next.toString()
  return `${pathname}${query ? `?${query}` : ''}`
}

export type ForumFeedResponse = {
  boards: Array<{ id: string; name: string; slug: string; description: string | null; postCount: number; isAnnouncement: boolean }>
  selectedBoard: { id: string; name: string; slug: string; description: string | null; isAnnouncement: boolean } | null
  posts: Array<{
    id: string
    title: string
    likeCount: number
    replyCount: number
    viewCount: number
    isPinned: boolean
    isFeatured: boolean
    createdAt: string
    updatedAt: string
    likedByMe: boolean
    board: { name: string; slug: string }
    author: { uid: number; nickname: string; avatarUrl: string | null; level: number; profile: { displayName: string | null; avatarUrl: string | null } | null }
  }>
  total: number
  totalPages: number
  page: number
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean }
  permissions: { canCreatePost: boolean; canCreateAnnouncement: boolean }
}
