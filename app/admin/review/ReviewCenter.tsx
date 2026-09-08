'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import {
  parseReviewSourceType,
  reviewSourceDefinitions,
  reviewSourceLabel,
  type ReviewDecision,
  type ReviewItem,
  type ReviewSourceType,
  type ReviewStatus,
} from '@/lib/review-center'

type Filter = ReviewStatus | 'ALL'
const REVIEW_PAGE_SIZE = 40
type ReviewResponse = {
  items?: ReviewItem[]
  page?: number
  pageSize?: number
  total?: number
  hasMore?: boolean
  types?: Array<{ type: ReviewSourceType; label: string; total: number; pending: number; approved: number; rejected: number }>
  counts?: { total: number; pending: number; approved: number; rejected: number }
  targetFound?: boolean
  message?: string
}

const statusLabels: Record<Filter, string> = { ALL: '全部状态', PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过' }

function queryType(type: ReviewSourceType | 'ALL') {
  if (type === 'ALL') return 'ALL'
  return reviewSourceDefinitions.find((item) => item.type === type)?.queryValues[0] || type.toLowerCase()
}

function statusLabel(status: ReviewItem['status']) {
  return statusLabels[status]
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function ReviewCenter({ initialType, initialTargetId = '' }: Readonly<{ initialType: string; initialTargetId?: string }>) {
  const parsedInitialType = parseReviewSourceType(initialType)
  const [type, setType] = useState<ReviewSourceType | 'ALL'>(parsedInitialType)
  const [status, setStatus] = useState<Filter>(initialTargetId ? 'ALL' : 'PENDING')
  const [keyword, setKeyword] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [focusTargetId, setFocusTargetId] = useState(initialTargetId.trim())
  const [items, setItems] = useState<ReviewItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [types, setTypes] = useState<ReviewResponse['types']>([])
  const [counts, setCounts] = useState<ReviewResponse['counts']>({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ReviewItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [targetMessage, setTargetMessage] = useState('')
  const [postBoardById, setPostBoardById] = useState<Record<string, string>>({})

  const load = useCallback(async (nextType = type, nextStatus = status, nextKeyword = keyword, nextTargetId = focusTargetId) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ type: queryType(nextType), status: nextStatus, page: '1' })
      if (nextKeyword.trim()) params.set('keyword', nextKeyword.trim())
      if (nextTargetId.trim()) params.set('targetId', nextTargetId.trim())
      const response = await fetch(`/api/admin/review?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as ReviewResponse | null
      if (!response.ok) throw new Error(data?.message || '审核列表加载失败')
      setItems(Array.isArray(data?.items) ? data.items : [])
      setHasMore(Boolean(data?.hasMore))
      setTypes(Array.isArray(data?.types) ? data.types : [])
      setCounts(data?.counts || { total: 0, pending: 0, approved: 0, rejected: 0 })
      setTargetMessage(nextTargetId.trim() ? (data?.targetFound ? '已定位通知对应的审核内容。' : '通知对应的审核内容已不存在或暂时无法定位。') : '')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审核列表加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [focusTargetId, keyword, status, type])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!focusTargetId || loading) return
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-review-target="${CSS.escape(focusTargetId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusTargetId, items, loading])

  function clearTargetFocus() {
    setFocusTargetId('')
    setTargetMessage('')
  }

  async function decide(item: ReviewItem, decision: ReviewDecision, reason = '') {
    setBusyId(`${item.sourceType}:${item.sourceId}`)
    setError('')
    setMessage('')
    try {
      const selectedPostBoardId = item.postDetails ? postBoardById[item.sourceId] || item.postDetails.boardId : null
      const boardChanged = decision === 'APPROVE' && item.postDetails && selectedPostBoardId !== item.postDetails.boardId
      const response = await fetch('/api/admin/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          decision,
          rejectReason: reason,
          ...(boardChanged && selectedPostBoardId ? { boardId: selectedPostBoardId } : {}),
        }),
      })
      const data = await response.json().catch(() => null) as { message?: string; code?: string } | null
      if (!response.ok) {
        setError(data?.message || '审核操作失败，请刷新后重试')
        // A 409 is a committed state change by another administrator. Reload
        // immediately so the card shows the final server state, never an
        // optimistic APPROVED value.
        if (data?.code === 'REVIEW_CONFLICT_REJECT_WINS') {
          setStatus('REJECTED')
          await load(type, 'REJECTED', keyword)
        } else {
          await load()
        }
        return
      }
      setMessage(decision === 'APPROVE' ? '已通过，列表已按服务端最终状态刷新。' : '已拒绝，列表已按服务端最终状态刷新。')
      await load()
    } catch {
      setError('网络错误，请刷新后重试')
    } finally {
      setBusyId(null)
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return
    setLoading(true)
    setError('')
    try {
      const nextPage = Math.floor(items.length / REVIEW_PAGE_SIZE) + 1
      const params = new URLSearchParams({ type: queryType(type), status, page: String(nextPage) })
      if (keyword.trim()) params.set('keyword', keyword.trim())
      const response = await fetch(`/api/admin/review?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as ReviewResponse | null
      if (!response.ok) throw new Error(data?.message || '更多审核列表加载失败')
      setItems((current) => [...current, ...(Array.isArray(data?.items) ? data.items : [])])
      setHasMore(Boolean(data?.hasMore))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更多审核列表加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function remove(item: ReviewItem) {
    if (!window.confirm(`确定删除「${item.title}」吗？删除后无法恢复。`)) return
    setBusyId(`${item.sourceType}:${item.sourceId}`)
    setError('')
    setMessage('')
    try {
      const params = new URLSearchParams({ sourceType: queryType(item.sourceType), sourceId: item.sourceId })
      const response = await fetch(`/api/admin/review?${params.toString()}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '删除失败，请刷新后重试')
      setMessage('已删除，列表已按服务端最终状态刷新。')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败，请刷新后重试')
    } finally {
      setBusyId(null)
    }
  }

  function openReject(item: ReviewItem) {
    setRejectTarget(item)
    setRejectReason(item.rejectReason || '')
    setError('')
  }

  const typeTabs = useMemo(() => types || [], [types])
  const busy = Boolean(busyId)

  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-5 px-4 py-7 sm:px-5 sm:py-9">
    <section className="border border-sky-100 bg-white/95 p-5 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Unified moderation</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">审核中心</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">统一查看帖子、沙龙、创作平台和其他投稿；每次操作都等待服务端确认后刷新最终状态。</p>
        </div>
        <div className="grid min-w-[180px] grid-cols-2 gap-2 text-center sm:min-w-[260px]">
          <div className="border border-amber-100 bg-amber-50 p-3"><strong className="block text-2xl font-black text-amber-800">{counts?.pending || 0}</strong><span className="text-xs font-black text-amber-700">{type === 'ALL' ? '全部待审核' : '当前类型待审核'}</span></div>
          <div className="border border-sky-100 bg-sky-50 p-3"><strong className="block text-2xl font-black text-brand-800">{counts?.total || 0}</strong><span className="text-xs font-black text-brand-700">当前类型总数</span></div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="审核类型">
        <button type="button" role="tab" aria-selected={type === 'ALL'} onClick={() => { clearTargetFocus(); setType('ALL') }} className={`rounded-full px-4 py-2 text-sm font-black ${type === 'ALL' ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>全部 <span className="ml-1 text-xs opacity-70">{counts?.total || 0}</span></button>
        {typeTabs.map((tab) => <button type="button" role="tab" key={tab.type} aria-selected={type === tab.type} onClick={() => { clearTargetFocus(); setType(tab.type) }} className={`rounded-full px-4 py-2 text-sm font-black ${type === tab.type ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{tab.label} <span className="ml-1 text-xs opacity-70">{tab.pending}</span></button>)}
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="审核状态">
        {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as Filter[]).map((value) => <button type="button" role="tab" key={value} aria-selected={status === value} onClick={() => { clearTargetFocus(); setStatus(value) }} className={`rounded-full px-3 py-1.5 text-xs font-black ${status === value ? 'bg-sky-200 text-brand-950' : 'bg-slate-50 text-slate-600'}`}>{statusLabels[value]}{value === 'PENDING' ? ` ${counts?.pending || 0}` : ''}</button>)}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { clearTargetFocus(); setKeyword(searchInput.trim()) } }} placeholder="搜索标题 / 作者 / UID / 内容摘要" className="min-h-10 min-w-[220px] flex-1 border border-sky-100 bg-white px-3 text-sm font-bold text-brand-950 outline-none focus:border-brand-500" />
        <button type="button" onClick={() => { clearTargetFocus(); setKeyword(searchInput.trim()) }} disabled={loading} className="min-h-10 bg-brand-950 px-4 text-sm font-black text-white disabled:opacity-50">搜索</button>
        {keyword ? <button type="button" onClick={() => { clearTargetFocus(); setSearchInput(''); setKeyword('') }} className="min-h-10 bg-sky-50 px-4 text-sm font-black text-brand-700">清除</button> : null}
      </div>
    </section>

    {message ? <p role="status" className="border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-800">{message}</p> : null}
    {error ? <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm font-black text-red-800">{error}</p> : null}
    {targetMessage ? <p role="status" className="border border-sky-200 bg-sky-50 p-3 text-sm font-black text-brand-800">{targetMessage}</p> : null}

    <section aria-busy={loading || busy} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-black text-brand-950">{type === 'ALL' ? '全部审核事项' : `${reviewSourceLabel(type)}审核`}</h2><span className="text-sm font-black text-slate-500">{loading ? '加载中…' : `${items.length} 条`}</span></div>
      {items.map((item) => <ReviewCard
        key={`${item.sourceType}:${item.sourceId}`}
        item={item}
        focused={Boolean(focusTargetId && item.sourceId === focusTargetId)}
        busy={busyId === `${item.sourceType}:${item.sourceId}`}
        selectedBoardId={item.postDetails ? postBoardById[item.sourceId] || item.postDetails.boardId : null}
        onBoardChange={item.postDetails ? (boardId) => setPostBoardById((current) => ({ ...current, [item.sourceId]: boardId })) : undefined}
        onApprove={() => void decide(item, 'APPROVE')}
        onReject={() => openReject(item)}
        onDelete={() => void remove(item)}
      />)}
      {hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loading || busy} className="mx-auto block min-h-10 border border-sky-200 bg-white px-5 text-sm font-black text-brand-700 disabled:opacity-50">{loading ? '加载中…' : '加载更多'}</button> : null}
      {!loading && !items.length ? <div className="border border-dashed border-sky-200 bg-white/80 p-10 text-center text-sm font-bold text-slate-500">当前筛选下暂无审核事项。</div> : null}
    </section>

    {rejectTarget ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRejectTarget(null) }}><section role="dialog" aria-modal="true" aria-labelledby="review-reject-title" className="w-full max-w-lg border border-red-100 bg-white p-5 shadow-2xl sm:p-7"><h2 id="review-reject-title" className="text-xl font-black text-brand-950">拒绝「{rejectTarget.title}」</h2><p className="mt-2 text-sm font-bold text-slate-500">拒绝原因会保存到对应业务模块，并展示给作者。</p><textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={2000} rows={5} className="mt-4 w-full border border-slate-200 p-3 text-sm font-bold outline-none focus:border-red-400" placeholder="请输入拒绝原因" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRejectTarget(null)} className="min-h-10 bg-slate-100 px-4 text-sm font-black text-slate-600">取消</button><button type="button" disabled={!rejectReason.trim() || busy} onClick={() => { const target = rejectTarget; setRejectTarget(null); void decide(target, 'REJECT', rejectReason.trim()) }} className="min-h-10 bg-red-700 px-4 text-sm font-black text-white disabled:opacity-50">确认拒绝</button></div></section></div> : null}
  </main>
}

function ReviewCard({ item, busy, focused, selectedBoardId, onBoardChange, onApprove, onReject, onDelete }: Readonly<{
  item: ReviewItem
  busy: boolean
  focused: boolean
  selectedBoardId: string | null
  onBoardChange?: (boardId: string) => void
  onApprove: () => void
  onReject: () => void
  onDelete: () => void
}>) {
  const mediaItems = item.media?.length
    ? item.media
    : item.cover
      ? [{ id: `${item.sourceType}:${item.sourceId}:cover`, src: item.cover, alt: `${item.title}图片` }]
      : []
  const primaryMedia = mediaItems[0]
  const boardSelection = selectedBoardId || item.postDetails?.boardId || ''
  const boardChanged = Boolean(item.postDetails && boardSelection !== item.postDetails.boardId)
  return <article data-review-source={item.sourceType} data-review-target={item.sourceId} className={`grid gap-4 border border-sky-100 bg-white/95 p-4 shadow-sm sm:p-5 lg:grid-cols-[96px_minmax(0,1fr)_auto] lg:items-start ${focused ? 'ring-2 ring-amber-300 ring-offset-2' : ''}`}>
    <div className="flex h-24 w-24 items-center justify-center overflow-hidden border border-sky-100 bg-sky-50/50">
      {primaryMedia ? <div className="h-full w-full" aria-label={`${reviewSourceLabel(item.sourceType)}图片，共 ${mediaItems.length} 张`}>
        <ImageViewer
          src={primaryMedia.src}
          previewSrc={primaryMedia.previewSrc}
          alt={primaryMedia.alt}
          gallery={mediaItems}
          imageClassName="h-full w-full object-cover"
          buttonClassName="block h-full w-full cursor-zoom-in overflow-hidden text-left"
        />
      </div> : <span className="px-2 text-center text-xs font-black text-sky-700">{item.sourceType === 'POST' ? '帖子' : item.sourceType === 'SALON' ? '沙龙' : '审核项'}</span>}
    </div>
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><span className="bg-sky-50 px-2 py-1 text-[10px] font-black text-brand-700">{reviewSourceLabel(item.sourceType)}</span><span className={`px-2 py-1 text-[10px] font-black ${item.status === 'PENDING' ? 'bg-amber-50 text-amber-800' : item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{statusLabel(item.status)}</span><h3 className="min-w-0 break-words text-lg font-black text-brand-950">{item.title}</h3></div>
      <p className="mt-2 text-xs font-bold text-slate-500">作者：{item.author.name}{item.author.uid !== null ? `（UID ${item.author.uid}）` : ''} · 提交于 {formatDate(item.createdAt)}</p>
      {item.postDetails ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-black text-slate-600">
        <span>投稿分区：<span className="text-brand-700">{item.postDetails.boardName}</span></span>
        {item.actions.approve ? <label className="flex items-center gap-1.5">发布分区：
          <select value={boardSelection} disabled={busy} onChange={(event) => onBoardChange?.(event.target.value)} className="max-w-56 rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs font-black text-brand-950 outline-none focus:border-brand-500 disabled:opacity-60">
            {item.postDetails.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select>
        </label> : null}
        {boardChanged ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">已调整分区：{item.postDetails.boardName} → {item.postDetails.boards.find((board) => board.id === boardSelection)?.name || boardSelection}</span> : null}
      </div> : null}
      <p className="mt-2 break-words text-sm leading-6 text-slate-600">{item.summary || '暂无摘要'}</p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-400">{item.category ? <span>{item.category}</span> : null}{item.relatedEntity ? <span>{item.relatedEntity}</span> : null}<span>最终审核：{formatDate(item.reviewedAt)}</span>{item.reviewer ? <span>审核人：{item.reviewer.name}</span> : null}</p>
      {item.rejectReason ? <p className="mt-2 break-words border-l-2 border-red-300 pl-2 text-xs font-bold text-red-700">拒绝原因：{item.rejectReason}</p> : null}
    </div>
    <div className="flex flex-wrap gap-2 lg:w-28 lg:flex-col">
      {item.actions.detailUrl ? <Link href={item.actions.detailUrl} className="min-h-9 border border-sky-200 px-3 py-2 text-center text-xs font-black text-brand-700 hover:bg-sky-50">查看详情</Link> : null}
      {item.actions.edit && item.actions.detailUrl ? <Link href={item.actions.detailUrl} className="min-h-9 border border-slate-200 px-3 py-2 text-center text-xs font-black text-slate-600">修改资料</Link> : null}
      {item.actions.reject ? <button type="button" onClick={onReject} disabled={busy} className="min-h-9 border border-red-200 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50">拒绝</button> : null}
      {item.actions.approve ? <button type="button" onClick={onApprove} disabled={busy} className="min-h-9 bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">通过</button> : null}
      {item.actions.delete ? <button type="button" onClick={onDelete} disabled={busy} className="min-h-9 border border-red-300 px-3 py-2 text-xs font-black text-red-800 disabled:opacity-50">删除</button> : null}
    </div>
  </article>
}
