'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { PostList } from '@/components/PostList'
import type { ForumFeedResponse, ForumSort } from '@/lib/forum'
import { buildForumHref, getForumPageWindow, parseForumSort } from '@/lib/forum'

const sortOptions: Array<[ForumSort, string]> = [
  ['latest', '最新'],
  ['latest-reply', '最新回复'],
  ['featured', '精华'],
  ['pinned', '置顶'],
  ['most-replies', '最多回复'],
]

function boardDisplayName(name: string, slug: string) {
  return slug === 'checkin' || name === '签到区' ? '专辑鉴赏' : name
}

const previewData: ForumFeedResponse = {
  boards: [
    { id: 'all-preview', name: '公告区', slug: 'announcements', description: null, postCount: 8, isAnnouncement: true },
    { id: 'chat-preview', name: '每日水楼', slug: 'daily-chat', description: null, postCount: 36, isAnnouncement: false },
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

  function updateQuery(values: Record<string, string | number | null>) {
    if (previewMode) return
    router.push(buildForumHref(pathname, searchParams.toString(), values), { scroll: false })
  }

  useEffect(() => setSearchValue(query), [query])

  useEffect(() => {
    if (previewMode) return
    if (searchValue === query) return
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(queryString)
      const value = searchValue.trim()
      if (value) next.set('query', value)
      else next.delete('query')
      next.delete('page')
      router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [pathname, previewMode, query, queryString, router, searchValue])

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
        if (sequence === requestSequence.current) setData(payload)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : '论坛内容加载失败')
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
    return () => controller.abort()
  }, [board, page, previewMode, query, sort])

  const createHref = board ? `/posts/new?board=${encodeURIComponent(board)}` : '/posts/new'
  const emptyText = sort === 'featured' ? '当前筛选下暂无精华帖子' : sort === 'pinned' ? '当前筛选下暂无置顶帖子' : '当前筛选下暂无帖子'

  return (
    <section className="forum-page" data-forum-main>
      <header className="forum-hero">
        <div className="forum-hero-inner">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="forum-hero-kicker">EASON FANS CLUB</p>
            <h1>E院广场{data?.selectedBoard ? ` / ${boardDisplayName(data.selectedBoard.name, data.selectedBoard.slug)}` : ''}</h1>
            <p>浏览公开分区，筛选、搜索并参与讨论。</p>
          </div>
          {data?.permissions.canCreatePost ? <Link href={createHref} className="flat-button-primary">发布帖子</Link> : null}
        </div>
        <label className="forum-search">
          <span className="sr-only">搜索帖子</span>
          <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="搜索标题和摘要" />
        </label>
        </div>
      </header>

      <nav aria-label="论坛分区" className="forum-board-nav">
        <button type="button" onClick={() => updateQuery({ board: null, page: null })} aria-current={!board ? 'page' : undefined}>全部</button>
        {(data?.boards || []).map((item) => (
          <button key={item.id} type="button" onClick={() => updateQuery({ board: item.slug, page: null })} aria-current={board === item.slug ? 'page' : undefined}>
            {boardDisplayName(item.name, item.slug)}<span className="ml-1 opacity-70">{item.postCount}</span>
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
        {!error && data ? <PostList posts={data.posts} total={data.total} emptyText={emptyText} responsiveColumns onBoardSelect={(slug) => updateQuery({ board: slug, page: null })} /> : null}
        {data && data.totalPages > 1 ? (
          <nav aria-label="论坛分页" className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
            <ForumPageLink label="首页" page={1} currentPage={page} disabled={page <= 1 || loading} pathname={pathname} query={queryString} />
            <ForumPageLink label="上一页" page={page - 1} currentPage={page} disabled={page <= 1 || loading} pathname={pathname} query={queryString} />
            {getForumPageWindow(page, data.totalPages).map((pageNumber) => (
              <ForumPageLink key={pageNumber} label={String(pageNumber)} page={pageNumber} currentPage={page} disabled={loading} pathname={pathname} query={queryString} numbered />
            ))}
            <ForumPageLink label="下一页" page={page + 1} currentPage={page} disabled={page >= data.totalPages || loading} pathname={pathname} query={queryString} />
            <ForumPageLink label="末页" page={data.totalPages} currentPage={page} disabled={page >= data.totalPages || loading} pathname={pathname} query={queryString} />
          </nav>
        ) : null}
      </div>
    </section>
  )
}

function ForumPageLink({ label, page, currentPage, disabled, pathname, query, numbered = false }: { label: string; page: number; currentPage: number; disabled: boolean; pathname: string; query: string; numbered?: boolean }) {
  const className = numbered
    ? `grid h-9 min-w-9 place-items-center rounded-full px-2 text-xs font-black ${page === currentPage ? 'bg-brand-950 text-white shadow-sm' : 'bg-sky-50 text-brand-700 hover:bg-sky-100'}`
    : 'rounded-full bg-sky-50 px-3 py-2 text-xs font-black text-brand-700'
  if (disabled || page === currentPage) return <span aria-disabled="true" aria-current={page === currentPage ? 'page' : undefined} className={`${className} cursor-not-allowed opacity-40`}>{label}</span>
  return <Link href={buildForumHref(pathname, query, { page })} scroll={false} className={className}>{label}</Link>
}
