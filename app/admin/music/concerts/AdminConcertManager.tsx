'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { MusicCoverUploader } from '@/app/admin/music/MusicCoverUploader'
import { MultiDatePicker } from '@/components/music/live/MultiDatePicker'
import { concertPosterSourceLabel, type ConcertPosterSource } from '@/lib/music-concert-poster'

type Tour = { id: string; name: string }
type ConcertStatus = 'DRAFT' | 'PUBLISHED'
type BrowseConcert = {
  id: string
  concertDate: string
  city: string
  venue?: string | null
  posterUrl?: string | null
  resolvedPosterUrl?: string | null
  posterSource?: ConcertPosterSource
  sessionNumber?: string | null
  sortOrder: number
  status: ConcertStatus
  attendanceCount?: number
  setlistCount?: number
  tour: Tour
}
type CityGroup = { city: string; count: number; firstDate: string | null; lastDate: string | null; posterUrl?: string | null }
type SourceConcert = { id: string; city: string; concertDate: string; sessionNumber?: string | null; sortOrder: number; tour: Tour }
type BrowseFilters = { city: string; startDate: string; endDate: string; status: '' | ConcertStatus; page: number }
type Pagination = { page: number; pageSize: number; total: number; totalPages: number }
type BulkAction = 'publish' | 'draft' | 'poster' | 'delete' | 'copy-setlist'

const PAGE_SIZE = 50
const field = 'w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-400'
const empty = {
  tourId: '',
  countryOrRegion: '中国',
  city: '',
  venue: '',
  posterUrl: '',
  status: 'DRAFT' as ConcertStatus,
  stageType: 'NORMAL' as 'NORMAL' | 'ENCORE' | 'FINAL',
  setlistSource: 'PREVIOUS' as 'PREVIOUS' | 'NEW' | 'SOURCE',
  sourceConcertId: '',
  setlistText: '',
}

function sessionLabel(row: { sessionNumber?: string | null; sortOrder?: number }) {
  return `#${String(Number(row.sessionNumber || row.sortOrder || 1)).padStart(3, '0')}`
}

function formatDate(value?: string | null) {
  return value ? value.slice(0, 10) : '—'
}

function buildBrowseQuery(tourId: string, filters: BrowseFilters, idsOnly = false) {
  const params = new URLSearchParams({ tourId })
  if (filters.city) params.set('city', filters.city)
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  if (filters.status) params.set('status', filters.status)
  if (idsOnly) params.set('idsOnly', '1')
  else {
    params.set('page', String(filters.page))
    params.set('pageSize', String(PAGE_SIZE))
  }
  return params
}

export function AdminConcertManager() {
  const [tours, setTours] = useState<Tour[]>([])
  const [browseTourId, setBrowseTourId] = useState('')
  const [browseConcerts, setBrowseConcerts] = useState<BrowseConcert[]>([])
  const [cities, setCities] = useState<CityGroup[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 })
  const [filters, setFilters] = useState<BrowseFilters>({ city: '', startDate: '', endDate: '', status: '', page: 1 })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkStatus, setBulkStatus] = useState<ConcertStatus>('PUBLISHED')
  const [batchPosterUrl, setBatchPosterUrl] = useState('')
  const [posterPanelOpen, setPosterPanelOpen] = useState(false)
  const [copySetlistOpen, setCopySetlistOpen] = useState(false)
  const [copySourceId, setCopySourceId] = useState('')
  const [copySourceConcerts, setCopySourceConcerts] = useState<SourceConcert[]>([])
  const [cityModalOpen, setCityModalOpen] = useState(false)
  const [cityCopyOpen, setCityCopyOpen] = useState(false)
  const [copyForm, setCopyForm] = useState({ sourceCity: '', targetCity: '', concertDates: [] as string[], options: { venue: true, poster: true, description: true, setlist: true, highlights: true } })

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [concertDates, setConcertDates] = useState<string[]>([])
  const [sourceConcerts, setSourceConcerts] = useState<SourceConcert[]>([])
  const createFormRef = useRef<HTMLFormElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const selectedCount = selectedIds.length
  const allFilteredSelected = pagination.total > 0 && selectedCount === pagination.total
  const someFilteredSelected = selectedCount > 0 && !allFilteredSelected

  const addMessage = useCallback((text: string) => { setMessage(text); setError('') }, [])
  const addError = useCallback((text: string) => { setError(text); setMessage('') }, [])

  const loadTours = useCallback(async () => {
    const response = await fetch('/api/admin/music/tours')
    const data = await response.json().catch(() => null)
    if (response.ok) setTours((data?.tours || []).map((tour: Tour) => ({ id: tour.id, name: tour.name })))
    else addError(data?.message || '巡演加载失败')
  }, [addError])

  const loadCities = useCallback(async () => {
    if (!browseTourId) { setCities([]); return }
    const response = await fetch(`/api/admin/music/concerts?mode=cities&tourId=${encodeURIComponent(browseTourId)}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setCities(data?.cities || [])
    else addError(data?.message || '城市加载失败')
  }, [addError, browseTourId])

  const loadBrowse = useCallback(async () => {
    if (!browseTourId) {
      setBrowseConcerts([])
      setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 })
      return
    }
    const response = await fetch(`/api/admin/music/concerts?${buildBrowseQuery(browseTourId, filters)}`)
    const data = await response.json().catch(() => null)
    if (!response.ok) return addError(data?.message || '场次加载失败')
    setBrowseConcerts(data?.concerts || [])
    setPagination(data?.pagination || { page: filters.page, pageSize: PAGE_SIZE, total: data?.concerts?.length || 0, totalPages: 1 })
  }, [addError, browseTourId, filters])

  const loadCreateSources = useCallback(async () => {
    if (!form.tourId) { setSourceConcerts([]); return }
    const response = await fetch(`/api/admin/music/concerts?mode=copy-options&tourId=${encodeURIComponent(form.tourId)}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setSourceConcerts(data?.concerts || [])
    else addError(data?.message || '来源场次加载失败')
  }, [addError, form.tourId])

  useEffect(() => { void loadTours() }, [loadTours])
  useEffect(() => { void loadCities() }, [loadCities])
  useEffect(() => { void loadBrowse() }, [loadBrowse])
  useEffect(() => { void loadCreateSources() }, [loadCreateSources])
  useEffect(() => {
    const element = selectAllRef.current
    if (element) element.indeterminate = someFilteredSelected
  }, [someFilteredSelected])

  function updateFilter<K extends keyof Omit<BrowseFilters, 'page'>>(key: K, value: BrowseFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }))
    setSelectedIds([])
  }

  function chooseTour(value: string) {
    setBrowseTourId(value)
    setFilters({ city: '', startDate: '', endDate: '', status: '', page: 1 })
    setSelectedIds([])
    setCityModalOpen(false)
    setCityCopyOpen(false)
  }

  function openCreateForm() {
    setForm((current) => ({ ...current, tourId: browseTourId || current.tourId }))
    setCreateOpen(true)
    window.requestAnimationFrame(() => createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function startCityConcert(city: string) {
    setForm((current) => ({ ...current, tourId: browseTourId, city, setlistSource: 'PREVIOUS', sourceConcertId: '' }))
    setConcertDates([])
    setCityModalOpen(false)
    setCityCopyOpen(false)
    setCreateOpen(true)
    setError('')
    setMessage(`${city} 已带入新增场次表单`)
    window.requestAnimationFrame(() => createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!concertDates.length) return addError('请至少选择一个演出日期')
    setBusy(true); setError(''); setMessage('')
    const setlist = form.setlistSource === 'NEW'
      ? form.setlistText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((displayName, index) => ({ songId: null, displayName, section: 'MAIN', position: index + 1, versionName: null, note: null, isEncore: false, isRequest: false, isDebut: false, isGuest: false, isMedley: false, isSpecial: false }))
      : []
    const response = await fetch('/api/admin/music/concerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourId: form.tourId, countryOrRegion: form.countryOrRegion, city: form.city, venue: form.venue, posterUrl: form.posterUrl, status: form.status, stageType: form.stageType, concertDates, setlistSource: form.setlistSource, sourceConcertId: form.sourceConcertId, setlist }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '创建失败')
    else {
      addMessage(data?.message || `已创建 ${concertDates.length} 个场次`)
      setConcertDates([])
      setForm((current) => ({ ...current, setlistText: '', sourceConcertId: '' }))
      setCreateOpen(false)
      await loadBrowse(); await loadCities()
    }
    setBusy(false)
  }

  async function remove(concert: BrowseConcert) {
    if (!window.confirm(`确定删除 ${concert.city} ${formatDate(concert.concertDate)} 场次吗？其歌单和特别时刻会一并删除。`)) return
    const response = await fetch(`/api/admin/music/concerts/${concert.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '删除失败')
    else { addMessage(data?.message || '场次已删除'); setSelectedIds((current) => current.filter((id) => id !== concert.id)); await loadBrowse(); await loadCities() }
  }

  async function toggleSelectAll() {
    if (!browseTourId || !pagination.total) return
    if (allFilteredSelected) return setSelectedIds([])
    const response = await fetch(`/api/admin/music/concerts?${buildBrowseQuery(browseTourId, filters, true)}`)
    const data = await response.json().catch(() => null)
    if (!response.ok) return addError(data?.message || '全选场次加载失败')
    setSelectedIds(data?.ids || [])
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function bulkAction(action: BulkAction, extra: Record<string, unknown> = {}) {
    if (!selectedIds.length) return addError('请至少选择一个场次')
    if (action === 'delete' && !window.confirm(`确定删除已选 ${selectedIds.length} 个场次吗？此操作不可恢复。`)) return
    setBusy(true); setError(''); setMessage('')
    const response = await fetch('/api/admin/music/concerts/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selectedIds, action, ...extra }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '批量操作失败')
    else {
      addMessage(data?.message || '批量操作完成')
      setSelectedIds([])
      setPosterPanelOpen(false)
      setCopySetlistOpen(false)
      setCopySourceId('')
      setFilters((current) => ({ ...current, page: 1 }))
      await loadBrowse(); await loadCities()
    }
    setBusy(false)
  }

  function applyBulkStatus() { void bulkAction(bulkStatus === 'PUBLISHED' ? 'publish' : 'draft') }

  async function openCopySetlist() {
    if (!browseTourId || !selectedIds.length) return addError('请先选择目标场次')
    const response = await fetch(`/api/admin/music/concerts?mode=copy-options&tourId=${encodeURIComponent(browseTourId)}`)
    const data = await response.json().catch(() => null)
    if (!response.ok) return addError(data?.message || '来源场次加载失败')
    setCopySourceConcerts(data?.concerts || [])
    setCopySourceId('')
    setCopySetlistOpen(true)
  }

  function openCityCopy(city: string) {
    setCopyForm((current) => ({ ...current, sourceCity: city }))
    setCityCopyOpen(true)
    setCityModalOpen(true)
  }

  async function copyCity() {
    if (!copyForm.sourceCity || !copyForm.targetCity.trim() || !copyForm.concertDates.length) return addError('请选择来源城市、目标城市和至少一个日期')
    setBusy(true); setError(''); setMessage('')
    const response = await fetch('/api/admin/music/concerts/copy-city', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tourId: browseTourId, sourceCity: copyForm.sourceCity, targetCity: copyForm.targetCity.trim(), concertDates: copyForm.concertDates, options: copyForm.options }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '复制城市失败')
    else { addMessage(data?.message || '城市场次已复制'); setCityCopyOpen(false); setCopyForm((current) => ({ ...current, targetCity: '', concertDates: [] })); await loadBrowse(); await loadCities() }
    setBusy(false)
  }

  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5">
    <section className="sticky top-4 z-20 border border-sky-100 bg-white/95 p-6 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link><h1 className="mt-4 text-4xl font-black text-brand-950">演唱会场次管理</h1><p className="mt-2 text-sm font-bold text-slate-500">按日期查看当前巡演全部场次，筛选和批量操作均由服务端处理。</p></div>
        <button type="button" onClick={openCreateForm} disabled={!browseTourId} className="rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40"><span aria-hidden="true">+</span> <span>新增场次</span></button>
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="min-w-64 text-sm font-black text-slate-700">当前巡演<select aria-label="选择巡演" value={browseTourId} onChange={(event) => chooseTour(event.target.value)} className={`${field} mt-1`}><option value="">请选择巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
        <button type="button" onClick={() => browseTourId && setCityModalOpen(true)} disabled={!browseTourId} className="rounded-xl bg-sky-50 px-4 py-2.5 text-sm font-black text-brand-700 disabled:opacity-40">城市管理</button>
      </div>
    </section>
    {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}

    {createOpen ? <form ref={createFormRef} onSubmit={create} className="scroll-mt-24 border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-brand-950">创建巡演场次</h2><p className="mt-2 text-sm font-bold text-slate-500">城市不再依赖分组，直接在此选择并创建。</p></div><button type="button" onClick={() => setCreateOpen(false)} className="text-sm font-black text-slate-500">取消</button></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <label className="text-sm font-black text-slate-700">所属巡演<select required value={form.tourId} onChange={(event) => setForm((current) => ({ ...current, tourId: event.target.value, setlistSource: current.setlistSource === 'SOURCE' ? 'PREVIOUS' : current.setlistSource, sourceConcertId: '' }))} className={`${field} mt-1`}><option value="">请选择</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
        <label className="text-sm font-black text-slate-700">国家地区<input required list="concert-country-options" value={form.countryOrRegion} onChange={(event) => setForm((current) => ({ ...current, countryOrRegion: event.target.value }))} className={`${field} mt-1`} /><datalist id="concert-country-options"><option value="中国" /><option value="澳门" /><option value="香港" /><option value="台湾" /><option value="新加坡" /><option value="美国" /></datalist></label>
        <label className="text-sm font-black text-slate-700">城市<input required value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black text-slate-700">场次类型<select value={form.stageType} onChange={(event) => setForm((current) => ({ ...current, stageType: event.target.value as 'NORMAL' | 'ENCORE' | 'FINAL' }))} className={`${field} mt-1`}><option value="NORMAL">普通场次</option><option value="ENCORE">返场</option><option value="FINAL">最终站</option></select></label>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2"><div><span className="text-sm font-black text-slate-700">演出日期（点击多选，可切换月份）</span><div className="mt-1"><MultiDatePicker value={concertDates} onChange={setConcertDates} /></div></div><label className="text-sm font-black text-slate-700">场馆<input value={form.venue} onChange={(event) => setForm((current) => ({ ...current, venue: event.target.value }))} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-700">海报地址<input value={form.posterUrl} onChange={(event) => setForm((current) => ({ ...current, posterUrl: event.target.value }))} className={`${field} mt-1`} placeholder="可保存后在场次编辑页上传海报" /></label><label className="text-sm font-black text-slate-700">状态<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ConcertStatus }))} className={`${field} mt-1`}><option value="DRAFT">草稿 / 待定</option><option value="PUBLISHED">已发布</option></select></label></div>
      <fieldset className="mt-5 rounded-2xl border border-sky-100 p-4"><legend className="px-1 text-sm font-black text-slate-700">歌单来源</legend><div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm font-black"><input type="radio" name="setlistSource" checked={form.setlistSource === 'NEW'} onChange={() => setForm((current) => ({ ...current, setlistSource: 'NEW', sourceConcertId: '' }))} />创建新歌单</label><label className="flex items-center gap-2 text-sm font-black"><input type="radio" name="setlistSource" checked={form.setlistSource === 'PREVIOUS'} onChange={() => setForm((current) => ({ ...current, setlistSource: 'PREVIOUS', sourceConcertId: '' }))} />使用上一场歌单</label><label className="flex items-center gap-2 text-sm font-black"><input type="radio" name="setlistSource" checked={form.setlistSource === 'SOURCE'} onChange={() => setForm((current) => ({ ...current, setlistSource: 'SOURCE' }))} />从当前巡演选择场次复制</label></div>{form.setlistSource === 'SOURCE' ? <div className="mt-4 space-y-3"><label className="block text-sm font-black text-slate-700">选择来源场次<select required aria-label="选择来源场次" value={form.sourceConcertId} onChange={(event) => setForm((current) => ({ ...current, sourceConcertId: event.target.value }))} className={`${field} mt-1`}><option value="">请选择当前巡演已有场次</option>{sourceConcerts.map((row) => <option key={row.id} value={row.id}>{row.tour.name} · {row.city} · {formatDate(row.concertDate)} · {sessionLabel(row)}</option>)}</select></label><p className="text-sm font-bold text-slate-500">来源场次不会被修改。</p></div> : form.setlistSource === 'PREVIOUS' ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm font-bold text-brand-700">保存后继承该巡演上一场歌单，每个新场次都会保存独立副本。</p> : <label className="mt-4 block text-sm font-black text-slate-700">歌单编辑器<textarea value={form.setlistText} onChange={(event) => setForm((current) => ({ ...current, setlistText: event.target.value }))} placeholder={'每行一首歌\n孤勇者\n十年\nK歌之王'} className={`${field} mt-1 min-h-36`} /></label>}</fieldset>
      <button disabled={busy || !concertDates.length} className="mt-5 rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '创建中…' : `创建 ${concertDates.length || ''} 个场次`}</button>
    </form> : null}

    <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-brand-950">全部场次列表</h2><p className="mt-2 text-sm font-bold text-slate-500">默认按演出日期升序，每页 {PAGE_SIZE} 条。</p></div>{browseTourId ? <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">共 {pagination.total} 场</span> : null}</div>
      {!browseTourId ? <p className="mt-5 text-sm font-bold text-slate-500">请先选择巡演。</p> : <>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm font-black text-slate-700">城市<select value={filters.city} onChange={(event) => updateFilter('city', event.target.value)} className={`${field} mt-1`}><option value="">全部城市</option>{cities.map((city) => <option key={city.city} value={city.city}>{city.city}</option>)}</select></label><label className="text-sm font-black text-slate-700">开始日期<input type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-700">结束日期<input type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-700">状态<select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as BrowseFilters['status'])} className={`${field} mt-1`}><option value="">全部状态</option><option value="PUBLISHED">已发布</option><option value="DRAFT">草稿 / 待定</option></select></label><button type="button" onClick={() => { setFilters({ city: '', startDate: '', endDate: '', status: '', page: 1 }); setSelectedIds([]) }} className="self-end rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-black text-slate-700">清除筛选</button></div>
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/50 p-3"><span className="mr-2 text-sm font-black text-slate-600">已选择 {selectedCount} 个</span><button type="button" onClick={() => void toggleSelectAll()} disabled={!pagination.total || busy} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-40">{allFilteredSelected ? '取消全选' : '全选当前筛选结果'}</button><select aria-label="批量状态" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as ConcertStatus)} className="rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs font-black"><option value="PUBLISHED">已发布</option><option value="DRAFT">草稿 / 待定</option></select><button type="button" onClick={applyBulkStatus} disabled={!selectedCount || busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量修改状态</button><button type="button" onClick={() => setPosterPanelOpen((current) => !current)} disabled={!selectedCount || busy} className="rounded-lg bg-brand-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量设置海报</button><button type="button" onClick={() => void openCopySetlist()} disabled={!selectedCount || busy} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量复制歌单</button><button type="button" onClick={() => void bulkAction('delete')} disabled={!selectedCount || busy} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量删除</button></div>
        {posterPanelOpen ? <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><p className="text-sm font-black text-brand-950">上传一张海报并应用到已选 {selectedCount} 个场次</p><div className="mt-3 max-w-xs"><MusicCoverUploader key={selectedIds[0] || 'batch-poster'} entityType="concert" entityId={selectedIds[0] || 'batch'} currentUrl={batchPosterUrl || null} onUploaded={setBatchPosterUrl} /></div><button type="button" onClick={() => void bulkAction('poster', { posterUrl: batchPosterUrl })} disabled={!batchPosterUrl || busy} className="mt-3 rounded-lg bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">应用到所选场次</button></div> : null}
        {copySetlistOpen ? <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-black text-brand-950">从当前巡演选择歌单来源</p><button type="button" onClick={() => setCopySetlistOpen(false)} className="text-xs font-black text-slate-500">取消</button></div><select aria-label="批量复制歌单来源" value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)} className={`${field} mt-3`}><option value="">请选择来源场次</option>{copySourceConcerts.map((row) => <option key={row.id} value={row.id}>{row.tour.name} · {row.city} · {formatDate(row.concertDate)} · {sessionLabel(row)}</option>)}</select><button type="button" onClick={() => void bulkAction('copy-setlist', { sourceConcertId: copySourceId })} disabled={!copySourceId || busy} className="mt-3 rounded-lg bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">复制到已选场次</button><p className="mt-2 text-xs font-bold text-slate-500">普通歌单、Encore、顺序和标记都会复制；来源场次不会修改。</p></div> : null}
        <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-sky-50 text-xs font-black text-brand-950"><tr><th className="w-10 p-3"><input ref={selectAllRef} type="checkbox" checked={allFilteredSelected} onChange={() => void toggleSelectAll()} aria-label="全选当前筛选结果" /></th>{['编号', '日期', '城市', '场馆', '状态', '海报', '操作'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{browseConcerts.map((concert) => <tr key={concert.id} className="border-t border-sky-100"><td className="p-3"><input type="checkbox" checked={selectedIds.includes(concert.id)} onChange={() => toggleSelected(concert.id)} aria-label={`选择 ${formatDate(concert.concertDate)} ${concert.city}`} /></td><td className="p-3 font-black">{sessionLabel(concert)}</td><td className="p-3 whitespace-nowrap">{formatDate(concert.concertDate)}</td><td className="p-3 font-black">{concert.city}</td><td className="max-w-52 break-words p-3">{concert.venue || '—'}</td><td className="p-3">{concert.status === 'PUBLISHED' ? '已发布' : '草稿 / 待定'}</td><td className="p-3 text-xs">{concert.resolvedPosterUrl ? `有 · ${concertPosterSourceLabel(concert.posterSource || 'system')}` : '无'}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Link href={`/admin/music/concerts/${concert.id}`} className="rounded-lg bg-brand-950 px-3 py-2 font-black text-white">编辑</Link><button type="button" onClick={() => void remove(concert)} className="rounded-lg bg-red-50 px-3 py-2 font-black text-red-700">删除</button></div></td></tr>)}</tbody></table>{!browseConcerts.length ? <p className="mt-4 text-sm font-bold text-slate-500">当前筛选没有场次。</p> : null}</div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm font-black text-slate-600"><span>第 {pagination.page} / {pagination.totalPages} 页</span><div className="flex gap-2"><button type="button" onClick={() => { setFilters((current) => ({ ...current, page: current.page - 1 })); setSelectedIds([]) }} disabled={pagination.page <= 1 || busy} className="rounded-lg bg-sky-50 px-4 py-2 text-brand-700 disabled:opacity-40">上一页</button><button type="button" onClick={() => { setFilters((current) => ({ ...current, page: current.page + 1 })); setSelectedIds([]) }} disabled={pagination.page >= pagination.totalPages || busy} className="rounded-lg bg-sky-50 px-4 py-2 text-brand-700 disabled:opacity-40">下一页</button></div></div>
      </>}
    </section>

    {cityModalOpen ? <div role="dialog" aria-modal="true" aria-label="城市管理" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-4"><div className="mx-auto mt-10 max-w-3xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-brand-950">城市管理</h2><p className="mt-1 text-sm font-bold text-slate-500">城市作为筛选条件使用；默认海报仍按现有场次数据运行时继承。</p></div><button type="button" onClick={() => { setCityModalOpen(false); setCityCopyOpen(false) }} className="text-sm font-black text-slate-500">关闭</button></div><div className="mt-5 space-y-3">{cities.map((city) => <article key={city.city} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 p-4"><div><h3 className="font-black text-brand-950">{city.city}</h3><p className="mt-1 text-xs font-bold text-slate-500">{city.count} 场 · {city.firstDate || '—'} ~ {city.lastDate || '—'} · 默认海报：{city.posterUrl ? '有' : '无'}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => startCityConcert(city.city)} className="rounded-lg bg-brand-950 px-3 py-2 text-xs font-black text-white">新增该城市场次</button><button type="button" onClick={() => openCityCopy(city.city)} className="rounded-lg bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">复制城市</button></div></article>)}{!cities.length ? <p className="text-sm font-bold text-slate-500">当前巡演暂无城市。</p> : null}</div>{cityCopyOpen ? <div className="mt-5 rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><h3 className="font-black text-brand-950">复制「{copyForm.sourceCity}」到新城市</h3><p className="mt-1 text-sm font-bold text-slate-500">按日期顺序复制场次及所选内容，来源不会被修改。</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><label className="text-sm font-black text-slate-700">目标城市<input value={copyForm.targetCity} onChange={(event) => setCopyForm((current) => ({ ...current, targetCity: event.target.value }))} className={`${field} mt-1`} /></label><div><span className="text-sm font-black text-slate-700">新城市演出日期</span><div className="mt-1"><MultiDatePicker value={copyForm.concertDates} onChange={(dates) => setCopyForm((current) => ({ ...current, concertDates: dates }))} /></div></div></div><fieldset className="mt-4 rounded-xl border border-sky-100 p-3"><legend className="px-1 text-sm font-black text-slate-700">复制内容</legend><div className="flex flex-wrap gap-4">{([['venue', '场馆'], ['poster', '海报'], ['description', '描述'], ['setlist', '歌单'], ['highlights', '特别时刻']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm font-black"><input type="checkbox" checked={copyForm.options[key]} onChange={(event) => setCopyForm((current) => ({ ...current, options: { ...current.options, [key]: event.target.checked } }))} />{label}</label>)}</div></fieldset><div className="mt-4 flex gap-2"><button type="button" onClick={() => void copyCity()} disabled={busy} className="rounded-lg bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">生成新城市场次</button><button type="button" onClick={() => setCityCopyOpen(false)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">取消</button></div></div> : null}</div></div> : null}
  </main>
}
