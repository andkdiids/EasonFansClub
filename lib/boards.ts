export const DAILY_CHAT_BOARD_SLUG = 'daily-chat'
export const DAILY_CHAT_LEGACY_NAME = '日常吹水'
export const DAILY_CHAT_DISPLAY_NAME = '吹水'
export const BARD_BOARD_SLUG = 'bard'
export const BARD_BOARD_NAME = '吟游诗人'

export type ForumBoardIdentity = Readonly<{ slug?: string | null; name: string }>

export type ForumBoardSummary = Readonly<{
  id: string
  name: string
  slug: string
  description: string | null
  postCount: number
}>

/**
 * Board names are stored as data, so older databases may still contain the
 * legacy daily-chat label until the existing seed/admin flow is run. Keep the
 * slug (and therefore every Post relation and old URL) stable while exposing
 * the new public label everywhere.
 */
export function getForumBoardDisplayName(board: ForumBoardIdentity | null | undefined) {
  if (!board) return ''
  return board.slug === DAILY_CHAT_BOARD_SLUG || board.name === DAILY_CHAT_LEGACY_NAME
    ? DAILY_CHAT_DISPLAY_NAME
    : board.name
}

export function withForumBoardDisplayName<T extends ForumBoardIdentity>(board: T): T {
  return { ...board, name: getForumBoardDisplayName(board) }
}

export function normalizeForumBoards<T extends ForumBoardIdentity>(boards: readonly T[]) {
  return boards.map(withForumBoardDisplayName)
}

/**
 * Keep the public forum navigation backed by one catalog even when an older
 * database has not yet materialized one of the default Board rows. Configured
 * rows are read-only navigation entries; posting still requires the normal
 * database-backed Board relation.
 */
export function appendMissingDefaultForumBoards<T extends ForumBoardIdentity>(boards: readonly T[]) {
  const knownSlugs = new Set(boards.map((board) => board.slug).filter((slug): slug is string => Boolean(slug)))
  return [
    ...boards,
    ...defaultBoards.filter((board) => board.slug === BARD_BOARD_SLUG && !knownSlugs.has(board.slug)),
  ]
}

export function mergeForumBoardSummaries(boards: readonly ForumBoardSummary[]): ForumBoardSummary[] {
  const knownSlugs = new Set(boards.map((board) => board.slug))
  return [
    ...boards,
    ...defaultBoards
      .filter((board) => board.slug === BARD_BOARD_SLUG && !knownSlugs.has(board.slug))
      .map((board) => ({
        id: `configured:${board.slug}`,
        name: board.name,
        slug: board.slug,
        description: board.description,
        postCount: 0,
      })),
  ]
}

export function isConfiguredForumBoardId(id: string) {
  return id.startsWith('configured:')
}

export const defaultBoards = [
  {
    name: '公告区',
    slug: 'announcements',
    description: '官方公告、站务通知、活动规则',
    sortOrder: 1,
  },
  {
    name: DAILY_CHAT_DISPLAY_NAME,
    slug: DAILY_CHAT_BOARD_SLUG,
    description: '日常聊天、打卡闲聊、轻量互动',
    sortOrder: 2,
  },
  {
    name: '演唱会',
    slug: 'concerts',
    description: '巡演、场馆、歌单、repo',
    sortOrder: 3,
  },
  {
    name: '物料交换',
    slug: 'merch-exchange',
    description: '周边、应援物料交换',
    sortOrder: 4,
  },
  {
    name: BARD_BOARD_NAME,
    slug: BARD_BOARD_SLUG,
    description: '专辑、歌曲、演唱会鉴赏与音乐长评',
    sortOrder: 5,
  },
]
