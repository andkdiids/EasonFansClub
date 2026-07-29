'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ContentImageUploader } from '@/components/ContentImageUploader'

type AlbumOption = { id: string; name: string; releaseYear: number; coverUrl?: string | null }
type Review = {
  id: string
  title: string
  coverUrl?: string | null
  content: string
  images: unknown
  status: 'DRAFT' | 'PUBLISHED'
  likeCount: number
  favoriteCount: number
  updatedAt: string
  MusicAlbum: AlbumOption
}
type ReviewForm = {
  title: string
  albumId: string
  content: string
  images: string[]
  status: Review['status']
}

const empty: ReviewForm = { title: '', albumId: '', content: '', images: [], status: 'DRAFT' }
const field = 'w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-400'

function reviewImages(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function AdminAlbumReviewManager() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [albums, setAlbums] = useState<AlbumOption[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ReviewForm>(empty)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/music/reviews')
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || '专辑鉴赏加载失败')
    setReviews(data.reviews || [])
    setAlbums(data.albums || [])
  }, [])

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : '专辑鉴赏加载失败'))
  }, [load])

  function edit(review: Review) {
    setEditingId(review.id)
    setForm({
      title: review.title,
      albumId: review.MusicAlbum.id,
      content: review.content,
      images: reviewImages(review.images),
      status: review.status,
    })
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setEditingId(null)
    setForm(empty)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(
        editingId ? `/api/admin/music/reviews/${editingId}` : '/api/admin/music/reviews',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, coverUrl: form.images[0] || null }),
        },
      )
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '保存失败')
      setMessage(data.message || '保存成功')
      reset()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(review: Review) {
    if (!window.confirm(`确定删除《${review.title}》吗？`)) return
    const response = await fetch(`/api/admin/music/reviews/${review.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) return setError(data?.message || '删除失败')
    if (editingId === review.id) reset()
    await load()
  }

  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-5">
    <section className="rounded-[30px] border border-sky-100 bg-white/90 p-6 shadow-sm">
      <Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link>
      <h1 className="mt-4 text-4xl font-black text-brand-950">专辑鉴赏管理</h1>
      <p className="mt-2 text-sm font-bold text-slate-500">发布专辑幕后故事、制作资料、歌曲解析与时代背景；本模块不接入评论。</p>
    </section>

    <form onSubmit={save} className="rounded-[30px] border border-sky-100 bg-white/90 p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-black text-brand-950">{editingId ? '编辑鉴赏' : '新增鉴赏'}</h2>
        {editingId ? <button type="button" onClick={reset} className="text-sm font-black text-brand-700">取消编辑</button> : null}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-black text-slate-700">标题
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${field} mt-1`} />
        </label>
        <label className="text-sm font-black text-slate-700">所属专辑
          <select value={form.albumId} onChange={(event) => setForm({ ...form, albumId: event.target.value })} className={`${field} mt-1`}>
            <option value="">请选择专辑</option>
            {albums.map((album) => <option key={album.id} value={album.id}>{album.releaseYear} · {album.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-black text-slate-700">发布状态
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Review['status'] })} className={`${field} mt-1`}>
            <option value="DRAFT">隐藏 / 草稿</option>
            <option value="PUBLISHED">发布</option>
          </select>
        </label>
        <label className="text-sm font-black text-slate-700 sm:col-span-2">正文
          <textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} className={`${field} mt-1 min-h-72 leading-7`} />
        </label>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-black text-slate-700">正文图片（首图同时作为列表封面）</p>
          <ContentImageUploader value={form.images} onChange={(images) => setForm((current) => ({ ...current, images }))} />
        </div>
      </div>
      <button disabled={busy} className="mt-5 rounded-xl bg-brand-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : '保存专辑鉴赏'}</button>
      {message ? <p className="mt-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-black text-red-600" role="alert">{error}</p> : null}
    </form>

    <section className="grid gap-4">
      {reviews.map((review) => <article key={review.id} className="rounded-[24px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-xs font-black text-brand-700">{review.MusicAlbum.releaseYear} · {review.MusicAlbum.name}</p>
          <h2 className="mt-1 break-words text-xl font-black text-brand-950">{review.title}</h2>
          <p className="mt-2 text-xs font-bold text-slate-500">{review.status === 'PUBLISHED' ? '已发布' : '隐藏'} · {reviewImages(review.images).length} 张图片 · {review.likeCount} 赞 · {review.favoriteCount} 收藏</p>
        </div>
        <div className="mt-4 flex gap-2 sm:mt-0">
          <button type="button" onClick={() => edit(review)} className="rounded-lg bg-brand-950 px-4 py-2 text-sm font-black text-white">编辑</button>
          <button type="button" onClick={() => void remove(review)} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-black text-red-700">删除</button>
        </div>
      </article>)}
      {!reviews.length ? <p className="rounded-[24px] border border-sky-100 bg-white/90 p-8 text-sm font-bold text-slate-500">还没有专辑鉴赏。</p> : null}
    </section>
  </main>
}
