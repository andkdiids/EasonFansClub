export const forumSortValues = ['latest', 'latest-reply', 'featured', 'pinned', 'most-replies'] as const
export type ForumSort = typeof forumSortValues[number]

export function parseForumSort(value: string | null): ForumSort {
  return forumSortValues.includes(value as ForumSort) ? value as ForumSort : 'latest'
}

export function excerptForumPost(value: string | null | undefined, length = 180) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length)}…` : text
}

export type ForumFeedResponse = {
  boards: Array<{ id: string; name: string; slug: string; description: string | null; postCount: number; isAnnouncement: boolean }>
  selectedBoard: { id: string; name: string; slug: string; description: string | null; isAnnouncement: boolean } | null
  posts: Array<{
    id: string
    title: string
    content: string
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
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean }
  permissions: { canCreatePost: boolean; canCreateAnnouncement: boolean }
}
