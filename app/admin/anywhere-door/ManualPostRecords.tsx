'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ManualRecord = {
  id: string
  caption: string | null
  mediaType: string
  status: string
  publishedAt: string
  createdAt: string
  permalink: string | null
  media: { id: string; type: 'IMAGE' | 'VIDEO'; url: string | null; thumbnailUrl: string | null; sortOrder: number }[]
}

type Payload = { items?: ManualRecord[]; total?: number; page?: number; pageSize?: number; message?: string }

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

export function ManualPostRecords({ refreshVersion, onDeleted }: Readonly<{ refreshVersion: number; onDeleted: () => Promise<void> }>) {
  const [items, setItems] = useState<ManualRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const requestVersionRef = useRef(0)
  const deleteLockRef = useRef(false)

  const load = useCallback(async (targetPage = page) => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/anywhere-door/posts/manual?page=${targetPage}`, { cache: 'no-store', credentials: 'same-origin' })
      const payload = await response.json().catch(() => null) as Payload | null
      if (!response.ok) throw new Error(payload?.message || '手动补录记录加载失败')
      if (requestVersion !== requestVersionRef.current) return
      setItems(payload?.items || [])
      setTotal(payload?.total || 0)
      setPage(payload?.page || targetPage)
      setPageSize(payload?.pageSize || 20)
    } catch (caught) {
      if (requestVersion !== requestVersionRef.current) return
      setError(caught instanceof Error ? caught.message : '手动补录记录加载失败')
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [page])

  useEffect(() => { void load() }, [load, refreshVersion])

  async function deleteRecord(id: string) {
    if (deleteLockRef.current) return
    deleteLockRef.current = true
    setDeletingId(id)
    setError('')
    try {
      const response = await fetch(`/api/admin/anywhere-door/posts/manual/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'same-origin',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '删除失败，请刷新记录后确认状态')
      setConfirmId(null)
      const nextTotal = Math.max(0, total - 1)
      const nextPage = Math.max(1, Math.min(page, Math.ceil(nextTotal / pageSize) || 1))
      setItems((current) => current.filter((item) => item.id !== id))
      setTotal(nextTotal)
      if (nextPage !== page) setPage(nextPage)
      else await load(nextPage)
      try {
        await onDeleted()
      } catch {
        setError('内容已删除，但动态总列表刷新失败；请稍后刷新页面。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败，请刷新记录后确认状态')
    } finally {
      deleteLockRef.current = false
      setDeletingId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7" aria-labelledby="manual-post-records-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">补录历史</p>
          <h2 id="manual-post-records-title" className="mt-2 text-xl font-black text-brand-950">手动补录记录</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">按实际补录时间排列；公开随意门仍按原始发布时间展示。</p>
        </div>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">共 {total} 条</span>
      </div>
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{error}</p> : null}
      {loading ? <p className="py-8 text-center text-sm font-bold text-slate-400">记录加载中…</p> : items.length ? <div className="mt-4 space-y-3">
        {items.map((item) => <article key={item.id} className="rounded-2xl border border-sky-100 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6 text-brand-950">{item.caption || '（无正文）'}</p>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs font-bold text-slate-500 sm:grid-cols-2">
                <div><dt className="inline">媒体类型：</dt><dd className="inline text-slate-700">{item.mediaType}</dd></div>
                <div><dt className="inline">状态：</dt><dd className="inline text-slate-700">{item.status}</dd></div>
                <div><dt className="inline">原始发布时间：</dt><dd className="inline text-slate-700">{formatTime(item.publishedAt)}</dd></div>
                <div><dt className="inline">实际补录时间：</dt><dd className="inline text-slate-700">{formatTime(item.createdAt)}</dd></div>
                <div className="break-all sm:col-span-2"><dt className="inline">SocialPost ID：</dt><dd className="inline text-slate-700">{item.id}</dd></div>
              </dl>
              {item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-xs font-black text-brand-700 underline">查看原文</a> : null}
            </div>
            <button type="button" disabled={Boolean(deletingId)} onClick={() => setConfirmId(item.id)} className="min-h-10 shrink-0 rounded-full border border-red-200 px-4 text-xs font-black text-red-700 hover:bg-red-50 disabled:opacity-50">删除</button>
          </div>
          {item.media.length ? <ol className="mt-3 flex flex-wrap gap-2" aria-label="补录媒体预览">
            {item.media.map((media) => <li key={media.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
              {media.url ? media.type === 'VIDEO'
                ? <video src={media.url} controls preload="metadata" className="h-24 w-32 object-contain" aria-label="补录视频预览" />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={media.thumbnailUrl || media.url} alt="补录图片预览" className="h-24 w-32 object-cover" />
                : <span className="grid h-24 w-32 place-items-center text-xs font-bold text-white">预览不可用</span>}
              <p className="bg-white px-2 py-1 text-[10px] font-black text-slate-600">{media.type} · 顺序 {media.sortOrder + 1}</p>
            </li>)}
          </ol> : <p className="mt-3 text-xs font-bold text-slate-400">纯文字动态</p>}
          {confirmId === item.id ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="presentation">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby={`delete-manual-post-${item.id}`}>
              <h3 id={`delete-manual-post-${item.id}`} className="text-base font-black text-brand-950">确认删除这条手动补录内容？删除后前台将不再显示。</h3>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={deletingId === item.id} onClick={() => setConfirmId(null)} className="min-h-10 rounded-full border border-slate-200 px-4 text-sm font-black text-slate-700 disabled:opacity-50">取消</button>
                <button type="button" disabled={deletingId === item.id} onClick={() => void deleteRecord(item.id)} className="min-h-10 rounded-full bg-red-700 px-4 text-sm font-black text-white disabled:opacity-50">{deletingId === item.id ? '正在删除…' : '确认删除'}</button>
              </div>
            </div>
          </div> : null}
        </article>)}
        <div className="flex items-center justify-between pt-2 text-sm font-bold text-slate-600">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 rounded-full border border-slate-200 px-4 disabled:opacity-40">上一页</button>
          <span>第 {page} / {totalPages} 页</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} className="min-h-10 rounded-full border border-slate-200 px-4 disabled:opacity-40">下一页</button>
        </div>
      </div> : <p className="py-8 text-center text-sm font-bold text-slate-400">暂无手动补录记录。</p>}
    </section>
  )
}
