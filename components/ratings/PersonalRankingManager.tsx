'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { MusicCover } from '@/components/music/MusicCover'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { PersonalRankingItemView, PersonalRankingKind, PersonalRankingView, PublicCommentView } from '@/lib/personal-ranking'

type OptionItem = {
  id: string
  title: string
  albumName: string | null
  releaseYear: number
  languageLabel: string
  coverUrl: string | null
  fallbackCoverUrl: string | null
  added: boolean
}

type OptionsResult = { items: OptionItem[]; page: number; total: number; hasMore: boolean }
type CommentsResult = { items: PublicCommentView[]; page: number; pageSize: number; total: number; hasMore: boolean }

const LIMITS: Record<PersonalRankingKind, number> = { SONG: 27, ALBUM: 10 }

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败，请稍后重试')
  return data as T
}

function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function moveItem(items: PersonalRankingItemView[], itemId: string, targetIndex: number) {
  const from = items.findIndex((item) => item.id === itemId)
  if (from < 0) return items
  const bounded = Math.max(0, Math.min(targetIndex, items.length - 1))
  if (from === bounded) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(bounded, 0, item)
  return next.map((entry, index) => ({ ...entry, position: index + 1 }))
}

export function PersonalRankingManager({ type, authenticated }: Readonly<{ type: PersonalRankingKind; authenticated: boolean }>) {
  const limit = LIMITS[type]
  const noun = type === 'SONG' ? '单曲' : '专辑'
  const [items, setItems] = useState<PersonalRankingItemView[]>([])
  const [loading, setLoading] = useState(authenticated)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<OptionsResult | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [commentTarget, setCommentTarget] = useState<PersonalRankingItemView | null>(null)
  const [comments, setComments] = useState<CommentsResult | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const revisionRef = useRef(0)
  const itemsRef = useRef<PersonalRankingItemView[]>([])
  const desiredOrderRef = useRef<string[]>([])
  const orderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orderSavingRef = useRef(false)
  const mountedRef = useRef(true)
  const draggedIdRef = useRef<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applyRanking = useCallback((next: PersonalRankingView) => {
    revisionRef.current = next.revision
    itemsRef.current = next.items
    desiredOrderRef.current = next.items.map((item) => item.id)
    setItems(next.items)
  }, [])

  const loadRanking = useCallback(async () => {
    if (!authenticated) return
    setLoading(true)
    setMessage('')
    try {
      applyRanking(await responseJson<PersonalRankingView>(await fetch(`/api/ratings/personal-ranking?type=${type}`, { cache: 'no-store' })))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载个人榜单失败')
    } finally {
      setLoading(false)
    }
  }, [applyRanking, authenticated, type])

  useEffect(() => {
    mountedRef.current = true
    void loadRanking()
    return () => {
      mountedRef.current = false
      if (orderTimerRef.current) clearTimeout(orderTimerRef.current)
      orderTimerRef.current = null
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [loadRanking])

  useEffect(() => {
    if (!pickerOpen && !commentTarget) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPickerOpen(false)
      setCommentTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [commentTarget, pickerOpen])

  const flushOrder = useCallback(async () => {
    if (orderSavingRef.current || !mountedRef.current) return
    const sentOrder = [...desiredOrderRef.current]
    if (!sentOrder.length && !itemsRef.current.length) return
    orderSavingRef.current = true
    setMessage('正在保存顺序…')
    try {
      const result = await responseJson<PersonalRankingView>(await fetch('/api/ratings/personal-ranking/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, revision: revisionRef.current, items: sentOrder.map((id, index) => ({ id, position: index + 1 })) }),
      }))
      revisionRef.current = result.revision
      if (sameOrder(desiredOrderRef.current, sentOrder)) {
        itemsRef.current = result.items
        setItems(result.items)
        setMessage('顺序已保存')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存顺序失败')
      await loadRanking()
    } finally {
      orderSavingRef.current = false
      if (!sameOrder(desiredOrderRef.current, sentOrder)) {
        if (orderTimerRef.current) clearTimeout(orderTimerRef.current)
        orderTimerRef.current = null
        void flushOrder()
      }
    }
  }, [loadRanking, type])

  function queueOrder(next: PersonalRankingItemView[]) {
    if (busy) return
    itemsRef.current = next
    desiredOrderRef.current = next.map((item) => item.id)
    setItems(next)
    setMessage('顺序待保存…')
    if (orderTimerRef.current) clearTimeout(orderTimerRef.current)
    orderTimerRef.current = setTimeout(() => {
      orderTimerRef.current = null
      void flushOrder()
    }, 240)
  }

  async function waitForOrderIdle() {
    if (orderTimerRef.current) {
      clearTimeout(orderTimerRef.current)
      orderTimerRef.current = null
      void flushOrder()
    }
    while (mountedRef.current && (orderSavingRef.current || orderTimerRef.current)) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  async function loadOptions(nextQuery = query, page = 1, append = false) {
    setPickerLoading(true)
    setMessage('')
    try {
      const params = new URLSearchParams({ type, q: nextQuery, page: String(page) })
      const result = await responseJson<OptionsResult>(await fetch(`/api/ratings/personal-ranking/options?${params}`, { cache: 'no-store' }))
      setOptions((current) => append && current ? { ...result, items: [...current.items, ...result.items] } : result)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载作品失败')
    } finally {
      setPickerLoading(false)
    }
  }

  function openPicker() {
    if (items.length >= limit) return
    setPickerOpen(true)
    setQuery('')
    void loadOptions('', 1)
  }

  async function addItem(targetId: string) {
    if (itemsRef.current.length >= limit || busy) return
    setBusy(true)
    setMessage('')
    try {
      await waitForOrderIdle()
      const result = await responseJson<PersonalRankingView>(await fetch('/api/ratings/personal-ranking/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, targetId }),
      }))
      applyRanking(result)
      setOptions((current) => current ? { ...current, items: current.items.map((item) => item.id === targetId ? { ...item, added: true } : item) } : current)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(item: PersonalRankingItemView) {
    if (!window.confirm(`确认将「${item.title}」移出个人榜单吗？`)) return
    setBusy(true)
    setMessage('')
    try {
      await waitForOrderIdle()
      applyRanking(await responseJson<PersonalRankingView>(await fetch(`/api/ratings/personal-ranking/items/${item.id}`, { method: 'DELETE' })))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '移除失败')
    } finally {
      setBusy(false)
    }
  }

  async function saveNote(itemId: string) {
    setBusy(true)
    setMessage('')
    try {
      await waitForOrderIdle()
      const result = await responseJson<PersonalRankingView>(await fetch(`/api/ratings/personal-ranking/items/${itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: noteDraft }),
      }))
      applyRanking(result)
      setEditingId(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存感想失败')
    } finally {
      setBusy(false)
    }
  }

  async function openComments(item: PersonalRankingItemView) {
    setCommentTarget(item)
    setComments(null)
    setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ type: type === 'SONG' ? 'song' : 'album', targetId: item.targetId, page: '1' })
      setComments(await responseJson<CommentsResult>(await fetch(`/api/ratings/public-comments?${params}`)))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载评价失败')
    } finally {
      setCommentsLoading(false)
    }
  }

  async function loadMoreComments() {
    if (!commentTarget || !comments?.hasMore || commentsLoading) return
    setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ type: type === 'SONG' ? 'song' : 'album', targetId: commentTarget.targetId, page: String(comments.page + 1) })
      const result = await responseJson<CommentsResult>(await fetch(`/api/ratings/public-comments?${params}`))
      setComments({ ...result, items: [...comments.items, ...result.items] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载更多评价失败')
    } finally {
      setCommentsLoading(false)
    }
  }

  function dragOver(itemId: string, event: DragEvent<HTMLElement>) {
    if (busy) return
    const draggedId = draggedIdRef.current
    if (!draggedId || draggedId === itemId) return
    event.preventDefault()
    reorderOverTarget(draggedId, itemId, event.clientY, event.currentTarget.getBoundingClientRect())
  }

  function reorderOverTarget(draggedId: string, targetId: string, clientY: number, rect: DOMRect) {
    const fromIndex = itemsRef.current.findIndex((item) => item.id === draggedId)
    const targetIndex = itemsRef.current.findIndex((item) => item.id === targetId)
    if (fromIndex < 0 || targetIndex < 0) return
    const belowMiddle = clientY >= rect.top + rect.height / 2
    const nextIndex = belowMiddle
      ? targetIndex + (fromIndex > targetIndex ? 1 : 0)
      : targetIndex - (fromIndex < targetIndex ? 1 : 0)
    queueOrder(moveItem(itemsRef.current, draggedId, nextIndex))
  }

  function clearLongPress() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  function beginTouchDrag(itemId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (busy || event.pointerType === 'mouse') return
    clearLongPress()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    longPressTimerRef.current = setTimeout(() => {
      draggedIdRef.current = itemId
      handle.setPointerCapture(pointerId)
      setMessage('拖动到新的位置后松开')
    }, 260)
  }

  function moveTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggedIdRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-ranking-item]')
    const targetId = target?.dataset.rankingItem
    if (!targetId || targetId === draggedIdRef.current) return
    reorderOverTarget(draggedIdRef.current, targetId, event.clientY, target.getBoundingClientRect())
  }

  function finishTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    clearLongPress()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    draggedIdRef.current = null
  }

  if (!authenticated) {
    return <div className="mt-8 border border-dashed border-sky-200 bg-sky-50/60 p-8 text-center"><p className="font-black text-brand-950">登录后建立你的 Top {noun}</p><p className="mt-2 text-sm font-bold text-slate-500">个人榜单默认仅自己可见，不需要先评分。</p><Link href={`/login?next=${encodeURIComponent(`/ratings?view=personal&type=${type === 'SONG' ? 'songs' : 'albums'}`)}`} className="mt-5 inline-flex bg-brand-950 px-5 py-3 text-sm font-black text-white">登录</Link></div>
  }

  return (
    <section className="mt-7 min-w-0" aria-labelledby="personal-ranking-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-sky-100 pb-4">
        <div><h2 id="personal-ranking-title" className="text-2xl font-black text-brand-950">我的 Top {noun}</h2><p className="mt-1 text-xs font-bold text-slate-500">顺序完全由你决定，随时可以修改。</p></div>
        <strong className="text-sm font-black tabular-nums text-brand-700">{items.length} / {limit}</strong>
      </div>
      <button type="button" onClick={openPicker} disabled={loading || busy || items.length >= limit} className="mt-4 min-h-11 border border-brand-300 bg-white px-5 text-sm font-black text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">+ 添加{noun}</button>
      {items.length >= limit ? <p className="mt-2 text-xs font-bold text-amber-700">{type === 'SONG' ? '个人单曲榜最多收录 27 首歌曲' : '个人专辑榜最多收录 10 张专辑'}</p> : null}
      {message ? <p role="status" className="mt-3 text-xs font-bold text-slate-600">{message}</p> : null}
      {loading ? <div className="mt-5 border border-sky-100 bg-white p-8 text-center text-sm font-bold text-slate-500">正在加载个人榜单…</div> : null}
      {!loading && !items.length ? <div className="mt-5 border border-dashed border-sky-200 bg-sky-50/55 p-8 text-center"><p className="font-black text-brand-950">你的 Top {noun}还没有内容</p><p className="mt-2 text-sm font-bold text-slate-500">{type === 'SONG' ? '把真正喜欢的歌放进自己的榜单吧。' : '把真正喜欢的专辑放进自己的榜单吧。'}</p><button type="button" onClick={openPicker} className="mt-5 bg-brand-950 px-5 py-3 text-sm font-black text-white">+ 添加{noun}</button></div> : null}
      {items.length ? <div className="mt-5 space-y-3" onDragEnd={() => { draggedIdRef.current = null }}>
        {items.map((item, index) => <article key={item.id} data-ranking-item={item.id} onDragOver={(event) => dragOver(item.id, event)} className="grid min-w-0 grid-cols-[2.25rem_4.5rem_minmax(0,1fr)_2.75rem] gap-3 border border-sky-100 bg-white p-3 shadow-sm sm:grid-cols-[3rem_5.25rem_minmax(0,1fr)_3rem] sm:gap-4 sm:p-4">
          <span className="pt-1 text-center text-lg font-black tabular-nums text-brand-500">{String(index + 1).padStart(2, '0')}</span>
          <MusicCover src={item.coverUrl} fallbackSrc={item.fallbackCoverUrl} alt={`${item.title}封面`} variant="thumb-sm" className="aspect-square w-full border border-sky-100" sizes="84px" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-brand-950 sm:text-lg">{item.title}</h3>
            {item.albumName ? <p className="mt-1 truncate text-sm font-bold text-slate-600">《{item.albumName}》</p> : null}
            <p className="mt-1 truncate text-xs font-bold text-slate-500">{item.releaseYear} · {item.languageLabel}</p>
            {editingId === item.id ? <div className="mt-3"><label className="text-xs font-black text-slate-700" htmlFor={`note-${item.id}`}>我的感想</label><textarea id={`note-${item.id}`} value={noteDraft} maxLength={1000} onChange={(event) => setNoteDraft(event.target.value)} className="mt-1 min-h-24 w-full resize-y border border-sky-200 p-3 text-sm font-bold leading-6 outline-none focus:border-brand-400" placeholder="写下这部作品对你的意义（可选）" /><p className="mt-1 text-right text-[11px] font-bold text-slate-400">{noteDraft.length} / 1000</p><div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void saveNote(item.id)} className="bg-brand-950 px-3 py-2 text-xs font-black text-white">保存</button><button type="button" onClick={() => setEditingId(null)} className="border border-sky-100 px-3 py-2 text-xs font-black text-slate-600">取消</button></div></div> : item.note ? <button type="button" onClick={() => { setEditingId(item.id); setNoteDraft(item.note || '') }} className="mt-3 block w-full text-left"><span className="block text-xs font-black text-slate-600">我的感想</span><span className="mt-1 block whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-700">{item.note}</span></button> : <button type="button" onClick={() => { setEditingId(item.id); setNoteDraft('') }} className="mt-3 text-xs font-black text-brand-600">+ 写下我的感想</button>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{item.publicCommentCount > 0 ? <button type="button" onClick={() => void openComments(item)} className="text-xs font-black text-brand-700">查看大家的评价 {item.publicCommentCount} &gt;</button> : <span className="text-xs font-bold text-slate-400">暂无公开评价</span>}<button type="button" disabled={busy} onClick={() => void removeItem(item)} className="text-xs font-black text-red-600">移除榜单</button></div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button type="button" draggable={!busy} onDragStart={(event) => { if (busy) { event.preventDefault(); return }; draggedIdRef.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }} onDragEnd={() => { draggedIdRef.current = null }} aria-label={`长按拖动${item.title}`} aria-disabled={busy} onPointerDown={(event) => beginTouchDrag(item.id, event)} onPointerMove={moveTouchDrag} onPointerUp={finishTouchDrag} onPointerCancel={finishTouchDrag} className="grid h-11 w-11 touch-none select-none place-items-center border border-sky-100 text-xl font-black text-slate-500 cursor-grab active:cursor-grabbing disabled:cursor-not-allowed">≡</button>
            <button type="button" disabled={busy || index === 0} onClick={() => queueOrder(moveItem(itemsRef.current, item.id, index - 1))} aria-label={`将${item.title}上移`} className="grid h-9 w-11 place-items-center border border-sky-100 text-sm font-black text-brand-700 disabled:opacity-30">↑</button>
            <button type="button" disabled={busy || index === items.length - 1} onClick={() => queueOrder(moveItem(itemsRef.current, item.id, index + 1))} aria-label={`将${item.title}下移`} className="grid h-9 w-11 place-items-center border border-sky-100 text-sm font-black text-brand-700 disabled:opacity-30">↓</button>
          </div>
        </article>)}
      </div> : null}

      {pickerOpen ? <div className="fixed inset-0 z-[100001] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false) }}><section role="dialog" aria-modal="true" aria-labelledby="ranking-picker-title" className="flex max-h-[calc(100dvh-16px)] w-full max-w-2xl flex-col border border-sky-100 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[85dvh]">
        <header className="flex items-center justify-between border-b border-sky-100 p-4"><div><h2 id="ranking-picker-title" className="text-xl font-black text-brand-950">添加{noun}</h2><p className="mt-1 text-xs font-bold text-slate-500">已收录 {items.length} / {limit}</p></div><button type="button" onClick={() => setPickerOpen(false)} className="grid h-11 w-11 place-items-center text-2xl text-slate-500" aria-label="关闭作品选择器">×</button></header>
        <form className="flex gap-2 border-b border-sky-100 p-4" onSubmit={(event) => { event.preventDefault(); void loadOptions(query, 1) }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={type === 'SONG' ? '搜索歌曲名或所属专辑' : '搜索专辑名'} className="min-w-0 flex-1 border border-sky-200 px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-400" /><button type="submit" className="bg-brand-950 px-4 text-sm font-black text-white">搜索</button></form>
        <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="space-y-2">{options?.items.map((option) => <article key={option.id} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 border border-sky-100 p-3"><MusicCover src={option.coverUrl} fallbackSrc={option.fallbackCoverUrl} alt={`${option.title}封面`} variant="thumb-sm" className="aspect-square w-full border border-sky-100" sizes="64px" /><div className="min-w-0"><h3 className="truncate text-sm font-black text-brand-950">{option.title}</h3>{option.albumName ? <p className="mt-1 truncate text-xs font-bold text-slate-600">《{option.albumName}》</p> : null}<p className="mt-1 text-[11px] font-bold text-slate-500">{option.releaseYear} · {option.languageLabel}</p></div><button type="button" disabled={busy || option.added || items.length >= limit} onClick={() => void addItem(option.id)} className="min-h-10 border border-brand-300 px-3 text-xs font-black text-brand-700 disabled:border-slate-200 disabled:text-slate-400">{option.added ? '已加入' : '+ 加入榜单'}</button></article>)}</div>{pickerLoading ? <p className="py-6 text-center text-sm font-bold text-slate-500">正在加载…</p> : null}{options && !options.items.length && !pickerLoading ? <p className="py-8 text-center text-sm font-bold text-slate-500">没有匹配的作品。</p> : null}{options?.hasMore ? <button type="button" disabled={pickerLoading} onClick={() => void loadOptions(query, options.page + 1, true)} className="mt-4 w-full border border-sky-100 py-3 text-sm font-black text-brand-700">加载更多</button> : null}</div>
      </section></div> : null}

      {commentTarget ? <div className="fixed inset-0 z-[100001] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommentTarget(null) }}><section role="dialog" aria-modal="true" aria-labelledby="public-comments-title" className="flex max-h-[calc(100dvh-16px)] w-full max-w-xl flex-col border border-sky-100 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[80dvh]">
        <header className="flex items-start justify-between border-b border-sky-100 p-4"><div className="min-w-0"><h2 id="public-comments-title" className="truncate text-xl font-black text-brand-950">{commentTarget.title}</h2><p className="mt-1 text-xs font-bold text-slate-500">大家的评价 · {comments?.total ?? commentTarget.publicCommentCount}</p></div><button type="button" onClick={() => setCommentTarget(null)} className="grid h-11 w-11 shrink-0 place-items-center text-2xl text-slate-500" aria-label="关闭评价">×</button></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{comments?.items.map((comment) => <article key={comment.id} className="border-b border-sky-100 py-4 first:pt-0"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-sky-100 bg-sky-50"><SafeAvatar src={comment.author.avatarUrl} name={comment.author.name} uid={comment.author.uid} /></span><strong className="truncate text-sm font-black text-brand-950">{comment.author.name}</strong></div><time className="shrink-0 text-[11px] font-bold text-slate-400" dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-700">{comment.content}</p></article>)}{commentsLoading ? <p className="py-6 text-center text-sm font-bold text-slate-500">正在加载评价…</p> : null}{comments && !comments.items.length && !commentsLoading ? <p className="py-8 text-center text-sm font-bold text-slate-500">暂时还没有公开文字评价。</p> : null}{comments?.hasMore ? <button type="button" disabled={commentsLoading} onClick={() => void loadMoreComments()} className="mt-4 w-full border border-sky-100 py-3 text-sm font-black text-brand-700">加载更多</button> : null}</div>
      </section></div> : null}
    </section>
  )
}
