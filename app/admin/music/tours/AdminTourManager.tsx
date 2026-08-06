'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MusicCoverUploader } from '@/app/admin/music/MusicCoverUploader'
import { generateArchiveSlug } from '@/lib/music-slug'
import type { ConcertCategoryConfig } from '@/lib/music-concert-category'

type ConcertCategory = 'MAIN' | 'SMALL' | 'GUEST'
type Tour = { id: string; name: string; subtitle?: string | null; description?: string | null; posterUrl?: string | null; startDate?: string | null; endDate?: string | null; category: ConcertCategory; categoryId?: string | null; status: 'DRAFT' | 'PUBLISHED'; sortOrder: number; concertCount: number }
type TourForm = { name: string; subtitle: string; description: string; coverUrl: string; startDate: string; endDate: string; category: ConcertCategory; categoryId: string; status: Tour['status']; sortOrder: string }
const categoryLabels: Record<ConcertCategory, string> = { MAIN: '大型演唱会', SMALL: '小型企划', GUEST: '嘉宾现场' }
const empty: TourForm = { name: '', subtitle: '', description: '', coverUrl: '', startDate: '', endDate: '', category: 'MAIN', categoryId: '', status: 'DRAFT', sortOrder: '0' }
const field = 'w-full border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-400'

// 根据选中的分类 id 推导兼容枚举值（非核心分类回退 MAIN）。
function enumFromCategory(categories: ConcertCategoryConfig[], id: string): ConcertCategory {
  const selected = categories.find((category) => category.id === id)
  if (!selected) return 'MAIN'
  if (selected.slug === 'small') return 'SMALL'
  if (selected.slug === 'guest') return 'GUEST'
  return 'MAIN'
}

export function AdminTourManager({ categories }: { categories: ConcertCategoryConfig[] }) {
  const [tours, setTours] = useState<Tour[]>([])
  const [form, setForm] = useState<TourForm>(() => ({ ...empty, categoryId: categories[0]?.id ?? '' }))
  const [editing, setEditing] = useState<Tour | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resetForm = useCallback(() => setForm({ ...empty, categoryId: categories[0]?.id ?? '' }), [categories])
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/music/tours')
    const data = await response.json().catch(() => null)
    if (response.ok) setTours(data.tours || [])
    else setError(data?.message || '巡演加载失败')
  }, [])
  useEffect(() => { void load() }, [load])

  function edit(tour: Tour) {
    setEditing(tour)
    setForm({ name: tour.name, subtitle: tour.subtitle || '', description: tour.description || '', coverUrl: tour.posterUrl || '', startDate: tour.startDate?.slice(0, 10) || '', endDate: tour.endDate?.slice(0, 10) || '', category: tour.category, categoryId: tour.categoryId ?? categories[0]?.id ?? '', status: tour.status, sortOrder: String(tour.sortOrder) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    const categoryId = form.categoryId || categories[0]?.id || ''
    const body = { ...form, categoryId, category: enumFromCategory(categories, categoryId) }
    const response = await fetch(editing ? `/api/admin/music/tours/${editing.id}` : '/api/admin/music/tours', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '保存失败')
    else { setMessage(data.message); setEditing(null); resetForm(); await load() }
    setBusy(false)
  }

  async function remove(tour: Tour) {
    if (!window.confirm(`确定删除巡演“${tour.name}”吗？有关联场次时系统会拒绝删除。`)) return
    const response = await fetch(`/api/admin/music/tours/${tour.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '删除失败')
    else { setMessage(data.message); await load() }
  }

  return <main className="admin-mobile-page mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-5">
    <section className="border border-sky-100 bg-white/90 p-6 shadow-sm"><Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link><h1 className="mt-4 text-4xl font-black text-brand-950">巡演管理</h1><p className="mt-2 text-sm font-bold text-slate-500">维护 Eason in Concert 的巡演档案、发布状态与顺序。</p></section>
    {message ? <p role="status" className="bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
    <form onSubmit={save} className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black text-brand-950">{editing ? `编辑：${editing.name}` : '创建巡演'}</h2>{editing ? <button type="button" onClick={() => { setEditing(null); resetForm() }} className="text-sm font-black text-slate-500">取消编辑</button> : null}</div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-black text-slate-700">巡演名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black text-slate-700">副标题<input value={form.subtitle} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black text-slate-700">开始日期<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black text-slate-700">结束日期<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black text-slate-700">演唱会分类<select value={form.categoryId} onChange={(event) => {
          const id = event.target.value
          setForm({ ...form, categoryId: id, category: enumFromCategory(categories, id) })
        }} className={`${field} mt-1`}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="text-sm font-black text-slate-700">发布状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Tour['status'] })} className={`${field} mt-1`}><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option></select></label>
        <label className="text-sm font-black text-slate-700">排序<input type="number" min="0" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black text-slate-700 sm:col-span-2">巡演介绍<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`${field} mt-1 min-h-32`} /></label>
      </div>
      <button disabled={busy} className="mt-5 bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : '保存巡演'}</button>
      {editing ? <div className="mt-6"><MusicCoverUploader entityType="tour" entityId={editing.id} currentUrl={form.coverUrl || editing.posterUrl} onUploaded={(url) => { setForm((current) => ({ ...current, coverUrl: url })); setEditing((current) => current ? { ...current, posterUrl: url } : current); setTours((current) => current.map((tour) => tour.id === editing.id ? { ...tour, posterUrl: url } : tour)); void load() }} /></div> : <p className="mt-3 text-xs font-bold text-slate-500">创建后点击编辑，即可复用现有 WebP 流程上传海报。</p>}
    </form>
    <section className="overflow-x-auto border border-sky-100 bg-white/90 shadow-sm">
      <table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-sky-50 text-xs font-black text-brand-950"><tr>{['海报','巡演名称','分类','时间','场次','状态','排序','操作'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
        {tours.map((tour) => <tr key={tour.id} className="border-t border-sky-100"><td className="p-3"><span className="relative block h-16 w-12 bg-sky-50">{tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}海报`} fill sizes="48px" className="object-cover" /> : null}</span></td><td className="max-w-64 p-3"><strong className="block break-words text-brand-950">{tour.name}</strong><span className="text-xs text-slate-500">{tour.subtitle}</span></td><td className="p-3"><span className="whitespace-nowrap bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{categories.find((category) => category.id === tour.categoryId)?.name || categoryLabels[tour.category]}</span></td><td className="p-3 text-xs">{tour.startDate?.slice(0,10) || '—'}<br />{tour.endDate?.slice(0,10) || '—'}</td><td className="p-3">{tour.concertCount}</td><td className="p-3"><span>{tour.status === 'PUBLISHED' ? '已发布' : '草稿'}</span></td><td className="p-3">{tour.sortOrder}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Link href={`/music/live/tours/${generateArchiveSlug(tour.name)}?preview=1`} className="bg-emerald-50 px-3 py-2 font-black text-emerald-700">查看</Link><button type="button" onClick={() => edit(tour)} className="bg-sky-50 px-3 py-2 font-black text-brand-700">编辑</button><button type="button" onClick={() => void remove(tour)} className="bg-red-50 px-3 py-2 font-black text-red-700">删除</button></div></td></tr>)}
      </tbody></table>
      {!tours.length ? <p className="p-6 text-sm font-bold text-slate-500">暂无巡演。</p> : null}
    </section>
  </main>
}
