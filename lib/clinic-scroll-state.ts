export const ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY = 'aspirin-list-scroll-state'

export type AspirinClinicListContext = {
  pathname: string
  page: number
  filter: string
  sort: string
  search: string
  tab: string
}

export type AspirinClinicListScrollState = AspirinClinicListContext & {
  anchorPostId: string
  scrollY: number
  listHref: string
  savedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createAspirinClinicListScrollState(input: AspirinClinicListScrollState) {
  return {
    pathname: input.pathname,
    page: Math.max(1, Math.trunc(input.page) || 1),
    filter: input.filter,
    sort: input.sort,
    search: input.search,
    tab: input.tab,
    anchorPostId: input.anchorPostId,
    scrollY: Math.max(0, Number.isFinite(input.scrollY) ? input.scrollY : 0),
    listHref: input.listHref,
    savedAt: input.savedAt,
  } satisfies AspirinClinicListScrollState
}

export function parseAspirinClinicListScrollState(value: unknown): AspirinClinicListScrollState | null {
  if (!isRecord(value)) return null
  if (typeof value.pathname !== 'string' || typeof value.filter !== 'string' || typeof value.sort !== 'string' || typeof value.search !== 'string' || typeof value.tab !== 'string') return null
  if (typeof value.anchorPostId !== 'string' || typeof value.listHref !== 'string') return null
  if (typeof value.page !== 'number' || !Number.isSafeInteger(value.page) || value.page < 1) return null
  if (typeof value.scrollY !== 'number' || !Number.isFinite(value.scrollY) || value.scrollY < 0) return null
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null
  return {
    pathname: value.pathname,
    page: value.page,
    filter: value.filter,
    sort: value.sort,
    search: value.search,
    tab: value.tab,
    anchorPostId: value.anchorPostId,
    scrollY: value.scrollY,
    listHref: value.listHref,
    savedAt: value.savedAt,
  }
}

export function readAspirinClinicListScrollStateFromHistory(historyState: unknown) {
  if (!isRecord(historyState)) return null
  return parseAspirinClinicListScrollState(historyState[ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY])
}

export function updateAspirinClinicListHistoryState(historyState: unknown, scrollState: AspirinClinicListScrollState | null) {
  const nextState = isRecord(historyState) ? { ...historyState } : {}
  if (scrollState) nextState[ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY] = scrollState
  else delete nextState[ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY]
  return nextState
}

export function matchesAspirinClinicListContext(state: AspirinClinicListScrollState, context: AspirinClinicListContext) {
  return state.pathname === context.pathname
    && state.page === context.page
    && state.filter === context.filter
    && state.sort === context.sort
    && state.search === context.search
    && state.tab === context.tab
}

export function readAspirinClinicListScrollStateFromStorage(storage: Pick<Storage, 'getItem'> | null | undefined) {
  if (!storage) return null
  try {
    return parseAspirinClinicListScrollState(storage.getItem(ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY) || '')
  } catch {
    return null
  }
}

export function writeAspirinClinicListScrollStateToStorage(storage: Pick<Storage, 'setItem'> | null | undefined, state: AspirinClinicListScrollState) {
  if (!storage) return
  try {
    storage.setItem(ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY, JSON.stringify(state))
  } catch {
    // Private browsing or a full storage quota should not block navigation.
  }
}

export function clearAspirinClinicListScrollStateFromStorage(storage: Pick<Storage, 'removeItem'> | null | undefined) {
  if (!storage) return
  try {
    storage.removeItem(ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY)
  } catch {
    // Storage is an optional fallback; history.state remains authoritative.
  }
}

export function getAspirinClinicListSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function appendAspirinClinicListRestoreParam(href: string) {
  const hashIndex = href.indexOf('#')
  const base = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : ''
  return `${base}${base.includes('?') ? '&' : '?'}restore=1${hash}`
}
