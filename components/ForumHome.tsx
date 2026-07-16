'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { PostList } from '@/components/PostList'
import type { ForumFeedResponse, ForumSort } from '@/lib/forum'
import { parseForumSort } from '@/lib/forum'

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
    { id: 'chat-preview', name: '每日水楼', slug: 'daily-chat', description: null, postCount: 36, isAnnouncement: false },
    { id: 'concert-preview', name: '演唱会讨论', slug: 'concert', description: null, postCount: 18, isAnnouncement: false },
  ],
  selectedBoard: null,
  posts: [],
  pagination: { page: 1, pageSize: 20, total: 0, hasMore: false },
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

  function updateQuery(values: Record<string, string | number | null>) {
    if (previewMode) return
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(values).forEach(([key, value]) => {
      if (value === null || value === '' || value === 1 && key === 'page') next.delete(key)
      else next.set(key, String(value))
    })
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false })
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
    <section className="space-y-4" data-forum-main>
      <header className="rounded-[28px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">EASON FANS CLUB</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">E院广场{data?.selectedBoard ? ` / ${data.selectedBoard.name}` : ''}</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">浏览全部公开分区，筛选、搜索并参与讨论。</p>
          </div>
          {data?.permissions.canCreatePost ? <Link href={createHref} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">发布帖子</Link> : null}
        </div>
        <label className="mt-5 block">
          <span className="sr-only">搜索帖子</span>
          <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="搜索标题和摘要" className="h-11 w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 text-sm font-bold outline-none focus:border-sky-300" />
        </label>
      </header>

      <nav aria-label="论坛分区" className="flex gap-2 overflow-x-auto rounded-[22px] border border-sky-100 bg-white/82 p-3 shadow-sm">
        <button type="button" onClick={() => updateQuery({ board: null, page: null })} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${!board ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>全部</button>
        {(data?.boards || []).map((item) => (
          <button key={item.id} type="button" onClick={() => updateQuery({ board: item.slug, page: null })} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${board === item.slug ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>
            {item.name}<span className="ml-1 opacity-70">{item.postCount}</span>
          </button>
        ))}
      </nav>

      <div className="rounded-[28px] border border-sky-100 bg-white/72 p-3 shadow-sm sm:p-5">
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {sortOptions.map(([value, label]) => <button key={value} type="button" onClick={() => updateQuery({ sort: value === 'latest' ? null : value, page: null })} className={`shrink-0 rounded-full px-4 py-2 text-xs font-black ${sort === value ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'}`}>{label}</button>)}
        </div>
        {loading && !data ? <div className="space-y-3" aria-label="正在加载"><div className="h-36 animate-pulse rounded-2xl bg-sky-50" /><div className="h-36 animate-pulse rounded-2xl bg-sky-50" /></div> : null}
        {error ? <div className="rounded-2xl bg-red-50 p-4 text-sm font-black text-red-600">{error}</div> : null}
        {!error && data ? <PostList posts={data.posts} emptyText={emptyText} onBoardSelect={(slug) => updateQuery({ board: slug, page: null })} /> : null}
        {data && data.pagination.total > data.pagination.pageSize ? (
          <div className="mt-5 flex items-center justify-center gap-3">
            <button type="button" disabled={page <= 1 || loading} onClick={() => updateQuery({ page: page - 1 })} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-40">上一页</button>
            <span className="text-sm font-black text-slate-500">第 {page} 页</span>
            <button type="button" disabled={!data.pagination.hasMore || loading} onClick={() => updateQuery({ page: page + 1 })} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-40">下一页</button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
