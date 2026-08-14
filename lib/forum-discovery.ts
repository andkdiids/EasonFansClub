export const FORUM_DISCOVERY_PAGE_SIZE = 12

export type ForumDiscoveryMode = 'recommend' | 'latest'
export type ForumTheme = 'plaza' | 'xiaochenshu'

export type ForumDiscoveryCover = {
  url: string
  width: number | null
  height: number | null
}
export type ForumDiscoveryPost = {
  id: string
  title: string
  likeCount: number
  favoriteCount: number
  replyCount: number
  isPinned: boolean
  isFeatured: boolean
  createdAt: string
  updatedAt: string
  likedByMe: boolean
  favoritedByMe: boolean
  board: { name: string; slug: string }
  author: {
    id: string
    uid: number
    nickname: string
    displayName: string
    avatarUrl: string | null
    level: number
  }
  cover: ForumDiscoveryCover | null
}

export type ForumDiscoveryResponse = {
  posts: ForumDiscoveryPost[]
  boards: Array<{
    id: string
    name: string
    slug: string
    description: string | null
    postCount: number
    isAnnouncement: boolean
  }>
  selectedBoard: { id: string; name: string; slug: string; isAnnouncement: boolean } | null
  nextCursor: string | null
  hasMore: boolean
  permissions: { canCreatePost: boolean; canCreateAnnouncement: boolean }
  mode: ForumDiscoveryMode
}

export function normalizeDiscoveryIds(values: unknown, max = 500) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, max))]
}

/**
 * The list is always a 4:3 box. Tall images are cropped, while images that
 * are materially wider than 4:3 are contained so the original is not cut.
 */
export function getForumDiscoveryCoverFit(width: number | null | undefined, height: number | null | undefined): 'cover' | 'contain' {
  if (!width || !height || width <= 0 || height <= 0) return 'cover'
  return width / height > 1.45 ? 'contain' : 'cover'
}

export function selectRecommendationRows<T extends { id: string; author: { id: string } }>(
  rows: readonly T[],
  seenPostIds: ReadonlySet<string> = new Set(),
  seenAuthorIds: ReadonlySet<string> = new Set(),
  limit = FORUM_DISCOVERY_PAGE_SIZE,
) {
  const nextPosts = new Set(seenPostIds)
  const nextAuthors = new Set(seenAuthorIds)
  const selected: T[] = []
  for (const row of rows) {
    if (nextPosts.has(row.id) || nextAuthors.has(row.author.id)) continue
    selected.push(row)
    nextPosts.add(row.id)
    nextAuthors.add(row.author.id)
    if (selected.length >= limit) break
  }
  return { rows: selected, seenPostIds: nextPosts, seenAuthorIds: nextAuthors }
}
