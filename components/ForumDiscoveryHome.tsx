'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ForumDiscoveryCard } from '@/components/ForumDiscoveryCard'
import {
  buildForumDiscoveryTabs,
  appendUniqueDiscoveryPosts,
  FORUM_DISCOVERY_PAGE_SIZE,
  FORUM_DISCOVERY_RECENT_RECOMMENDATION_LIMIT,
  mergeRecentRecommendedPostIds,
  type ForumDiscoveryMode,
  type ForumDiscoveryPost,
  type ForumDiscoveryResponse,
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

export function ForumDiscoveryHome({ showDesktopRefresh = false }: Readonly<{ showDesktopRefresh?: boolean }>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
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

  const activeTab = query ? '' : boardValue || mode
  const createHref = activeBoard ? `/posts/new?board=${encodeURIComponent(activeBoard)}` : '/posts/new'

  const persistSession = useCallback((session: DiscoverySession) => {
    try {
      window.sessionStorage.setItem(sessionKey, JSON.stringify(session))
    } catch {
      // Feed restoration is best effort; browsing remains usable when storage is disabled.
    }
  }, [sessionKey])

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

  return (
    <section className="forum-discovery-page" data-forum-discovery>
      <div className="forum-discovery-pull-indicator" style={{ height: pullDistance ? `${pullDistance}px` : undefined }} aria-live="polite">
        {pullDistance >= 64 ? '松开刷新' : pullDistance > 8 ? '下拉刷新' : ''}
      </div>
      <header className="forum-discovery-header">
        <div className="forum-discovery-header-row">
          <h1>小臣书</h1>
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
      </header>

      {error && !posts.length ? (
        <div className="forum-discovery-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void loadPage(true)}>重试</button>
        </div>
      ) : null}
      {loading && !posts.length ? (
        <div className="forum-discovery-grid" aria-label="正在加载">
          {DISCOVERY_SKELETON_KEYS.map((key) => <div key={`skeleton-${key}`} className="forum-discovery-skeleton" />)}
        </div>
      ) : null}
      {!loading && !error && !posts.length ? <p className="forum-discovery-empty">暂时没有可展示的帖子</p> : null}
      {posts.length ? (
        <div className="forum-discovery-grid">
          {posts.map((post, index) => <ForumDiscoveryCard key={post.id} post={post} priority={index < 2} onOpen={openPost} />)}
        </div>
      ) : null}
      {error && posts.length ? <div className="forum-discovery-load-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadPage(false, true)}>重试</button></div> : null}
      {loadingMore ? <div className="forum-discovery-loading-more" aria-live="polite">正在加载更多</div> : null}
      {!hasMore && posts.length ? <p className="forum-discovery-end">已经看到这里了</p> : null}
      <div ref={sentinelRef} className="forum-discovery-sentinel" aria-hidden="true" />
      {showBackTop ? <button type="button" className="forum-discovery-back-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="回到顶部">↑</button> : null}
    </section>
  )
}
