'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ForumDiscoveryCard } from '@/components/ForumDiscoveryCard'
import {
  FORUM_DISCOVERY_PAGE_SIZE,
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
  seenPostIds: string[]
  seenAuthorIds: string[]
  scrollY: number
}

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

export function ForumDiscoveryHome({ onSwitchToPlaza }: Readonly<{ onSwitchToPlaza: () => void }>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const boardValue = searchParams.get('board') || ''
  const query = searchParams.get('query') || ''
  const activeBoard = boardValue && boardValue !== 'all' ? boardValue : ''
  const mode: ForumDiscoveryMode = !boardValue && !query ? 'recommend' : 'latest'
  const sessionKey = `forum-discovery-session:${pathname}${queryString ? `?${queryString}` : ''}`
  const [searchValue, setSearchValue] = useState(query)
  const [posts, setPosts] = useState<ForumDiscoveryPost[]>([])
  const [boards, setBoards] = useState<ForumDiscoveryResponse['boards']>([])
  const [permissions, setPermissions] = useState<ForumDiscoveryResponse['permissions']>({ canCreatePost: false, canCreateAnnouncement: false })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
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
  const requestSequence = useRef(0)
  const requestRef = useRef<DiscoveryRequest | null>(null)
  const autoLoadBlockedRef = useRef(false)
  const initializedSessionKeyRef = useRef('')
  const sentinelRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<number | null>(null)
  const pullDistanceRef = useRef(0)

  const activeTab = query ? '' : boardValue || 'recommend'
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

    const requestKey = `${sessionKey}:${reset ? 'reset' : `more:${nextCursorRef.current || 'start'}`}`
    if (requestRef.current?.key === requestKey) return requestRef.current.promise
    requestRef.current?.controller.abort()
    if (reset || manual) autoLoadBlockedRef.current = false

    if (reset) {
      loadingMoreRef.current = false
      hasMoreRef.current = true
      seenPostIdsRef.current = new Set()
      seenAuthorIdsRef.current = new Set()
      postsRef.current = []
      nextCursorRef.current = null
      setPosts([])
      setNextCursor(null)
      setHasMore(true)
      setLoading(true)
      setLoadingMore(false)
      try { window.sessionStorage.removeItem(sessionKey) } catch { /* best effort */ }
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
          cursor: reset ? null : nextCursorRef.current,
          seenPostIds: reset ? [] : [...seenPostIdsRef.current],
          seenAuthorIds: reset ? [] : [...seenAuthorIdsRef.current],
        }),
        })
        const payload = await response.json().catch(() => null) as ForumDiscoveryResponse | { message?: string } | null
        if (!response.ok || !payload || !('posts' in payload)) throw new Error(payload && 'message' in payload ? payload.message : '内容加载失败')
        if (sequence !== requestSequence.current) return

        const incoming = payload.posts
        const currentPosts = postsRef.current
        const merged = reset
          ? incoming
          : [...currentPosts, ...incoming.filter((post) => !currentPosts.some((current) => current.id === post.id))]
        const nextSeenPostIds = reset ? new Set<string>() : new Set(seenPostIdsRef.current)
        const nextSeenAuthorIds = reset ? new Set<string>() : new Set(seenAuthorIdsRef.current)
        incoming.forEach((post) => {
          nextSeenPostIds.add(post.id)
          if (mode === 'recommend') nextSeenAuthorIds.add(post.author.id)
        })
        postsRef.current = merged
        nextCursorRef.current = payload.nextCursor
        seenPostIdsRef.current = nextSeenPostIds
        seenAuthorIdsRef.current = nextSeenAuthorIds
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
          seenPostIds: [...nextSeenPostIds],
          seenAuthorIds: [...nextSeenAuthorIds],
          scrollY: window.scrollY,
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
    void request.finally(() => {
      if (requestRef.current?.promise === request) requestRef.current = null
    })
    return request
  }, [boardValue, mode, persistSession, query, sessionKey])

  useEffect(() => setSearchValue(query), [query])

  useEffect(() => {
    if (initializedSessionKeyRef.current === sessionKey) return
    initializedSessionKeyRef.current = sessionKey
    const cleanupRequest = () => {
      if (initializedSessionKeyRef.current === sessionKey) initializedSessionKeyRef.current = ''
      const request = requestRef.current
      request?.controller.abort()
      if (requestRef.current === request) requestRef.current = null
    }
    const stored = readSession(sessionKey)
    if (stored && stored.posts.length > 0) {
      setPosts(stored.posts)
      setBoards(stored.boards)
      setPermissions(stored.permissions)
      setNextCursor(stored.nextCursor)
      setHasMore(stored.hasMore)
      postsRef.current = stored.posts
      nextCursorRef.current = stored.nextCursor
      hasMoreRef.current = stored.hasMore
      seenPostIdsRef.current = new Set(stored.seenPostIds || stored.posts.map((post) => post.id))
      seenAuthorIdsRef.current = new Set(stored.seenAuthorIds || stored.posts.map((post) => post.author.id))
      setRestoreScrollY(Number.isFinite(stored.scrollY) ? Math.max(0, stored.scrollY) : null)
      setLoading(false)
      return cleanupRequest
    }
    void loadPage(true)
    return cleanupRequest
  }, [loadPage, sessionKey])

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
      if (entries.some((entry) => entry.isIntersecting)) void loadPage(false)
    }, { rootMargin: '900px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadPage])

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

  const refresh = useCallback(() => {
    setPullDistance(0)
    pullDistanceRef.current = 0
    void loadPage(true)
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
      seenPostIds: [...seenPostIdsRef.current],
      seenAuthorIds: [...seenAuthorIdsRef.current],
      scrollY: window.scrollY,
    })
    router.push(`/posts/${postId}`, { scroll: false })
  }

  const tabItems = useMemo(() => [
    { value: 'recommend', label: '推荐' },
    { value: 'all', label: '全部' },
    ...boards.map((board) => ({ value: board.slug, label: board.name })),
  ], [boards])

  return (
    <section className="forum-discovery-page" data-forum-discovery>
      <div className="forum-discovery-pull-indicator" style={{ height: pullDistance ? `${pullDistance}px` : undefined }} aria-live="polite">
        {pullDistance >= 64 ? '松开刷新' : pullDistance > 8 ? '下拉刷新' : ''}
      </div>
      <header className="forum-discovery-header">
        <div className="forum-discovery-header-row">
          <h1>小臣书</h1>
          <div className="forum-discovery-header-actions">
            {permissions.canCreatePost ? <Link href={createHref} className="forum-discovery-publish" aria-label="发布帖子">+</Link> : null}
            <button type="button" className="forum-discovery-mode-button" onClick={onSwitchToPlaza}>广场模式</button>
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
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="forum-discovery-skeleton" />)}
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
