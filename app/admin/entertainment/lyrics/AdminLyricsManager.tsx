'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Lyric = {
  id: string
  text: string
  songTitle: string
  albumTitle: string | null
  enabled: boolean
  displayCount: number
  createdAt: string
  updatedAt: string
}

type LyricForm = {
  text: string
  songTitle: string
  albumTitle: string
  enabled: boolean
}

const emptyForm: LyricForm = { text: '', songTitle: '', albumTitle: '', enabled: true }

async function requestData<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.error || '操作失败')
  return payload.data
}

export function AdminLyricsManager() {
  const [lyrics, setLyrics] = useState<Lyric[]>([])
  const [form, setForm] = useState<LyricForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'createdAt' | 'displayCount'>('createdAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ q: query, sort, order })
      const data = await requestData<{ lyrics: Lyric[] }>(`/api/admin/entertainment/lyrics?${params}`)
      setLyrics(data.lyrics)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '歌词处方库加载失败')
    } finally {
      setLoading(false)
    }
  }, [order, query, sort])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
  }, [load])

  function edit(lyric: Lyric) {
    setEditingId(lyric.id)
    setForm({
      text: lyric.text,
      songTitle: lyric.songTitle,
      albumTitle: lyric.albumTitle || '',
      enabled: lyric.enabled,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const text = form.text.trim()
    const songTitle = form.songTitle.trim()
    if (!text || !songTitle) {
      setError('歌词短句和歌曲名称不能为空')
      return
    }
    if (text.length > 80) {
      setError('歌词短句最多 80 个字符')
      return
    }

    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const data = await requestData<{ lyric: Lyric }>(
        editingId ? `/api/admin/entertainment/lyrics/${editingId}` : '/api/admin/entertainment/lyrics',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, text, songTitle, albumTitle: form.albumTitle.trim() }),
        },
      )
      setMessage(editingId ? '歌词处方已保存' : '歌词处方已新增')
      reset()
      setLyrics((current) => editingId
        ? current.map((item) => item.id === data.lyric.id ? data.lyric : item)
        : [data.lyric, ...current])
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggle(lyric: Lyric) {
    setError('')
    try {
      const data = await requestData<{ lyric: Lyric }>(`/api/admin/entertainment/lyrics/${lyric.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: lyric.text,
          songTitle: lyric.songTitle,
          albumTitle: lyric.albumTitle,
          enabled: !lyric.enabled,
        }),
      })
      setLyrics((current) => current.map((item) => item.id === lyric.id ? data.lyric : item))
      setMessage(data.lyric.enabled ? '歌词处方已启用' : '歌词处方已停用')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '状态更新失败')
    }
  }

  async function remove(lyric: Lyric) {
    if (!window.confirm(`确认删除《${lyric.songTitle}》的这条歌词处方吗？`)) return
    if (!window.confirm('删除后无法恢复。请再次确认是否继续。')) return
    setError('')
    try {
      await requestData<{ id: string }>(`/api/admin/entertainment/lyrics/${lyric.id}`, { method: 'DELETE' })
      setLyrics((current) => current.filter((item) => item.id !== lyric.id))
      setMessage('歌词处方已删除')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除失败')
    }
  }

  return (
    <main className="flat-page mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <section className="border border-sky-100 bg-white/85 p-6">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Entertainment CMS</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">歌词处方库</h1>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-600">仅录入单句短歌词。停用内容不会参与新的每日抽奖。</p>
      </section>

      {message ? <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700" role="alert">{error}</p> : null}

      <form onSubmit={submit} className="border border-sky-100 bg-white/85 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-brand-950">{editingId ? '编辑歌词处方' : '新增歌词处方'}</h2>
          {editingId ? <button type="button" onClick={reset} className="border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">取消编辑</button> : null}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-black text-slate-700">
            歌词短句（最多 80 字）
            <textarea required maxLength={80} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} className="min-h-24 border border-sky-100 px-3 py-2 font-medium" />
          </label>
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-black text-slate-700">
              歌曲名称
              <input required maxLength={160} value={form.songTitle} onChange={(event) => setForm({ ...form, songTitle: event.target.value })} className="border border-sky-100 px-3 py-2 font-medium" />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700">
              专辑名称（可选）
              <input maxLength={160} value={form.albumTitle} onChange={(event) => setForm({ ...form, albumTitle: event.target.value })} className="border border-sky-100 px-3 py-2 font-medium" />
            </label>
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm font-black text-slate-700">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          创建后立即启用
        </label>
        <button type="submit" disabled={submitting} className="mt-4 bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
          {submitting ? '保存中…' : editingId ? '保存修改' : '新增处方'}
        </button>
      </form>

      <section className="border border-sky-100 bg-white/85">
        <div className="grid gap-3 border-b border-sky-100 p-4 md:grid-cols-[1fr_auto_auto]">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="border border-sky-100 px-3 py-2 text-sm" placeholder="搜索歌词或歌曲名称" aria-label="搜索歌词或歌曲名称" />
          <select value={sort} onChange={(event) => setSort(event.target.value as 'createdAt' | 'displayCount')} className="border border-sky-100 px-3 py-2 text-sm font-bold" aria-label="排序字段">
            <option value="createdAt">按创建时间</option>
            <option value="displayCount">按展示次数</option>
          </select>
          <select value={order} onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')} className="border border-sky-100 px-3 py-2 text-sm font-bold" aria-label="排序方向">
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </div>
        {loading ? <p className="p-8 text-center text-sm font-bold text-slate-500">正在加载歌词处方…</p> : null}
        {!loading && lyrics.length === 0 ? <p className="p-8 text-center text-sm font-bold text-slate-500">暂无歌词处方，可以从上方新增。</p> : null}
        <div className="divide-y divide-sky-100">
          {lyrics.map((lyric) => (
            <article key={lyric.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-base text-brand-950">《{lyric.songTitle}》</strong>
                  <span className={`border px-2 py-1 text-xs font-black ${lyric.enabled ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>{lyric.enabled ? '已启用' : '已停用'}</span>
                  <span className="text-xs font-bold text-slate-500">累计展示 {lyric.displayCount} 次</span>
                </div>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-700">「{lyric.text}」</p>
                {lyric.albumTitle ? <p className="mt-1 text-xs text-slate-500">专辑：{lyric.albumTitle}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => edit(lyric)} className="border border-sky-200 px-3 py-2 text-xs font-black text-brand-700">编辑</button>
                <button type="button" onClick={() => void toggle(lyric)} className="border border-amber-200 px-3 py-2 text-xs font-black text-amber-700">{lyric.enabled ? '停用' : '启用'}</button>
                <button type="button" onClick={() => void remove(lyric)} className="border border-red-200 px-3 py-2 text-xs font-black text-red-700">删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
