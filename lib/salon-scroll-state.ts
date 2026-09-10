import type { SalonCategoryCounts, SalonFeedMode, SalonPostView } from '@/lib/salon-shared'

export const SALON_LIST_SCROLL_STATE_KEY = 'salon-list-scroll-state'

const INTERNAL_ORIGIN = 'https://ecfc.internal'

export type SalonListScrollContext = {
  pathname: string
  listHref: string
  category: string
  concert: string
  session: string
  sort: string
}

export type SalonListScrollState = SalonListScrollContext & {
  posts: SalonPostView[]
  hasMore: boolean
  nextCursor: string | null
  feedMode: SalonFeedMode
  feedSeed: string | null
  categoryCounts: SalonCategoryCounts
  anchorPostId: string
  scrollY: number
  savedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSalonFeedMode(value: unknown): value is SalonFeedMode {
  return value === 'latest' || value === 'popular' || value === 'recommend'
}

function isCategoryCounts(value: unknown): value is SalonCategoryCounts {
  if (!isRecord(value)) return false
  return ['all', 'CONCERT', 'MOBILE_WALLPAPER', 'DESKTOP_WALLPAPER', 'TIME_TRAVEL'].every((key) => {
    const count = value[key]
    return typeof count === 'number' && Number.isFinite(count) && count >= 0
  })
}

function isSalonPosts(value: unknown): value is SalonPostView[] {
  return Array.isArray(value) && value.every((post) => isRecord(post) && typeof post.id === 'string' && post.id.length > 0)
}

export function normalizeSalonReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//') || /[\u0000-\u001f\u007f]/u.test(trimmed)) return null

  try {
    const url = new URL(trimmed, INTERNAL_ORIGIN)
    if (url.origin !== INTERNAL_ORIGIN || url.pathname !== '/salon') return null
    return `${url.pathname}${url.search}${url.hash}` || '/salon'
  } catch {
    return null
  }
}

export function appendSalonListRestoreParam(href: string) {
  const hashIndex = href.indexOf('#')
  const base = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : ''
  return `${base}${base.includes('?') ? '&' : '?'}restore=1${hash}`
}

export function createSalonListScrollState(input: SalonListScrollState): SalonListScrollState {
  return {
    pathname: input.pathname,
    listHref: input.listHref,
    category: input.category,
    concert: input.concert,
    session: input.session,
    sort: input.sort,
    posts: input.posts,
    hasMore: input.hasMore === true,
    nextCursor: typeof input.nextCursor === 'string' && input.nextCursor ? input.nextCursor : null,
    feedMode: input.feedMode,
    feedSeed: typeof input.feedSeed === 'string' && input.feedSeed ? input.feedSeed : null,
    categoryCounts: input.categoryCounts,
    anchorPostId: input.anchorPostId,
    scrollY: Math.max(0, Number.isFinite(input.scrollY) ? input.scrollY : 0),
    savedAt: input.savedAt,
  }
}

export function parseSalonListScrollState(value: unknown): SalonListScrollState | null {
  if (!isRecord(value)) return null
  if (typeof value.pathname !== 'string' || typeof value.listHref !== 'string') return null
  if (typeof value.category !== 'string' || typeof value.concert !== 'string' || typeof value.session !== 'string' || typeof value.sort !== 'string') return null
  if (!isSalonPosts(value.posts) || !isSalonFeedMode(value.feedMode) || !isCategoryCounts(value.categoryCounts)) return null
  if (typeof value.hasMore !== 'boolean' || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) return null
  if (value.feedSeed !== null && typeof value.feedSeed !== 'string') return null
  if (typeof value.anchorPostId !== 'string' || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null
  if (typeof value.scrollY !== 'number' || !Number.isFinite(value.scrollY) || value.scrollY < 0) return null
  return createSalonListScrollState({
    pathname: value.pathname,
    listHref: value.listHref,
    category: value.category,
    concert: value.concert,
    session: value.session,
    sort: value.sort,
    posts: value.posts,
    hasMore: value.hasMore,
    nextCursor: value.nextCursor,
    feedMode: value.feedMode,
    feedSeed: value.feedSeed,
    categoryCounts: value.categoryCounts,
    anchorPostId: value.anchorPostId,
    scrollY: value.scrollY,
    savedAt: value.savedAt,
  })
}

export function readSalonListScrollStateFromHistory(historyState: unknown) {
  if (!isRecord(historyState)) return null
  return parseSalonListScrollState(historyState[SALON_LIST_SCROLL_STATE_KEY])
}

export function updateSalonListHistoryState(historyState: unknown, scrollState: SalonListScrollState | null) {
  const nextState = isRecord(historyState) ? { ...historyState } : {}
  if (scrollState) nextState[SALON_LIST_SCROLL_STATE_KEY] = scrollState
  else delete nextState[SALON_LIST_SCROLL_STATE_KEY]
  return nextState
}

export function matchesSalonListContext(state: SalonListScrollState, context: SalonListScrollContext) {
  return state.pathname === context.pathname
    && state.listHref === context.listHref
    && state.category === context.category
    && state.concert === context.concert
    && state.session === context.session
    && state.sort === context.sort
}

export function readSalonListScrollStateFromStorage(storage: Pick<Storage, 'getItem'> | null | undefined) {
  if (!storage) return null
  try {
    const raw = storage.getItem(SALON_LIST_SCROLL_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parseSalonListScrollState(parsed)
  } catch {
    return null
  }
}

export function writeSalonListScrollStateToStorage(storage: Pick<Storage, 'setItem'> | null | undefined, state: SalonListScrollState) {
  if (!storage) return
  try {
    storage.setItem(SALON_LIST_SCROLL_STATE_KEY, JSON.stringify(state))
  } catch {
    // Private browsing or a full storage quota should not block navigation.
  }
}

export function clearSalonListScrollStateFromStorage(storage: Pick<Storage, 'removeItem'> | null | undefined) {
  if (!storage) return
  try {
    storage.removeItem(SALON_LIST_SCROLL_STATE_KEY)
  } catch {
    // Storage is an optional fallback; history.state remains authoritative.
  }
}

export function getSalonListSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
