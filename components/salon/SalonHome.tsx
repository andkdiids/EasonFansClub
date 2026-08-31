'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatUid } from '@/lib/uid'
import {
  appendUniqueSalonPosts,
  createEmptySalonCategoryCounts,
  formatSalonPostContext,
  formatSalonSession,
  SALON_CATEGORIES,
  SALON_CATEGORY_CONFIG,
  type SalonCategoryCounts,
  type SalonCategoryValue,
  type SalonFeedMode,
  type SalonOptions,
  type SalonPostView,
  type SalonSort,
} from '@/lib/salon'
import { SalonLikeButton } from './SalonLikeButton'
import { UiIcon } from '@/components/UiIcon'

const categoryTabs: Array<{ value: SalonCategoryValue | ''; label: string }> = [
  { value: '', label: '全部' },
  ...SALON_CATEGORIES.map((value) => ({ value, label: SALON_CATEGORY_CONFIG[value].label })),
]

type SalonFeedResponse = {
  posts?: SalonPostView[]
  hasMore?: boolean
  nextCursor?: string | null
  feedSeed?: string | null
  categoryCounts?: SalonCategoryCounts
  message?: string
}

function isSalonCategoryCounts(value: unknown): value is SalonCategoryCounts {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['all', ...SALON_CATEGORIES].every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0)
}

type SearchParamsLike = Pick<URLSearchParams, 'toString'>

function updateUrl(router: ReturnType<typeof useRouter>, pathname: string, searchParams: SearchParamsLike, changes: Record<string, string | null>) {
  const next = new URLSearchParams(searchParams.toString())
  Object.entries(changes).forEach(([key, value]) => {
    if (value) next.set(key, value)
    else next.delete(key)
  })
  const query = next.toString()
  router.push(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
}

function categoryHref(pathname: string, searchParams: SearchParamsLike, category: SalonCategoryValue | '') {
  const query = new URLSearchParams(searchParams.toString())
  if (category) query.set('category', category)
  else query.delete('category')
  if (category && !SALON_CATEGORY_CONFIG[category].allowsConcert) {
    query.delete('concert')
    query.delete('session')
  }
  query.delete('cursor')
  const value = query.toString()
  return `${pathname}${value ? `?${value}` : ''}`
}

export function SalonHome({ initialPosts, initialHasMore, initialNextCursor, initialFeedSeed = null, initialCategoryCounts, options, currentUserId }: Readonly<{
  initialPosts: SalonPostView[]
  initialHasMore: boolean
  initialNextCursor: string | null
  initialFeedSeed?: string | null
  initialCategoryCounts?: SalonCategoryCounts
  options: SalonOptions
  currentUserId: string | null
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedCategory = searchParams.get('category') || ''
  const selectedTourId = searchParams.get('concert') || ''
  const selectedSessionId = searchParams.get('session') || ''
  const selectedSort = searchParams.get('sort') === 'popular' ? 'popular' : 'latest'
  const selectedTour = options.tours.find((tour) => tour.id === selectedTourId)
  const sessions = selectedTour?.sessions || []
  const showConcertFilters = !selectedCategory || SALON_CATEGORY_CONFIG[selectedCategory as SalonCategoryValue]?.allowsConcert === true
  const canPullRefresh = !selectedCategory && !selectedTourId && !selectedSessionId && selectedSort === 'latest'
  const initialMode: SalonFeedMode = selectedSort === 'popular' ? 'popular' : 'latest'
  const safeInitialCounts = useMemo(() => initialCategoryCounts || createEmptySalonCategoryCounts(), [initialCategoryCounts])
  const [posts, setPosts] = useState(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [categoryCounts, setCategoryCounts] = useState(safeInitialCounts)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [feedMode, setFeedMode] = useState<SalonFeedMode>(initialMode)
  const [feedSeed, setFeedSeed] = useState<string | null>(initialFeedSeed)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshNotice, setRefreshNotice] = useState('')
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const postsRef = useRef<SalonPostView[]>(initialPosts)
  const hasMoreRef = useRef(initialHasMore)
  const nextCursorRef = useRef<string | null>(initialNextCursor)
  const loadingMoreRef = useRef(false)
  const autoLoadBlockedRef = useRef(false)
  const feedModeRef = useRef<SalonFeedMode>(initialMode)
  const feedSeedRef = useRef<string | null>(initialFeedSeed)
  const requestSequenceRef = useRef(0)
  const requestRef = useRef<{ key: string; controller: AbortController } | null>(null)
  const refreshingRef = useRef(false)
  const touchStartRef = useRef<number | null>(null)
  const pullDistanceRef = useRef(0)

  const queryWithoutCursor = useMemo(() => {
    const query = new URLSearchParams(searchParams.toString())
    query.delete('cursor')
    query.delete('mode')
    query.delete('feedSeed')
    return query.toString()
  }, [searchParams])

  useEffect(() => {
    requestRef.current?.controller.abort()
    requestRef.current = null
    requestSequenceRef.current += 1
    const mode: SalonFeedMode = selectedSort === 'popular' ? 'popular' : 'latest'
    postsRef.current = initialPosts
    hasMoreRef.current = initialHasMore
    nextCursorRef.current = initialNextCursor
    loadingMoreRef.current = false
    autoLoadBlockedRef.current = false
    feedModeRef.current = mode
    feedSeedRef.current = initialFeedSeed
    setPosts(initialPosts)
    setHasMore(initialHasMore)
    setNextCursor(initialNextCursor)
    setCategoryCounts(initialCategoryCounts || safeInitialCounts)
    setLoadingMore(false)
    setLoadError('')
    setFeedMode(mode)
    setFeedSeed(initialFeedSeed)
    setPullDistance(0)
    setRefreshNotice('')
  }, [initialCategoryCounts, initialFeedSeed, initialHasMore, initialNextCursor, initialPosts, safeInitialCounts, selectedCategory, selectedSessionId, selectedSort, selectedTourId])

  const loadMore = useCallback(async (manual = false) => {
    if (autoLoadBlockedRef.current && !manual) return
    const requestCursor = nextCursorRef.current
    if (!hasMoreRef.current || !requestCursor || loadingMoreRef.current || requestRef.current) return
    autoLoadBlockedRef.current = false
    loadingMoreRef.current = true
    setLoadingMore(true)
    const requestMode = feedModeRef.current
    const requestFeedSeed = feedSeedRef.current
    const query = new URLSearchParams(queryWithoutCursor)
    query.set('cursor', requestCursor)
    if (requestMode === 'recommend') {
      query.set('mode', 'recommend')
      if (requestFeedSeed) query.set('feedSeed', requestFeedSeed)
    }
    const requestKey = `${queryWithoutCursor}|${requestMode}|${requestFeedSeed || ''}|${requestCursor}`
    const controller = new AbortController()
    const sequence = ++requestSequenceRef.current
    requestRef.current = { key: requestKey, controller }
    setLoadError('')
    try {
      const response = await fetch(`/api/salon/posts?${query.toString()}`, { cache: 'no-store', signal: controller.signal })
      const data = await response.json().catch(() => null) as SalonFeedResponse | null
      if (!response.ok) throw new Error(data?.message || '更多作品加载失败')
      if (sequence !== requestSequenceRef.current) return
      const incoming = appendUniqueSalonPosts([], Array.isArray(data?.posts) ? data.posts : [], true)
      const current = postsRef.current
      const newIncoming = incoming.filter((post) => !current.some((item) => item.id === post.id))
      const responseCursor = data?.nextCursor || null
      if (data?.hasMore === true && (!responseCursor || responseCursor === requestCursor || newIncoming.length === 0)) {
        autoLoadBlockedRef.current = true
        setLoadError(data?.message || '加载更多没有返回新内容，请点击重试')
        return
      }
      const merged = appendUniqueSalonPosts(current, incoming)
      const nextHasMore = data?.hasMore === true && Boolean(responseCursor)
      postsRef.current = merged
      hasMoreRef.current = nextHasMore
      nextCursorRef.current = nextHasMore ? responseCursor : null
      setPosts(merged)
      setHasMore(nextHasMore)
      setNextCursor(nextHasMore ? responseCursor : null)
      if (isSalonCategoryCounts(data?.categoryCounts)) setCategoryCounts(data.categoryCounts)
      setLoadError('')
    } catch (error) {
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return
      autoLoadBlockedRef.current = true
      setLoadError(error instanceof Error ? error.message : '更多作品加载失败')
    } finally {
      if (sequence === requestSequenceRef.current) {
        if (requestRef.current?.key === requestKey) requestRef.current = null
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [queryWithoutCursor])

  const refresh = useCallback(async () => {
    if (!canPullRefresh || refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshing(true)
    setPullDistance(0)
    pullDistanceRef.current = 0
    setRefreshNotice('')
    requestRef.current?.controller.abort()
    requestRef.current = null
    requestSequenceRef.current += 1
    loadingMoreRef.current = false
    setLoadingMore(false)
    const sequence = ++requestSequenceRef.current
    const query = new URLSearchParams(queryWithoutCursor)
    query.delete('cursor')
    query.set('mode', 'recommend')
    const requestKey = `${queryWithoutCursor}|recommend|refresh`
    const controller = new AbortController()
    requestRef.current = { key: requestKey, controller }
    try {
      const response = await fetch(`/api/salon/posts?${query.toString()}`, { cache: 'no-store', signal: controller.signal })
      const data = await response.json().catch(() => null) as SalonFeedResponse | null
      if (!response.ok) throw new Error(data?.message || '推荐刷新失败')
      if (sequence !== requestSequenceRef.current) return
      if (typeof data?.feedSeed !== 'string' || !data.feedSeed) throw new Error('推荐刷新未返回新的 feed session')
      const incoming = appendUniqueSalonPosts([], Array.isArray(data.posts) ? data.posts : [], true)
      const responseCursor = data.nextCursor || null
      const nextHasMore = data.hasMore === true && Boolean(responseCursor)
      postsRef.current = incoming
      hasMoreRef.current = nextHasMore
      nextCursorRef.current = nextHasMore ? responseCursor : null
      feedModeRef.current = 'recommend'
      feedSeedRef.current = data.feedSeed
      setPosts(incoming)
      setHasMore(nextHasMore)
      setNextCursor(nextHasMore ? responseCursor : null)
      setFeedMode('recommend')
      setFeedSeed(data.feedSeed)
      if (isSalonCategoryCounts(data.categoryCounts)) setCategoryCounts(data.categoryCounts)
      setLoadError('')
      setRefreshNotice('已更新推荐')
    } catch (error) {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current) setLoadError(error instanceof Error ? error.message : '推荐刷新失败')
    } finally {
      if (requestRef.current?.key === requestKey) requestRef.current = null
      refreshingRef.current = false
      setIsRefreshing(false)
    }
  }, [canPullRefresh, queryWithoutCursor])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const observer = new IntersectionObserver((entries) => {
      const entered = entries.some((entry) => entry.isIntersecting)
      if (!entered) autoLoadBlockedRef.current = false
      if (entered && !autoLoadBlockedRef.current) void loadMore()
    }, { rootMargin: '480px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [feedMode, feedSeed, hasMore, loadMore, nextCursor, loadingMore])

  useEffect(() => {
    const onMessage = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message
      if (message) window.alert(message)
    }
    window.addEventListener('salon:message', onMessage)
    return () => window.removeEventListener('salon:message', onMessage)
  }, [])

  useEffect(() => {
    if (!canPullRefresh) {
      touchStartRef.current = null
      pullDistanceRef.current = 0
      setPullDistance(0)
      return
    }
    const onTouchStart = (event: TouchEvent) => {
      touchStartRef.current = !refreshingRef.current && window.scrollY <= 0 ? event.touches[0]?.clientY ?? null : null
    }
    const onTouchMove = (event: TouchEvent) => {
      if (touchStartRef.current === null || window.scrollY > 0 || refreshingRef.current) return
      const distance = Math.max(0, Math.min(96, (event.touches[0]?.clientY || 0) - touchStartRef.current))
      pullDistanceRef.current = distance
      setPullDistance(distance)
      if (distance > 8) event.preventDefault()
    }
    const onTouchEnd = () => {
      touchStartRef.current = null
      if (pullDistanceRef.current >= 64) void refresh()
      else {
        pullDistanceRef.current = 0
        setPullDistance(0)
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [canPullRefresh, refresh])

  function selectTour(value: string) {
    const tour = options.tours.find((item) => item.id === value)
    updateUrl(router, pathname, searchParams, { concert: value || null, session: tour?.sessions.some((session) => session.id === selectedSessionId) ? selectedSessionId : null, cursor: null })
  }

  function selectSort(sort: SalonSort) {
    const alreadySelected = sort === selectedSort
    if (alreadySelected && feedModeRef.current !== sort) {
      router.refresh()
      return
    }
    updateUrl(router, pathname, searchParams, { sort: sort === 'popular' ? 'popular' : null, cursor: null })
  }

  return <main className="salon-page">
    <header className="salon-header">
      <div>
        <p className="salon-kicker">EASON FANS CLUB · IMAGE COMMUNITY</p>
        <h1>沙龙</h1>
        <p>记录现场，也分享你眼中的那一刻。</p>
      </div>
      <div className="salon-header-actions">
        {currentUserId ? <Link href="/salon/mine" className="salon-secondary-button">我的投稿</Link> : null}
        <Link href="/salon/upload" className="salon-primary-button">上传照片</Link>
      </div>
    </header>

    <div className="salon-pull-indicator" style={{ height: pullDistance ? `${pullDistance}px` : isRefreshing || refreshNotice ? '30px' : undefined }} aria-live="polite">
      {isRefreshing ? '正在刷新推荐' : pullDistance >= 64 ? '松开刷新' : pullDistance > 8 ? '下拉刷新' : refreshNotice}
    </div>

    <nav className="salon-category-tabs" aria-label="沙龙分类">
      {categoryTabs.map((tab) => {
        const count = tab.value ? categoryCounts[tab.value] : categoryCounts.all
        return <Link key={tab.value || 'all'} href={categoryHref(pathname, searchParams, tab.value)} aria-current={(selectedCategory || '') === tab.value ? 'page' : undefined}><span>{tab.label}</span><span className="salon-category-count" aria-label={`${count} 篇`}>{count}</span></Link>
      })}
    </nav>

    <section className="salon-filter-bar" aria-label="沙龙筛选">
      {showConcertFilters ? <>
        <label><span>演唱会</span><select value={selectedTourId} onChange={(event) => selectTour(event.target.value)}><option value="">全部演唱会</option>{options.tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
        <label><span>场次</span><select value={selectedSessionId} disabled={!selectedTourId} onChange={(event) => updateUrl(router, pathname, searchParams, { session: event.target.value || null, cursor: null })}><option value="">{selectedTourId ? '全部场次' : '先选择演唱会'}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatSalonSession(session)}</option>)}</select></label>
      </> : null}
      <div className="salon-sort-tabs" role="tablist" aria-label="作品排序"><button type="button" role="tab" aria-selected={selectedSort === 'latest'} onClick={() => selectSort('latest')}>最新</button><button type="button" role="tab" aria-selected={selectedSort === 'popular'} onClick={() => selectSort('popular')}>最热</button></div>
    </section>

    {selectedTour ? <p className="salon-filter-summary">正在查看：{selectedTour.name}{selectedSessionId ? ` · ${sessions.find((session) => session.id === selectedSessionId)?.city || '指定场次'}` : ' · 全部场次'}</p> : null}
    {!posts.length ? <section className="salon-empty"><strong>还没有公开作品</strong><span>成为第一个把现场那一刻带进沙龙的人。</span></section> : <section className="salon-gallery" aria-label="沙龙作品">
      {posts.map((post, index) => <SalonGalleryCard key={post.id} post={post} priority={index < 4} />)}
    </section>}
    <div ref={sentinelRef} className={`salon-load-more${loadError ? ' salon-load-error' : ''}`} aria-live="polite">
      {loadingMore ? '正在加载更多作品…' : loadError ? <><span>{loadError}</span><button type="button" onClick={() => void loadMore(true)}>点击重试</button></> : hasMore ? '向下滚动加载更多' : posts.length ? '已经看到全部作品' : ''}
    </div>
  </main>
}

function SalonGalleryCard({ post, priority }: Readonly<{ post: SalonPostView; priority: boolean }>) {
  const media = post.media[0]
  if (!media) return null
  const contextLabel = formatSalonPostContext(post.category, post.concert)
  const sessionLabel = post.concert ? formatSalonSession({ city: post.concert.city, concertDate: post.concert.date, venue: post.concert.venue, title: post.concert.title, sessionNumber: post.concert.sessionNumber }) : null
  return <article className="salon-gallery-card">
    <Link href={`/salon/${post.id}`} className="salon-gallery-image-link">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.thumbnailUrl} alt={post.title || contextLabel} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} />
      {post.media.length > 1 ? <span className="salon-media-count">{post.media.length} 张</span> : null}
      <span className="salon-category-tag">{SALON_CATEGORY_CONFIG[post.category].label}</span>
    </Link>
    <div className="salon-gallery-caption">
      <Link href={`/salon/${post.id}`} className="salon-gallery-concert">{contextLabel}</Link>
      {sessionLabel ? <p>{sessionLabel}</p> : null}
      <div className="salon-gallery-meta">
        <Link href={`/user/${formatUid(post.author.uid)}`} className="salon-author-link"><SafeAvatar src={post.author.avatarUrl} name={post.author.nickname} uid={post.author.uid} className="salon-avatar" textClassName="salon-avatar-fallback" variant="avatar-sm" /><span>{post.author.nickname}</span></Link>
        <div className="salon-gallery-stats-row"><SalonLikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} /><span className="salon-card-stats"><span className="salon-view-stat"><UiIcon name="eye" className="salon-stat-icon" /><span>{post.viewCount || 0}</span></span><span>评论 {post.commentCount}</span></span></div>
      </div>
    </div>
  </article>
}
