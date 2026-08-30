'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatUid } from '@/lib/uid'
import {
  formatSalonSession,
  SALON_CATEGORY_LABELS,
  type SalonCategoryValue,
  type SalonOptions,
  type SalonPostView,
} from '@/lib/salon'
import { SalonLikeButton } from './SalonLikeButton'

const categoryTabs: Array<{ value: SalonCategoryValue | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'CONCERT', label: '演唱会记录' },
  { value: 'MOBILE_WALLPAPER', label: '手机壁纸' },
  { value: 'DESKTOP_WALLPAPER', label: '电脑壁纸' },
]

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: '2-digit', day: '2-digit', year: 'numeric' }).format(new Date(value))
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
  query.delete('cursor')
  const value = query.toString()
  return `${pathname}${value ? `?${value}` : ''}`
}

export function SalonHome({ initialPosts, initialHasMore, initialNextCursor, options, currentUserId }: Readonly<{
  initialPosts: SalonPostView[]
  initialHasMore: boolean
  initialNextCursor: string | null
  options: SalonOptions
  currentUserId: string | null
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [posts, setPosts] = useState(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadLock = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const selectedCategory = searchParams.get('category') || ''
  const selectedTourId = searchParams.get('concert') || ''
  const selectedSessionId = searchParams.get('session') || ''
  const selectedSort = searchParams.get('sort') === 'popular' ? 'popular' : 'latest'
  const selectedTour = options.tours.find((tour) => tour.id === selectedTourId)
  const sessions = selectedTour?.sessions || []

  useEffect(() => {
    setPosts(initialPosts)
    setHasMore(initialHasMore)
    setNextCursor(initialNextCursor)
  }, [initialHasMore, initialNextCursor, initialPosts])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    }, { rootMargin: '480px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
    // The URL and initial data identify the current feed. The callback reads
    // the current cursor from state and is intentionally recreated per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, nextCursor, selectedCategory, selectedSort, selectedTourId, selectedSessionId])

  useEffect(() => {
    const onMessage = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message
      if (message) window.alert(message)
    }
    window.addEventListener('salon:message', onMessage)
    return () => window.removeEventListener('salon:message', onMessage)
  }, [])

  const queryWithoutCursor = useMemo(() => {
    const query = new URLSearchParams(searchParams.toString())
    query.delete('cursor')
    return query.toString()
  }, [searchParams])

  async function loadMore() {
    if (!hasMore || !nextCursor || loadLock.current) return
    loadLock.current = true
    setLoadingMore(true)
    try {
      const query = new URLSearchParams(queryWithoutCursor)
      query.set('cursor', nextCursor)
      const response = await fetch(`/api/salon/posts?${query.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { posts?: SalonPostView[]; hasMore?: boolean; nextCursor?: string | null } | null
      if (!response.ok) throw new Error('更多作品加载失败')
      setPosts((current) => [...current, ...(Array.isArray(data?.posts) ? data.posts : [])])
      setHasMore(data?.hasMore === true)
      setNextCursor(data?.nextCursor || null)
    } catch (error) {
      window.dispatchEvent(new CustomEvent('salon:message', { detail: { message: error instanceof Error ? error.message : '更多作品加载失败' } }))
    } finally {
      loadLock.current = false
      setLoadingMore(false)
    }
  }

  function selectTour(value: string) {
    const tour = options.tours.find((item) => item.id === value)
    updateUrl(router, pathname, searchParams, { concert: value || null, session: tour?.sessions.some((session) => session.id === selectedSessionId) ? selectedSessionId : null, cursor: null })
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

    <nav className="salon-category-tabs" aria-label="沙龙分类">
      {categoryTabs.map((tab) => <Link key={tab.value || 'all'} href={categoryHref(pathname, searchParams, tab.value)} aria-current={(selectedCategory || '') === tab.value ? 'page' : undefined}>{tab.label}</Link>)}
    </nav>

    <section className="salon-filter-bar" aria-label="沙龙筛选">
      <label><span>演唱会</span><select value={selectedTourId} onChange={(event) => selectTour(event.target.value)}><option value="">全部演唱会</option>{options.tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
      <label><span>场次</span><select value={selectedSessionId} disabled={!selectedTourId} onChange={(event) => updateUrl(router, pathname, searchParams, { session: event.target.value || null, cursor: null })}><option value="">{selectedTourId ? '全部场次' : '先选择演唱会'}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatSalonSession(session)}</option>)}</select></label>
      <div className="salon-sort-tabs" role="tablist" aria-label="作品排序"><button type="button" role="tab" aria-selected={selectedSort === 'latest'} onClick={() => updateUrl(router, pathname, searchParams, { sort: null, cursor: null })}>最新</button><button type="button" role="tab" aria-selected={selectedSort === 'popular'} onClick={() => updateUrl(router, pathname, searchParams, { sort: 'popular', cursor: null })}>最热</button></div>
    </section>

    {selectedTour ? <p className="salon-filter-summary">正在查看：{selectedTour.name}{selectedSessionId ? ` · ${sessions.find((session) => session.id === selectedSessionId)?.city || '指定场次'}` : ' · 全部场次'}</p> : null}
    {!posts.length ? <section className="salon-empty"><strong>还没有公开作品</strong><span>成为第一个把现场那一刻带进沙龙的人。</span></section> : <section className="salon-gallery" aria-label="沙龙作品">
      {posts.map((post, index) => <SalonGalleryCard key={post.id} post={post} priority={index < 4} />)}
    </section>}
    <div ref={sentinelRef} className="salon-load-more" aria-live="polite">{loadingMore ? '正在加载更多作品…' : hasMore ? '向下滚动加载更多' : posts.length ? '已经看到全部作品' : ''}</div>
  </main>
}

function SalonGalleryCard({ post, priority }: Readonly<{ post: SalonPostView; priority: boolean }>) {
  const media = post.media[0]
  if (!media) return null
  return <article className="salon-gallery-card">
    <Link href={`/salon/${post.id}`} className="salon-gallery-image-link">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.thumbnailUrl} alt={post.title || `${post.concert.tour.name} · ${post.concert.city}`} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} />
      {post.media.length > 1 ? <span className="salon-media-count">{post.media.length} 张</span> : null}
      <span className="salon-category-tag">{SALON_CATEGORY_LABELS[post.category]}</span>
    </Link>
    <div className="salon-gallery-caption">
      <Link href={`/salon/${post.id}`} className="salon-gallery-concert">{post.concert.tour.name} · {post.concert.city}</Link>
      <p>{post.concert.title || formatDate(post.concert.date)}</p>
      <div className="salon-gallery-meta">
        <Link href={`/user/${formatUid(post.author.uid)}`} className="salon-author-link"><SafeAvatar src={post.author.avatarUrl} name={post.author.nickname} uid={post.author.uid} className="salon-avatar" textClassName="salon-avatar-fallback" variant="avatar-sm" /><span>{post.author.nickname}</span></Link>
        <span className="salon-card-stats"><SalonLikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} /><span>评论 {post.commentCount}</span></span>
      </div>
    </div>
  </article>
}
