'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ForumDiscoveryHome } from '@/components/ForumDiscoveryHome'
import { PostList } from '@/components/PostList'
import { Pagination } from '@/components/ui/Pagination'
import type { ForumTheme } from '@/lib/forum-discovery'
import type { ForumFeedResponse, ForumSort } from '@/lib/forum'
import { buildForumHref, parseForumSort } from '@/lib/forum'

const sortOptions: Array<[ForumSort, string]> = [
  ['latest', '最新'],
  ['latest-reply', '最新回复'],
  ['featured', '精华'],
  ['pinned', '置顶'],
  ['most-replies', '最多回复'],
]

const previewData: ForumFeedResponse = {
  boards: [
    { id: 'all-preview', name: '公告区', slug: 'announcements', description: null, postCount: 8, isAnnouncement: true },
    { id: 'chat-preview', name: '日常吹水', slug: 'daily-chat', description: null, postCount: 36, isAnnouncement: false },
    { id: 'concert-preview', name: '演唱会', slug: 'concert', description: null, postCount: 18, isAnnouncement: false },
  ],
  selectedBoard: null,
  posts: [],
  total: 0,
  totalPages: 1,
  page: 1,
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1, hasMore: false },
  permissions: { canCreatePost: true, canCreateAnnouncement: false },
}

export function ForumHome({ previewMode = false }: { previewMode?: boolean }) {
  const [isMobile, setIsMobile] = useState<boolean | null>(previewMode ? false : null)
  const [theme, setTheme] = useState<ForumTheme>('plaza')

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const syncViewportAndTheme = () => {
      const mobile = media.matches
      const savedTheme = window.localStorage.getItem('ecfc-forum-theme')
      setIsMobile(mobile)
      setTheme(mobile ? 'xiaochenshu' : savedTheme === 'xiaochenshu' ? 'xiaochenshu' : 'plaza')
    }
    syncViewportAndTheme()
    media.addEventListener('change', syncViewportAndTheme)
    window.addEventListener('ecfc:forum-theme-change', syncViewportAndTheme)
    return () => {
      media.removeEventListener('change', syncViewportAndTheme)
      window.removeEventListener('ecfc:forum-theme-change', syncViewportAndTheme)
    }
  }, [])

  function switchTheme(nextTheme: ForumTheme) {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setTheme('xiaochenshu')
      return
    }
    window.localStorage.setItem('ecfc-forum-theme', nextTheme)
    setTheme(nextTheme)
    window.dispatchEvent(new CustomEvent('ecfc:forum-theme-change', { detail: { theme: nextTheme } }))
  }

  // Wait for the client viewport before mounting either feed. This prevents a
  // mobile hydration pass from mounting ForumPlazaHome and firing /api/forum/feed
  // before the Xiaochenshu feed takes over.
  if (!previewMode && isMobile === null) return null

  if (!previewMode && theme === 'xiaochenshu') {
    return (
      <ForumDiscoveryHome
        showModeSwitch={!isMobile}
        onSwitchToPlaza={isMobile ? undefined : () => switchTheme('plaza')}
      />
    )
  }

  return (
    <ForumPlazaHome
      previewMode={previewMode}
      onSwitchToXiaochenshu={previewMode ? undefined : () => switchTheme('xiaochenshu')}
    />
  )
}

function ForumPlazaHome({
  previewMode = false,
  onSwitchToXiaochenshu,
}: {
  previewMode?: boolean
  onSwitchToXiaochenshu?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const board = searchParams.get('board') || ''
  const sort = parseForumSort(searchParams.get('sort'))
  const query = searchParams.get('query') || ''
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const queryString = searchParams.toString()
  const [searchValue, setSearchValue] = useState(query)
  const [data, setData] = useState<ForumFeedResponse | null>(previewMode ? previewData : null)
  const [loading, setLoading] = useState(!previewMode)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRestoreAttemptedRef = useRef(false)
  const searchComposingRef = useRef(false)

  const applySearch = useCallback((value: string) => {
    if (previewMode) return
    const normalized = value.trim()
    const nextUrl = buildForumHref(pathname, queryString, { query: normalized || null, page: null })
    const currentUrl = `${pathname}${queryString ? `?${queryString}` : ''}`
    if (nextUrl === currentUrl) return
    router.push(nextUrl, { scroll: true })
  }, [pathname, previewMode, queryString, router])

  function updateQuery(values: Record<string, string | number | null>) {
    if (previewMode) return
    router.push(buildForumHref(pathname, searchParams.toString(), values), { scroll: true })
  }

  function goToForumPage(nextPage: number) {
    const query = queryString
    const page = nextPage
    router.push(buildForumHref(pathname, query, { page }), { scroll: true })
  }

  function saveScrollForPost() {
    try {
      const key = `forum-scroll:${window.location.pathname}${window.location.search}`
      window.sessionStorage.setItem(key, JSON.stringify({ scrollY: window.scrollY }))
      window.history.replaceState({ ...(window.history.state || {}), __forumDetailReturnKey: key }, '', window.location.href)
    } catch {
      // Scroll restoration is an enhancement; navigation remains usable if storage is unavailable.
    }
  }

  useEffect(() => setSearchValue(query), [query])

  useEffect(() => {
    if (previewMode) return
    if (searchValue === query) return
    const timer = window.setTimeout(() => {
      if (!searchComposingRef.current) applySearch(searchValue)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [applySearch, previewMode, query, searchValue])

  useEffect(() => {
    if (previewMode) return
    const controller = new AbortController()
    const sequence = ++requestSequence.current
    const params = new URLSearchParams({ sort, page: String(page), pageSize: '20' })
    if (board) params.set('board', board)
    if (query) params.set('query', query)
    setLoading(true)
    setError('')
    fetch(`/api/forum/feed?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as ForumFeedResponse | { message?: string } | null
        if (!response.ok) throw new Error(payload && 'message' in payload ? payload.message : '论坛内容加载失败')
        return payload as ForumFeedResponse
      })
      .then((payload) => {
        if (sequence !== requestSequence.current) return
        setData(payload)
        if (payload.page !== page) {
          router.replace(buildForumHref(pathname, queryString, { page: payload.page }), { scroll: false })
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : '论坛内容加载失败')
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
    return () => controller.abort()
  }, [board, page, pathname, previewMode, query, queryString, router, sort])

  useEffect(() => {
    scrollRestoreAttemptedRef.current = false
    if (previewMode || !data || loading || scrollRestoreAttemptedRef.current) return
    const key = `forum-scroll:${pathname}${queryString ? `?${queryString}` : ''}`

    function restoreScrollIfReturning() {
      if (scrollRestoreAttemptedRef.current) return
      const state = window.history.state as { __forumDetailReturnKey?: string } | null
      if (state?.__forumDetailReturnKey !== key) return
      const raw = window.sessionStorage.getItem(key)
      if (!raw) return
      let target = 0
      try {
        target = Number((JSON.parse(raw) as { scrollY?: number }).scrollY)
      } catch {
        return
      }
      if (!Number.isFinite(target) || target < 0) return

      let frame = 0
      const restore = () => {
        frame += 1
        const contentReady = document.documentElement.scrollHeight >= target + window.innerHeight
        if (!contentReady && frame < 5) {
          window.requestAnimationFrame(restore)
          return
        }
        window.scrollTo({ top: target, behavior: 'auto' })
        scrollRestoreAttemptedRef.current = true
        window.sessionStorage.removeItem(key)
        window.history.replaceState({ ...(window.history.state || {}), __forumDetailReturnKey: undefined }, '', window.location.href)
      }
      window.requestAnimationFrame(restore)
    }

    restoreScrollIfReturning()
    window.addEventListener('pageshow', restoreScrollIfReturning)
    return () => window.removeEventListener('pageshow', restoreScrollIfReturning)
  }, [data, loading, pathname, previewMode, queryString])

  const createHref = board ? `/posts/new?board=${encodeURIComponent(board)}` : '/posts/new'
  const emptyText = sort === 'featured' ? '当前筛选下暂无精华帖子' : sort === 'pinned' ? '当前筛选下暂无置顶帖子' : '当前筛选下暂无帖子'

  return (
    <section className="forum-page" data-forum-main>
      <header className="forum-hero">
        <div className="forum-hero-inner">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="forum-hero-kicker">EASON FANS CLUB</p>
            <h1>E院广场{data?.selectedBoard ? ` / ${data.selectedBoard.name}` : ''}</h1>
            <p>浏览公开分区，筛选、搜索并参与讨论。</p>
          </div>
          <div className="forum-hero-actions">
            {data?.permissions.canCreatePost ? <Link href={createHref} className="flat-button-primary">发布帖子</Link> : null}
            {onSwitchToXiaochenshu ? (
              <button
                type="button"
                className="forum-plaza-mode-button"
                onClick={onSwitchToXiaochenshu}
                aria-label="切换到小臣书模式"
              >
                小臣书模式
              </button>
            ) : null}
          </div>
        </div>
        <form
          className="forum-search"
          onSubmit={(event) => {
            event.preventDefault()
            if (searchComposingRef.current) return
            applySearch(searchValue)
          }}
          onCompositionStart={() => { searchComposingRef.current = true }}
          onCompositionEnd={() => { searchComposingRef.current = false }}
        >
          <span className="sr-only">搜索帖子</span>
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="搜索标题和摘要"
            enterKeyHint="search"
          />
        </form>
        </div>
      </header>

      <nav aria-label="论坛分区" className="forum-board-nav">
        <button type="button" onClick={() => updateQuery({ board: null, page: null })} aria-current={!board ? 'page' : undefined}>全部</button>
        {(data?.boards || []).map((item) => (
          <button key={item.id} type="button" onClick={() => updateQuery({ board: item.slug, page: null })} aria-current={board === item.slug ? 'page' : undefined}>
            {item.name}<span className="ml-1 opacity-70">{item.postCount}</span>
          </button>
        ))}
      </nav>

      <div ref={contentRef} className="forum-content scroll-mt-24">
        <div className="forum-sort-tabs">
          {sortOptions.map(([value, label]) => <button key={value} type="button" onClick={() => updateQuery({ sort: value === 'latest' ? null : value, page: null })} aria-current={sort === value ? 'page' : undefined}>{label}</button>)}
        </div>
        {loading && !data ? <div className="forum-loading" aria-label="正在加载"><div /><div /><div /></div> : null}
        {error ? <div className="flat-error-state">{error}</div> : null}
        {loading && data ? <p aria-live="polite" className="forum-loading-note">正在加载第 {page} 页…</p> : null}
        {!error && data ? <PostList posts={data.posts} total={data.total} emptyText={emptyText} responsiveColumns onBoardSelect={(slug) => updateQuery({ board: slug, page: null })} onPostOpen={saveScrollForPost} /> : null}
        {data && data.totalPages > 1 ? (
          <Pagination
            currentPage={page}
            totalPages={data.totalPages}
            onPageChange={goToForumPage}
            disabled={loading}
            ariaLabel="论坛分页"
            className="forum-pagination"
          />
        ) : null}
      </div>
    </section>
  )
}
