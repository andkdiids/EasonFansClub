'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Tour = { id: string; name: string }
type Concert = {
  id: string
  concertDate: string
  city: string
  venue?: string | null
  sessionNumber?: string | null
  sortOrder: number
  status: 'DRAFT' | 'PUBLISHED'
  tour: Tour
  setlistCount: number
  highlightCount: number
  attendanceCount: number
}
type SetlistSource = 'PREVIOUS' | 'NEW'

const empty = {
  tourId: '',
  countryOrRegion: '中国',
  city: '',
  venue: '',
  setlistSource: 'PREVIOUS' as SetlistSource,
  setlistText: '',
}
const field = 'w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-400'

export function AdminConcertManager() {
  const [tours, setTours] = useState<Tour[]>([])
  const [concerts, setConcerts] = useState<Concert[]>([])
  const [form, setForm] = useState(empty)
  const [dateDraft, setDateDraft] = useState('')
  const [concertDates, setConcertDates] = useState<string[]>([])
  const [filters, setFilters] = useState({ tourId: '', year: '', city: '', status: '', q: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const loadTours = useCallback(async () => {
    const response = await fetch('/api/admin/music/tours')
    const data = await response.json().catch(() => null)
    if (response.ok) setTours((data.tours || []).map((tour: Tour) => ({ id: tour.id, name: tour.name })))
  }, [])
  const loadConcerts = useCallback(async () => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
    const response = await fetch(`/api/admin/music/concerts?${query}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setConcerts(data.concerts || [])
    else setError(data?.message || '场次加载失败')
  }, [filters])
  useEffect(() => { void loadTours() }, [loadTours])
  useEffect(() => { void loadConcerts() }, [loadConcerts])

  function addDate() {
    if (!dateDraft) return
    setConcertDates((current) => [...new Set([...current, dateDraft])].sort())
    setDateDraft('')
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!concertDates.length) return setError('请至少添加一个演出日期')
    setBusy(true)
    setError('')
    setMessage('')
    const setlist = form.setlistSource === 'NEW'
      ? form.setlistText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((displayName, index) => ({
        songId: null,
        displayName,
        section: 'MAIN',
        position: index + 1,
        versionName: null,
        note: null,
        isEncore: false,
        isRequest: false,
        isDebut: false,
        isGuest: false,
        isMedley: false,
        isSpecial: false,
      }))
      : []
    const response = await fetch('/api/admin/music/concerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tourId: form.tourId,
        countryOrRegion: form.countryOrRegion,
        city: form.city,
        venue: form.venue,
        concertDates,
        setlistSource: form.setlistSource,
        setlist,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '创建失败')
    else {
      setMessage(data?.message || `已创建 ${concertDates.length} 个场次`)
      setConcertDates([])
      setDateDraft('')
      setForm((current) => ({ ...current, setlistText: '' }))
      await loadConcerts()
    }
    setBusy(false)
  }

  async function remove(concert: Concert) {
    if (!window.confirm(`确定删除 ${concert.city} ${concert.concertDate.slice(0, 10)} 场次吗？其歌单和特别时刻会一并删除。`)) return
    const response = await fetch(`/api/admin/music/concerts/${concert.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '删除失败')
    else {
      setMessage('场次已删除，其余场次已自动重新编号')
      await loadConcerts()
    }
  }

  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5">
    <section className="border border-sky-100 bg-white/90 p-6 shadow-sm">
      <Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link>
      <h1 className="mt-4 text-4xl font-black text-brand-950">演唱会管理</h1>
    </section>
    {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}

    <form onSubmit={create} className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <h2 className="text-2xl font-black text-brand-950">创建巡演场次</h2>
      <p className="mt-2 text-sm font-bold text-slate-500">同一城市可一次添加多个日期，系统会按日期自动生成并重排场次编号。</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <label className="text-sm font-black text-slate-700">所属巡演
          <select required value={form.tourId} onChange={(event) => setForm({ ...form, tourId: event.target.value })} className={`${field} mt-1`}>
            <option value="">请选择</option>
            {tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-black text-slate-700">国家地区
          <input required list="concert-country-options" value={form.countryOrRegion} onChange={(event) => setForm({ ...form, countryOrRegion: event.target.value })} className={`${field} mt-1`} />
          <datalist id="concert-country-options">{['中国', '澳门', '香港', '台湾', '新加坡', '美国'].map((value) => <option key={value} value={value} />)}</datalist>
        </label>
        <label className="text-sm font-black text-slate-700">城市
          <input required value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={`${field} mt-1`} />
        </label>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <fieldset className="rounded-2xl border border-sky-100 p-4">
          <legend className="px-1 text-sm font-black text-slate-700">演出日期（多选）</legend>
          <div className="flex gap-2">
            <input aria-label="待添加演出日期" type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} className={field} />
            <button type="button" onClick={addDate} disabled={!dateDraft} className="min-w-20 rounded-xl bg-sky-100 px-4 text-sm font-black text-brand-800 disabled:opacity-40">添加</button>
          </div>
          <div className="mt-3 flex min-h-10 flex-wrap gap-2">
            {concertDates.map((date, index) => <span key={date} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-800">
              {date} · 第 {index + 1} 场
              <button type="button" aria-label={`删除日期 ${date}`} onClick={() => setConcertDates((current) => current.filter((item) => item !== date))} className="text-red-600">×</button>
            </span>)}
            {!concertDates.length ? <span className="text-xs font-bold text-slate-400">尚未选择日期</span> : null}
          </div>
        </fieldset>
        <label className="text-sm font-black text-slate-700">场馆
          <input value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })} className={`${field} mt-1`} />
        </label>
      </div>

      <fieldset className="mt-5 rounded-2xl border border-sky-100 p-4">
        <legend className="px-1 text-sm font-black text-slate-700">歌单来源</legend>
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm font-black"><input type="radio" name="setlistSource" checked={form.setlistSource === 'PREVIOUS'} onChange={() => setForm({ ...form, setlistSource: 'PREVIOUS' })} />使用上一场歌单</label>
          <label className="flex items-center gap-2 text-sm font-black"><input type="radio" name="setlistSource" checked={form.setlistSource === 'NEW'} onChange={() => setForm({ ...form, setlistSource: 'NEW' })} />创建新歌单</label>
        </div>
        {form.setlistSource === 'PREVIOUS'
          ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm font-bold text-brand-700">保存后将继承该巡演上一场歌单；每个新场次都会保存独立副本，后续修改不会影响上一场。</p>
          : <label className="mt-4 block text-sm font-black text-slate-700">歌单编辑器
            <textarea value={form.setlistText} onChange={(event) => setForm({ ...form, setlistText: event.target.value })} placeholder={'每行一首歌\n孤勇者\n十年\nK歌之王'} className={`${field} mt-1 min-h-36`} />
          </label>}
      </fieldset>

      <button disabled={busy || !concertDates.length} className="mt-5 rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '创建中…' : `创建 ${concertDates.length || ''} 个场次`}</button>
    </form>

    <section className="border border-sky-100 bg-white/90 p-4 shadow-sm">
      <h2 className="text-xl font-black text-brand-950">筛选场次</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <select aria-label="按巡演筛选" value={filters.tourId} onChange={(event) => setFilters({ ...filters, tourId: event.target.value })} className={field}><option value="">全部巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select>
        <input aria-label="按年份筛选" type="number" placeholder="年份" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} className={field} />
        <input aria-label="按城市筛选" placeholder="城市" value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })} className={field} />
        <select aria-label="按发布状态筛选" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={field}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option></select>
        <input aria-label="关键词筛选" placeholder="标题、场馆、巡演" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} className={field} />
      </div>
    </section>

    <section className="overflow-x-auto border border-sky-100 bg-white/90">
      <table className="w-full min-w-[1020px] text-left text-sm">
        <thead className="bg-sky-50 text-xs font-black"><tr>{['日期', '城市', '场馆', '所属巡演', '排序', '歌单', '特别时刻', '观演记录', '状态', '操作'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{concerts.map((concert) => <tr key={concert.id} className="border-t border-sky-100">
          <td className="p-3">{concert.concertDate.slice(0, 10)}</td><td className="p-3 font-black">{concert.city}</td><td className="max-w-52 break-words p-3">{concert.venue || '—'}</td><td className="max-w-52 break-words p-3">{concert.tour.name}</td>
          <td className="p-3 font-black">{String(Number(concert.sessionNumber || concert.sortOrder || 1)).padStart(2, '0')}</td><td className="p-3">{concert.setlistCount}</td><td className="p-3">{concert.highlightCount}</td><td className="p-3 font-black">{concert.attendanceCount}</td><td className="p-3">{concert.status === 'PUBLISHED' ? '已发布' : '草稿'}</td>
          <td className="p-3"><div className="flex gap-2"><Link href={`/admin/music/concerts/${concert.id}`} className="rounded-lg bg-brand-950 px-3 py-2 font-black text-white">编辑</Link><button type="button" onClick={() => void remove(concert)} className="rounded-lg bg-red-50 px-3 py-2 font-black text-red-700">删除</button></div></td>
        </tr>)}</tbody>
      </table>
      {!concerts.length ? <p className="p-6 text-sm font-bold text-slate-500">暂无符合条件的场次。</p> : null}
    </section>
  </main>
}
