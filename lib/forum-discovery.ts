export const FORUM_DISCOVERY_PAGE_SIZE = 12
export const FORUM_DISCOVERY_MIN_PAGE_SIZE = 8
export const FORUM_DISCOVERY_MAX_PAGE_SIZE = 20
export const FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT = 60

export type ForumDiscoveryMode = 'recommend' | 'latest' | 'hot'
export type ForumTheme = 'plaza' | 'xiaochenshu'

export type ForumDiscoveryTab = { value: string; label: string }

export function buildForumDiscoveryTabs(boards: ReadonlyArray<{ slug: string; name: string; isAnnouncement?: boolean }>): ForumDiscoveryTab[] {
  const announcement = boards.find((board) => board.isAnnouncement || board.slug === 'announcements')
  const otherBoards = boards.filter((board) => board !== announcement)
  return [
    { value: 'all', label: '全部' },
    { value: announcement?.slug || 'announcements', label: '公告区' },
    { value: 'recommend', label: '推荐' },
    { value: 'latest', label: '最新' },
    { value: 'hot', label: '热门' },
    ...otherBoards.map((board) => ({ value: board.slug, label: board.name })),
  ]
}

export function parseForumDiscoveryMode(value: unknown): ForumDiscoveryMode | null {
  if (value === undefined) return 'recommend'
  return value === 'recommend' || value === 'latest' || value === 'hot' ? value : null
}

export function parseForumDiscoveryLimit(value: unknown) {
  if (value === undefined) return FORUM_DISCOVERY_PAGE_SIZE
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < FORUM_DISCOVERY_MIN_PAGE_SIZE || value > FORUM_DISCOVERY_MAX_PAGE_SIZE) return null
  return value
}

export type ForumDiscoveryCover = {
  url: string
  width: number | null
  height: number | null
}
export type ForumDiscoveryPost = {
  id: string
  title: string
  ipRegion: string | null
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
  feedSeed: string | null
  hasMore: boolean
  permissions: { canCreatePost: boolean; canCreateAnnouncement: boolean }
  mode: ForumDiscoveryMode
}

export function normalizeDiscoveryIds(values: unknown, max = 500) {
  if (!Array.isArray(values)) return []
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 80)
    .slice(0, max))]
}

export function mergeRecentRecommendedPostIds(
  current: ReadonlyArray<string> = [],
  incoming: ReadonlyArray<string> = [],
  max = FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT,
) {
  return [...new Set([...incoming, ...current])]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .slice(0, max)
}

export function stableRecommendationWeight(feedSeed: string, postId: string) {
  let hash = 2166136261
  const value = `${feedSeed}:${postId}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4_294_967_296
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
  excludedPostIds: ReadonlySet<string> = new Set(),
) {
  const nextPosts = new Set(seenPostIds)
  const nextAuthors = new Set(seenAuthorIds)
  const selected: T[] = []
  for (const row of rows) {
    if (nextPosts.has(row.id) || excludedPostIds.has(row.id) || nextAuthors.has(row.author.id)) continue
    selected.push(row)
    nextPosts.add(row.id)
    nextAuthors.add(row.author.id)
    if (selected.length >= limit) break
  }
  return { rows: selected, seenPostIds: nextPosts, seenAuthorIds: nextAuthors }
}
