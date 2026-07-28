'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type Tour = { id: string; name: string }
type Concert = { id: string; concertDate: string; city: string; venue?: string | null; sessionNumber?: string | null; status: 'DRAFT' | 'PUBLISHED'; tour: Tour; setlistCount: number; highlightCount: number }
const empty = { tourId: '', concertDate: '', city: '', countryOrRegion: '', venue: '', sessionNumber: '', title: '', description: '', status: 'DRAFT', sortOrder: '0' }
const field = 'w-full border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-400'

export function AdminConcertManager() {
  const router = useRouter()
  const [tours, setTours] = useState<Tour[]>([])
  const [concerts, setConcerts] = useState<Concert[]>([])
  const [form, setForm] = useState(empty)
  const [filters, setFilters] = useState({ tourId: '', year: '', city: '', status: '', q: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loadTours = useCallback(async () => {
    const response = await fetch('/api/admin/music/tours'); const data = await response.json().catch(() => null)
    if (response.ok) setTours((data.tours || []).map((tour: Tour) => ({ id: tour.id, name: tour.name })))
  }, [])
  const loadConcerts = useCallback(async () => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
    const response = await fetch(`/api/admin/music/concerts?${query}`); const data = await response.json().catch(() => null)
    if (response.ok) setConcerts(data.concerts || []); else setError(data?.message || '场次加载失败')
  }, [filters])
  useEffect(() => { void loadTours() }, [loadTours])
  useEffect(() => { void loadConcerts() }, [loadConcerts])

  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    const response = await fetch('/api/admin/music/concerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await response.json().catch(() => null)
    if (!response.ok) { setError(data?.message || '创建失败'); setBusy(false); return }
    router.push(`/admin/music/concerts/${data.concert.id}`)
  }
  async function remove(concert: Concert) {
    if (!window.confirm(`确定删除 ${concert.city} ${concert.concertDate.slice(0,10)} 场次吗？其歌单和特别时刻会一并删除。`)) return
    const response = await fetch(`/api/admin/music/concerts/${concert.id}`, { method: 'DELETE' }); const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '删除失败'); else await loadConcerts()
  }
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5">
    <section className="border border-sky-100 bg-white/90 p-6 shadow-sm"><Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link><h1 className="mt-4 text-4xl font-black text-brand-950">演唱会管理</h1></section>
    {error ? <p role="alert" className="bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
    <form onSubmit={create} className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7"><h2 className="text-2xl font-black text-brand-950">创建场次草稿</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm font-black text-slate-700">所属巡演<select required value={form.tourId} onChange={(event) => setForm({ ...form, tourId: event.target.value })} className={`${field} mt-1`}><option value="">请选择</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
      <label className="text-sm font-black text-slate-700">演出日期<input required type="date" value={form.concertDate} onChange={(event) => setForm({ ...form, concertDate: event.target.value })} className={`${field} mt-1`} /></label>
      <label className="text-sm font-black text-slate-700">城市<input required value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={`${field} mt-1`} /></label>
      <label className="text-sm font-black text-slate-700">场馆<input value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })} className={`${field} mt-1`} /></label>
      <label className="text-sm font-black text-slate-700">国家或地区<input value={form.countryOrRegion} onChange={(event) => setForm({ ...form, countryOrRegion: event.target.value })} className={`${field} mt-1`} /></label>
      <label className="text-sm font-black text-slate-700">场次编号<input value={form.sessionNumber} onChange={(event) => setForm({ ...form, sessionNumber: event.target.value })} className={`${field} mt-1`} /></label>
      <label className="text-sm font-black text-slate-700">自定义标题<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${field} mt-1`} /></label>
      <label className="text-sm font-black text-slate-700">排序<input type="number" min="0" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} className={`${field} mt-1`} /></label>
    </div><button disabled={busy} className="mt-5 bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '创建中…' : '创建并编辑歌单'}</button></form>
    <section className="border border-sky-100 bg-white/90 p-4 shadow-sm"><h2 className="text-xl font-black text-brand-950">筛选场次</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><select aria-label="按巡演筛选" value={filters.tourId} onChange={(event) => setFilters({ ...filters, tourId: event.target.value })} className={field}><option value="">全部巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select><input aria-label="按年份筛选" type="number" placeholder="年份" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} className={field} /><input aria-label="按城市筛选" placeholder="城市" value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })} className={field} /><select aria-label="按发布状态筛选" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={field}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option></select><input aria-label="关键词筛选" placeholder="标题、场馆、巡演" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} className={field} /></div></section>
    <section className="overflow-x-auto border border-sky-100 bg-white/90"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-sky-50 text-xs font-black"><tr>{['日期','城市','场馆','所属巡演','场次编号','歌单','特别时刻','状态','操作'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{concerts.map((concert) => <tr key={concert.id} className="border-t border-sky-100"><td className="p-3">{concert.concertDate.slice(0,10)}</td><td className="p-3 font-black">{concert.city}</td><td className="max-w-52 break-words p-3">{concert.venue || '—'}</td><td className="max-w-52 break-words p-3">{concert.tour.name}</td><td className="p-3">{concert.sessionNumber || '—'}</td><td className="p-3">{concert.setlistCount}</td><td className="p-3">{concert.highlightCount}</td><td className="p-3">{concert.status === 'PUBLISHED' ? '已发布' : '草稿'}</td><td className="p-3"><div className="flex gap-2"><Link href={`/admin/music/concerts/${concert.id}`} className="bg-brand-950 px-3 py-2 font-black text-white">编辑</Link><button type="button" onClick={() => void remove(concert)} className="bg-red-50 px-3 py-2 font-black text-red-700">删除</button></div></td></tr>)}</tbody></table>{!concerts.length ? <p className="p-6 text-sm font-bold text-slate-500">暂无符合条件的场次。</p> : null}</section>
  </main>
}
