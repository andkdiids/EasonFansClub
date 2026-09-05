'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ForumDiscoveryCard } from '@/components/ForumDiscoveryCard'
import { ForumFishModePostRow, type FishModeOpenOptions } from '@/components/ForumFishModePostRow'
import { ForumFishModePreview } from '@/components/ForumFishModePreview'
import { useIsDesktopMediaQuery } from '@/lib/use-desktop-media-query'
import {
  buildForumDiscoveryTabs,
  appendUniqueDiscoveryPosts,
  FORUM_DISCOVERY_PAGE_SIZE,
  FORUM_FISH_MINIMAL_STORAGE_KEY,
  FORUM_PRESENTATION_MODE_STORAGE_KEY,
  FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT,
  mergeRecentRecommendedPostIds,
  type ForumDiscoveryMode,
  type ForumDiscoveryPost,
  type ForumDiscoveryResponse,
  parseForumPresentationMode,
  type ForumPresentationMode,
} from '@/lib/forum-discovery'

type DiscoverySession = {
  posts: ForumDiscoveryPost[]
  boards: ForumDiscoveryResponse['boards']
  permissions: ForumDiscoveryResponse['permissions']
  hasMore: boolean
  nextCursor: string | null
  feedSeed?: string | null
  seenPostIds: string[]
  seenAuthorIds: string[]
  recentRecommendedPostIds?: string[]
  scrollY: number
  savedAt?: number
}

const DISCOVERY_SESSION_MAX_AGE_MS = 30 * 60_000
const DISCOVERY_RECENT_STORAGE_KEY = 'forum-discovery-recent-recommendations'

type DiscoveryRequest = {
  key: string
  controller: AbortController
  promise: Promise<void>
}

function readSession(key: string) {
  try {
    const value = window.sessionStorage.getItem(key)
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<DiscoverySession>
    if (!Array.isArray(parsed.posts) || !Array.isArray(parsed.boards)) return null
    return parsed as DiscoverySession
  } catch {
    return null
  }
}

function readRecentRecommendedPostIds() {
  try {
    const raw = window.sessionStorage.getItem(DISCOVERY_RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT)
      : []
  } catch {
    return []
  }
}

function writeRecentRecommendedPostIds(values: ReadonlyArray<string>) {
  try {
    window.sessionStorage.setItem(DISCOVERY_RECENT_STORAGE_KEY, JSON.stringify(values))
  } catch {
    // Recent recommendation history is only an enhancement; the feed remains usable without storage.
  }
}

const DISCOVERY_SKELETON_KEYS = ['one', 'two', 'three', 'four', 'five', 'six'] as const

function readFishPreviewId(hash: string) {
  const prefix = '#fish-post='
  if (!hash.startsWith(prefix)) return null
  try {
    const value = decodeURIComponent(hash.slice(prefix.length)).trim()
    return value || null
  } catch {
    return null
  }
}

function currentUrlWithoutFishPreview() {
  const url = new URL(window.location.href)
  url.hash = ''
  return `${url.pathname}${url.search}`
}

export function ForumDiscoveryHome({ showDesktopRefresh = false }: Readonly<{ showDesktopRefresh?: boolean }>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isDesktop = useIsDesktopMediaQuery()
  const queryString = searchParams.toString()
  const boardValue = searchParams.get('board') || ''
  const query = searchParams.get('query') || ''
  const activeBoard = boardValue && boardValue !== 'all' ? boardValue : ''
  const requestedSort = searchParams.get('sort')
  const mode: ForumDiscoveryMode = !boardValue && !query
    ? requestedSort === 'hot' ? 'hot' : requestedSort === 'latest' ? 'latest' : 'recommend'
    : 'latest'
  const sessionKey = `forum-discovery-session:${pathname}${queryString ? `?${queryString}` : ''}`
  const [searchValue, setSearchValue] = useState(query)
  const [posts, setPosts] = useState<ForumDiscoveryPost[]>([])
  const [boards, setBoards] = useState<ForumDiscoveryResponse['boards']>([])
  const [permissions, setPermissions] = useState<ForumDiscoveryResponse['permissions']>({ canCreatePost: false, canCreateAnnouncement: false })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showBackTop, setShowBackTop] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [restoreScrollY, setRestoreScrollY] = useState<number | null>(null)
  const [presentationPreference, setPresentationPreference] = useState<ForumPresentationMode>('xiaochenshu')
  const [minimalMode, setMinimalMode] = useState(false)
  const [fishActivePostId, setFishActivePostId] = useState<string | null>(null)
  const [fishPreviewPostId, setFishPreviewPostId] = useState<string | null>(null)
  const [fishPreviewFocusComments, setFishPreviewFocusComments] = useState(false)
  const seenPostIdsRef = useRef(new Set<string>())
  const seenAuthorIdsRef = useRef(new Set<string>())
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const postsRef = useRef<ForumDiscoveryPost[]>([])
  const nextCursorRef = useRef<string | null>(null)
  const feedSeedRef = useRef<string | null>(null)
  const recentRecommendedPostIdsRef = useRef<string[]>([])
  const requestSequence = useRef(0)
  const requestRef = useRef<DiscoveryRequest | null>(null)
  const refreshingRef = useRef(false)
  const autoLoadBlockedRef = useRef(false)
  const initializedSessionKeyRef = useRef('')
  const sentinelRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<number | null>(null)
  const pullDistanceRef = useRef(0)
  const fishPreviewHistoryRef = useRef(false)
  const initializedFishHashRef = useRef(false)
  const previousDiscoveryQueryStringRef = useRef(queryString)

  const activeTab = query ? '' : boardValue || mode
  const createHref = activeBoard ? `/posts/new?board=${encodeURIComponent(activeBoard)}` : '/posts/new'
  const presentationMode: ForumPresentationMode = isDesktop && presentationPreference === 'fish' ? 'fish' : 'xiaochenshu'

  const persistSession = useCallback((session: DiscoverySession) => {
    try {
      window.sessionStorage.setItem(sessionKey, JSON.stringify(session))
    } catch {
      // Feed restoration is best effort; browsing remains usable when storage is disabled.
    }
  }, [sessionKey])

  const openFishPreview = useCallback((postId: string, options?: FishModeOpenOptions) => {
    if (!isDesktop || presentationMode !== 'fish') return
    const url = new URL(window.location.href)
    url.hash = `fish-post=${encodeURIComponent(postId)}`
    setFishActivePostId(postId)
    setFishPreviewPostId(postId)
    setFishPreviewFocusComments(Boolean(options?.focusComments))
    if (fishPreviewPostId) {
      window.history.replaceState({ ...window.history.state, fishPreviewPostId: postId }, '', `${url.pathname}${url.search}${url.hash}`)
    } else {
      fishPreviewHistoryRef.current = true
      window.history.pushState({ ...window.history.state, fishPreviewPostId: postId }, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [fishPreviewPostId, isDesktop, presentationMode])

  const closeFishPreview = useCallback(() => {
    if (!fishPreviewPostId) return
    setFishPreviewPostId(null)
    setFishPreviewFocusComments(false)
    if (fishPreviewHistoryRef.current) {
      fishPreviewHistoryRef.current = false
      window.history.back()
      return
    }
    window.history.replaceState(window.history.state, '', currentUrlWithoutFishPreview())
  }, [fishPreviewPostId])

  const loadPage = useCallback(async (reset: boolean, manual = false) => {
    if (!reset && autoLoadBlockedRef.current && !manual) return
    if (!reset && requestRef.current) return requestRef.current.promise

    const requestCursor = reset ? null : nextCursorRef.current
    const requestFeedSeed = reset ? null : feedSeedRef.current
    const requestRecentRecommendedPostIds = reset && mode === 'recommend' ? [...recentRecommendedPostIdsRef.current] : []
    const requestKey = `${sessionKey}:${reset ? 'reset' : `more:${requestCursor || 'start'}`}`
    if (!reset && requestRef.current?.key === requestKey) return requestRef.current.promise
    requestRef.current?.controller.abort()
    if (reset || manual) autoLoadBlockedRef.current = false

    if (reset) {
      loadingMoreRef.current = false
      hasMoreRef.current = true
      seenPostIdsRef.current = new Set()
      seenAuthorIdsRef.current = new Set()
      nextCursorRef.current = null
      feedSeedRef.current = null
      setNextCursor(null)
      setHasMore(true)
      setLoading(true)
      setLoadingMore(false)
    } else {
      if (!hasMoreRef.current || loadingMoreRef.current) return
      loadingMoreRef.current = true
      setLoadingMore(true)
    }

    const sequence = ++requestSequence.current
    const controller = new AbortController()
    setError('')
    const request = (async () => {
      try {
        const response = await fetch('/api/forum/discover', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          board: boardValue || null,
          query,
          limit: FORUM_DISCOVERY_PAGE_SIZE,
          cursor: requestCursor,
          feedSeed: requestFeedSeed,
          seenPostIds: reset ? [] : [...seenPostIdsRef.current],
          seenAuthorIds: reset ? [] : [...seenAuthorIdsRef.current],
          recentRecommendedPostIds: requestRecentRecommendedPostIds,
        }),
        })
        const payload = await response.json().catch(() => null) as ForumDiscoveryResponse | { message?: string } | null
        if (!response.ok || !payload || !('posts' in payload)) throw new Error(payload && 'message' in payload ? payload.message : '内容加载失败')
        if (sequence !== requestSequence.current) return

        const incoming = appendUniqueDiscoveryPosts([], payload.posts, true)
        const currentPosts = postsRef.current
        const newIncoming = reset
          ? incoming
          : incoming.filter((post) => !currentPosts.some((current) => current.id === post.id))
        if (!reset && payload.hasMore && (newIncoming.length === 0 || payload.nextCursor === requestCursor)) {
          autoLoadBlockedRef.current = true
          setError('加载更多没有返回新内容，请重试')
          return
        }
        const merged = appendUniqueDiscoveryPosts(currentPosts, incoming, reset)
        const nextSeenPostIds = reset ? new Set<string>() : new Set(seenPostIdsRef.current)
        const nextSeenAuthorIds = reset ? new Set<string>() : new Set(seenAuthorIdsRef.current)
        incoming.forEach((post) => {
          nextSeenPostIds.add(post.id)
          if (mode === 'recommend') nextSeenAuthorIds.add(post.author.id)
        })
        postsRef.current = merged
        nextCursorRef.current = payload.nextCursor
        feedSeedRef.current = payload.feedSeed
        seenPostIdsRef.current = nextSeenPostIds
        seenAuthorIdsRef.current = nextSeenAuthorIds
        const nextRecentRecommendedPostIds = mode === 'recommend'
          ? mergeRecentRecommendedPostIds(recentRecommendedPostIdsRef.current, incoming.map((post) => post.id))
          : recentRecommendedPostIdsRef.current
        recentRecommendedPostIdsRef.current = nextRecentRecommendedPostIds
        if (mode === 'recommend') writeRecentRecommendedPostIds(nextRecentRecommendedPostIds)
        hasMoreRef.current = payload.hasMore
        setPosts(merged)
        setBoards(payload.boards)
        setPermissions(payload.permissions)
        setNextCursor(payload.nextCursor)
        setHasMore(payload.hasMore)
        persistSession({
          posts: merged,
          boards: payload.boards,
          permissions: payload.permissions,
          hasMore: payload.hasMore,
          nextCursor: payload.nextCursor,
          feedSeed: payload.feedSeed,
          seenPostIds: [...nextSeenPostIds],
          seenAuthorIds: [...nextSeenAuthorIds],
          recentRecommendedPostIds: nextRecentRecommendedPostIds,
          scrollY: window.scrollY,
          savedAt: Date.now(),
        })
      } catch (reason) {
        if (controller.signal.aborted) return
        if (sequence === requestSequence.current) {
          autoLoadBlockedRef.current = true
          setError(reason instanceof Error ? reason.message : '内容加载失败')
        }
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false)
          setLoadingMore(false)
          loadingMoreRef.current = false
        }
      }
    })()
    requestRef.current = { key: requestKey, controller, promise: request }
    void request.then(() => {
      if (requestRef.current?.promise === request) requestRef.current = null
    }, () => {
      if (requestRef.current?.promise === request) requestRef.current = null
    })
    return request
  }, [boardValue, mode, persistSession, query, sessionKey])

  useEffect(() => setSearchValue(query), [query])

  useEffect(() => {
    try {
      setPresentationPreference(parseForumPresentationMode(window.localStorage.getItem(FORUM_PRESENTATION_MODE_STORAGE_KEY)))
      setMinimalMode(window.localStorage.getItem(FORUM_FISH_MINIMAL_STORAGE_KEY) === 'true')
    } catch {
      // Presentation preferences are optional; the default view remains usable without storage.
    }
  }, [])

  useEffect(() => {
    if (!isDesktop || presentationMode !== 'fish') {
      initializedFishHashRef.current = false
      setFishActivePostId(null)
      setFishPreviewPostId(null)
      setFishPreviewFocusComments(false)
      if (readFishPreviewId(window.location.hash)) {
        fishPreviewHistoryRef.current = false
        window.history.replaceState(window.history.state, '', currentUrlWithoutFishPreview())
      }
      return
    }
    const syncFromHash = () => {
      const postId = readFishPreviewId(window.location.hash)
      if (!postId) {
        fishPreviewHistoryRef.current = false
        setFishPreviewPostId(null)
        setFishPreviewFocusComments(false)
      } else if (postsRef.current.length && postsRef.current.some((post) => post.id === postId)) {
        fishPreviewHistoryRef.current = false
        setFishActivePostId(postId)
        setFishPreviewPostId(postId)
        setFishPreviewFocusComments(false)
      }
    }
    window.addEventListener('popstate', syncFromHash)
    syncFromHash()
    return () => window.removeEventListener('popstate', syncFromHash)
  }, [isDesktop, presentationMode])

  useEffect(() => {
    if (!isDesktop || presentationMode !== 'fish' || !posts.length || initializedFishHashRef.current) return
    initializedFishHashRef.current = true
    const postId = readFishPreviewId(window.location.hash)
    if (postId && posts.some((post) => post.id === postId)) {
      fishPreviewHistoryRef.current = false
      setFishActivePostId(postId)
      setFishPreviewPostId(postId)
    }
  }, [isDesktop, posts, presentationMode])

  useEffect(() => {
    if (!isDesktop || presentationMode !== 'fish' || !fishActivePostId) return
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-fish-mode-post-row]')).find((item) => item.dataset.postId === fishActivePostId)
    row?.scrollIntoView({ block: 'nearest' })
  }, [fishActivePostId, isDesktop, presentationMode])

  useEffect(() => {
    if (!isDesktop || presentationMode !== 'fish') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase()
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable || target.closest('[contenteditable="true"]')) return
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

      if (event.key === 'Escape') {
        if (!fishPreviewPostId) return
        event.preventDefault()
        closeFishPreview()
        return
      }
      if (!posts.length) return

      const key = event.key.toLowerCase()
      const currentIndex = posts.findIndex((post) => post.id === fishActivePostId)
      if (key === 'j' || key === 'k') {
        const startIndex = currentIndex >= 0 ? currentIndex : key === 'j' ? -1 : 1
        const nextIndex = key === 'j' ? startIndex + 1 : startIndex - 1
        const nextPost = posts[nextIndex]
        if (!nextPost) return
        event.preventDefault()
        setFishActivePostId(nextPost.id)
        if (fishPreviewPostId) openFishPreview(nextPost.id)
        return
      }
      if (event.key === 'Enter') {
        const currentPost = posts[currentIndex >= 0 ? currentIndex : 0]
        if (!currentPost) return
        event.preventDefault()
        openFishPreview(currentPost.id)
        return
      }
      if (key === 'l') {
        const currentPost = posts[currentIndex >= 0 ? currentIndex : 0]
        if (!currentPost) return
        const row = Array.from(document.querySelectorAll<HTMLElement>('[data-fish-mode-post-row]')).find((item) => item.dataset.postId === currentPost.id)
        const likeButton = row?.querySelector<HTMLButtonElement>('.fish-mode-like-button')
        if (!likeButton) return
        event.preventDefault()
        likeButton.click()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeFishPreview, fishActivePostId, fishPreviewPostId, isDesktop, openFishPreview, posts, presentationMode])

  useEffect(() => {
    if (previousDiscoveryQueryStringRef.current === queryString) return
    previousDiscoveryQueryStringRef.current = queryString
    setFishActivePostId(null)
    setFishPreviewPostId(null)
    setFishPreviewFocusComments(false)
    fishPreviewHistoryRef.current = false
    if (readFishPreviewId(window.location.hash)) window.history.replaceState(window.history.state, '', currentUrlWithoutFishPreview())
  }, [queryString])

  useEffect(() => {
    const syncPostInteraction = (event: Event) => {
      const detail = (event as CustomEvent<{
        postId?: string
        isLiked?: boolean
        likeCount?: number
        isFavorited?: boolean
        favoriteCount?: number
      }>).detail
      if (!detail?.postId) return
      setPosts((current) => {
        let changed = false
        const next = current.map((post) => {
          if (post.id !== detail.postId) return post
          changed = true
          return {
            ...post,
            ...(typeof detail.isLiked === 'boolean' ? { likedByMe: detail.isLiked } : {}),
            ...(typeof detail.likeCount === 'number' ? { likeCount: Math.max(detail.likeCount, 0) } : {}),
            ...(typeof detail.isFavorited === 'boolean' ? { favoritedByMe: detail.isFavorited } : {}),
            ...(typeof detail.favoriteCount === 'number' ? { favoriteCount: Math.max(detail.favoriteCount, 0) } : {}),
          }
        })
        if (changed) postsRef.current = next
        return changed ? next : current
      })
    }
    window.addEventListener('ecfc:post-interaction', syncPostInteraction)
    return () => window.removeEventListener('ecfc:post-interaction', syncPostInteraction)
  }, [])

  useEffect(() => {
    const syncReplyCount = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string; count?: number }>).detail
      if (!detail?.postId || typeof detail.count !== 'number') return
      const count = Math.max(detail.count, 0)
      setPosts((current) => {
        const next = current.map((post) => post.id === detail.postId
          ? { ...post, replyCount: count }
          : post)
        if (next.some((post, index) => post !== current[index])) postsRef.current = next
        return next
      })
    }
    window.addEventListener('ecfc:post-reply-count', syncReplyCount)
    return () => window.removeEventListener('ecfc:post-reply-count', syncReplyCount)
  }, [])

  useEffect(() => {
    if (initializedSessionKeyRef.current === sessionKey) return
    initializedSessionKeyRef.current = sessionKey
    const cleanupRequest = () => {
      if (initializedSessionKeyRef.current === sessionKey) initializedSessionKeyRef.current = ''
      requestSequence.current += 1
      const request = requestRef.current
      request?.controller.abort()
      if (requestRef.current === request) requestRef.current = null
    }
    const stored = readSession(sessionKey)
    recentRecommendedPostIdsRef.current = mergeRecentRecommendedPostIds(
      stored?.recentRecommendedPostIds || [],
      readRecentRecommendedPostIds(),
    )
    const storedAge = stored && typeof stored.savedAt === 'number' ? Date.now() - stored.savedAt : Number.POSITIVE_INFINITY
    const canRestoreStoredFeed = stored
      && stored.posts.length > 0
      && storedAge >= 0
      && storedAge <= DISCOVERY_SESSION_MAX_AGE_MS
      && (mode !== 'recommend' || typeof stored.feedSeed === 'string')
    if (canRestoreStoredFeed) {
      setPosts(stored.posts)
      setBoards(stored.boards)
      setPermissions(stored.permissions)
      setNextCursor(stored.nextCursor)
      setHasMore(stored.hasMore)
      postsRef.current = stored.posts
      nextCursorRef.current = stored.nextCursor
      feedSeedRef.current = stored.feedSeed || null
      hasMoreRef.current = stored.hasMore
      seenPostIdsRef.current = new Set(stored.seenPostIds || stored.posts.map((post) => post.id))
      seenAuthorIdsRef.current = new Set(stored.seenAuthorIds || stored.posts.map((post) => post.author.id))
      recentRecommendedPostIdsRef.current = mergeRecentRecommendedPostIds(
        stored.recentRecommendedPostIds || [],
        recentRecommendedPostIdsRef.current,
      )
      setRestoreScrollY(Number.isFinite(stored.scrollY) ? Math.max(0, stored.scrollY) : null)
      setLoading(false)
      return cleanupRequest
    }
    void loadPage(true)
    return cleanupRequest
  }, [loadPage, mode, sessionKey])

  useEffect(() => {
    if (restoreScrollY === null || !posts.length || loading) return
    let frame = 0
    const restore = () => {
      frame += 1
      if (document.documentElement.scrollHeight < restoreScrollY + window.innerHeight && frame < 8) {
        window.requestAnimationFrame(restore)
        return
      }
      window.scrollTo({ top: restoreScrollY, behavior: 'auto' })
      setRestoreScrollY(null)
    }
    window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [loading, posts.length, restoreScrollY])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => {
      const entered = entries.some((entry) => entry.isIntersecting)
      if (!entered) autoLoadBlockedRef.current = false
      if (entered) void loadPage(false)
    }, { rootMargin: '420px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadPage, loadingMore])

  useEffect(() => {
    if (loading || loadingMore || !hasMore || error || autoLoadBlockedRef.current) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const distanceToViewport = sentinel.getBoundingClientRect().top - window.innerHeight
    if (distanceToViewport <= 420) void loadPage(false)
  }, [error, hasMore, loading, loadingMore, loadPage, posts.length])

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setShowBackTop(window.scrollY > 560)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const refresh = useCallback(async (scrollToTop = false) => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshing(true)
    setPullDistance(0)
    pullDistanceRef.current = 0
    try {
      await loadPage(true, true)
      if (scrollToTop) window.scrollTo({ top: 0, behavior: 'auto' })
    } finally {
      refreshingRef.current = false
      setIsRefreshing(false)
    }
  }, [loadPage])

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      touchStartRef.current = window.scrollY <= 0 ? event.touches[0]?.clientY ?? null : null
    }
    const onTouchMove = (event: TouchEvent) => {
      if (touchStartRef.current === null || window.scrollY > 0) return
      const distance = Math.max(0, Math.min(96, (event.touches[0]?.clientY || 0) - touchStartRef.current))
      pullDistanceRef.current = distance
      setPullDistance(distance)
      if (distance > 8) event.preventDefault()
    }
    const onTouchEnd = () => {
      touchStartRef.current = null
      if (pullDistanceRef.current >= 64) refresh()
      else {
        pullDistanceRef.current = 0
        setPullDistance(0)
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [refresh])

  function updateTab(value: string) {
    const next = new URLSearchParams(queryString)
    next.delete('sort')
    next.delete('page')
    next.delete('query')
    if (value === 'recommend') next.delete('board')
    else if (value === 'latest' || value === 'hot') {
      next.delete('board')
      next.set('sort', value)
    }
    else next.set('board', value)
    router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: true })
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams(queryString)
    next.delete('page')
    const normalized = searchValue.trim()
    if (normalized) next.set('query', normalized)
    else next.delete('query')
    router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: true })
  }

  function updatePresentationMode(next: ForumPresentationMode) {
    setPresentationPreference(next)
    try {
      window.localStorage.setItem(FORUM_PRESENTATION_MODE_STORAGE_KEY, next)
    } catch {
      // The mode still applies for this render when localStorage is unavailable.
    }
    if (next !== 'fish') closeFishPreview()
  }

  function updateMinimalMode(next: boolean) {
    setMinimalMode(next)
    try {
      window.localStorage.setItem(FORUM_FISH_MINIMAL_STORAGE_KEY, String(next))
    } catch {
      // Minimal mode is a presentation preference and does not affect feed data.
    }
  }

  function openPost(postId: string) {
    persistSession({
      posts,
      boards,
      permissions,
      hasMore,
      nextCursor,
      feedSeed: feedSeedRef.current,
      seenPostIds: [...seenPostIdsRef.current],
      seenAuthorIds: [...seenAuthorIdsRef.current],
      recentRecommendedPostIds: recentRecommendedPostIdsRef.current,
      scrollY: window.scrollY,
      savedAt: Date.now(),
    })
    router.push(`/posts/${postId}`, { scroll: false })
  }

  const tabItems = useMemo(() => buildForumDiscoveryTabs(boards), [boards])
  const fishPreviewPost = fishPreviewPostId ? posts.find((post) => post.id === fishPreviewPostId) || null : null
  const fishPreviewIndex = fishPreviewPost ? posts.findIndex((post) => post.id === fishPreviewPost.id) : -1

  return (
    <section className="forum-discovery-page" data-forum-discovery data-forum-presentation={presentationMode} data-forum-minimal={minimalMode ? 'true' : 'false'}>
      <div className="forum-discovery-pull-indicator" style={{ height: pullDistance ? `${pullDistance}px` : undefined }} aria-live="polite">
        {pullDistance >= 64 ? '松开刷新' : pullDistance > 8 ? '下拉刷新' : ''}
      </div>
      <header className="forum-discovery-header">
        <div className="forum-discovery-content">
          <div className="forum-discovery-header-row">
            <div className="forum-discovery-title-group">
              <h1>小臣书</h1>
              <div className="forum-presentation-switcher" role="group" aria-label="广场展示模式">
                <button type="button" aria-pressed={presentationMode === 'xiaochenshu'} onClick={() => updatePresentationMode('xiaochenshu')}>小臣书</button>
                <span aria-hidden="true">｜</span>
                <button type="button" aria-pressed={presentationMode === 'fish'} onClick={() => updatePresentationMode('fish')}>摸鱼模式</button>
              </div>
            </div>
            <div className="forum-discovery-header-actions">
              {showDesktopRefresh && mode === 'recommend' ? (
                <button
                  type="button"
                  className={`forum-discovery-refresh-button${isRefreshing ? ' is-refreshing' : ''}`}
                  onClick={() => void refresh(true)}
                  disabled={isRefreshing}
                  aria-busy={isRefreshing}
                  aria-label={isRefreshing ? '正在刷新推荐' : '刷新推荐'}
                >
                  <span aria-hidden="true">↻</span>
                  {isRefreshing ? '刷新中…' : '刷新'}
                </button>
              ) : null}
              {presentationMode === 'fish' ? (
                <label className="forum-fish-minimal-control">
                  <input type="checkbox" checked={minimalMode} onChange={(event) => updateMinimalMode(event.target.checked)} />
                  <span>极简</span>
                </label>
              ) : null}
              {permissions.canCreatePost ? <Link href={createHref} className="forum-discovery-publish" aria-label="发布帖子">+</Link> : null}
            </div>
          </div>
          <form className="forum-discovery-search" onSubmit={submitSearch} role="search">
            <label htmlFor="forum-discovery-search-input">搜索帖子</label>
            <input
              id="forum-discovery-search-input"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索帖子"
              enterKeyHint="search"
            />
            <button type="submit" aria-label="执行搜索">⌕</button>
          </form>
          <nav className="forum-discovery-tabs" aria-label="广场分区">
            {tabItems.map((tab) => (
              <button key={tab.value} type="button" onClick={() => updateTab(tab.value)} aria-current={activeTab === tab.value ? 'page' : undefined}>
                {tab.label}
              </button>
            ))}
            {query ? <span className="forum-discovery-search-label">搜索：{query}</span> : null}
          </nav>
        </div>
      </header>

      <div className="forum-discovery-content">
        {error && !posts.length ? (
          <div className="forum-discovery-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void loadPage(true)}>重试</button>
          </div>
        ) : null}
        {loading && !posts.length ? (
          presentationMode === 'fish' ? (
            <div className="fish-mode-feed fish-mode-feed-skeleton" aria-label="正在加载">
              {DISCOVERY_SKELETON_KEYS.map((key) => <div key={`fish-skeleton-${key}`} className="fish-mode-post-skeleton" />)}
            </div>
          ) : (
            <div className="forum-discovery-grid" aria-label="正在加载">
              {DISCOVERY_SKELETON_KEYS.map((key) => <div key={`skeleton-${key}`} className="forum-discovery-skeleton" />)}
            </div>
          )
        ) : null}
        {!loading && !error && !posts.length ? <p className="forum-discovery-empty">暂时没有可展示的帖子</p> : null}
        {posts.length ? (
          presentationMode === 'fish' ? (
            <div className="fish-mode-feed" aria-label="摸鱼模式帖子列表">
              <div className="fish-mode-feed-heading">
                <span>文字优先 · 已加载 {posts.length} 条</span>
                <span className="fish-mode-keyboard-hint">J/K 浏览 · Enter 预览 · Esc 关闭 · L 点赞</span>
              </div>
              {posts.map((post) => <ForumFishModePostRow key={post.id} post={post} minimal={minimalMode} active={fishActivePostId === post.id} onOpen={openFishPreview} />)}
            </div>
          ) : (
            <div className="forum-discovery-grid">
              {posts.map((post, index) => <ForumDiscoveryCard key={post.id} post={post} priority={index < 2} onOpen={openPost} />)}
            </div>
          )
        ) : null}
        {error && posts.length ? <div className="forum-discovery-load-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadPage(false, true)}>重试</button></div> : null}
        {loadingMore ? <div className="forum-discovery-loading-more" aria-live="polite">正在加载更多</div> : null}
        {!hasMore && posts.length ? <p className="forum-discovery-end">已经看到这里了</p> : null}
        <div ref={sentinelRef} className="forum-discovery-sentinel" aria-hidden="true" />
      </div>
      {showBackTop ? <button type="button" className="forum-discovery-back-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="回到顶部">↑</button> : null}
      {presentationMode === 'fish' && fishPreviewPost ? (
        <ForumFishModePreview
          post={fishPreviewPost}
          minimal={minimalMode}
          focusComments={fishPreviewFocusComments}
          hasPrevious={fishPreviewIndex > 0}
          hasNext={fishPreviewIndex >= 0 && fishPreviewIndex < posts.length - 1}
          onClose={closeFishPreview}
          onNavigate={(direction) => {
            const nextPost = posts[fishPreviewIndex + direction]
            if (nextPost) openFishPreview(nextPost.id)
          }}
        />
      ) : null}
    </section>
  )
}
