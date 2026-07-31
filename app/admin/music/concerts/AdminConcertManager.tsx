'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MusicCoverUploader } from '@/app/admin/music/MusicCoverUploader'
import { MultiDatePicker } from '@/components/music/live/MultiDatePicker'

type Tour = { id: string; name: string }
type BrowseConcert = {
  id: string
  concertDate: string
  city: string
  venue?: string | null
  sessionNumber?: string | null
  sortOrder: number
  status: 'DRAFT' | 'PUBLISHED'
}
type CityGroup = { city: string; count: number; firstDate: string | null; lastDate: string | null }
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
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 创建表单
  const [form, setForm] = useState(empty)
  const [concertDates, setConcertDates] = useState<string[]>([])

  // 三级浏览（懒加载：巡演 → 城市 → 场次）
  const [browseTourId, setBrowseTourId] = useState('')
  const [cities, setCities] = useState<CityGroup[]>([])                 // 二级：城市分组（来自 ?mode=cities，不加载全部场次）
  const [openCity, setOpenCity] = useState<string | null>(null)
  const [cityConcerts, setCityConcerts] = useState<BrowseConcert[]>([]) // 三级：某城市场次（来自 ?tourId&city）
  const [browseConcerts, setBrowseConcerts] = useState<BrowseConcert[]>([]) // 平铺模式（showAll）仍受 200 上限约束
  const [showAll, setShowAll] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // 批量海报
  const [posterPanelOpen, setPosterPanelOpen] = useState(false)
  const [batchPosterUrl, setBatchPosterUrl] = useState('')

  // 复制城市
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyForm, setCopyForm] = useState({ targetCity: '', concertDates: [] as string[], options: { venue: true, poster: true, description: true, setlist: true, highlights: true } })

  const loadTours = useCallback(async () => {
    const response = await fetch('/api/admin/music/tours')
    const data = await response.json().catch(() => null)
    if (response.ok) {
      const list = (data.tours || []).map((tour: Tour) => ({ id: tour.id, name: tour.name }))
      setTours(list)
    }
  }, [])
  useEffect(() => { void loadTours() }, [loadTours])

  // 平铺模式：加载该巡演全部场次（上限 200，仅 showAll 时使用）
  const loadBrowse = useCallback(async () => {
    if (!browseTourId) { setBrowseConcerts([]); return }
    const response = await fetch(`/api/admin/music/concerts?tourId=${encodeURIComponent(browseTourId)}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setBrowseConcerts(data.concerts || [])
    else setError(data?.message || '场次加载失败')
  }, [browseTourId])

  // 二级：城市分组（仅返回城市+计数，不加载全部场次，避免单巡演超 200 场被截断）
  const loadCities = useCallback(async () => {
    if (!browseTourId) { setCities([]); return }
    const response = await fetch(`/api/admin/music/concerts?mode=cities&tourId=${encodeURIComponent(browseTourId)}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setCities(data.cities || [])
    else setError(data?.message || '城市加载失败')
  }, [browseTourId])

  // 三级：某城市场次（city 级查询不限条数）
  const loadCityConcerts = useCallback(async () => {
    if (!browseTourId || !openCity) { setCityConcerts([]); return }
    const response = await fetch(`/api/admin/music/concerts?tourId=${encodeURIComponent(browseTourId)}&city=${encodeURIComponent(openCity)}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setCityConcerts(data.concerts || [])
    else setError(data?.message || '场次加载失败')
  }, [browseTourId, openCity])

  useEffect(() => {
    if (showAll) void loadBrowse()
    else void loadCities()
  }, [showAll, loadBrowse, loadCities])
  useEffect(() => { void loadCityConcerts() }, [loadCityConcerts])

  // 任意写操作后刷新当前视图（仅重载相关层级，不拉取全部场次）
  async function refresh() {
    await loadCities()
    if (openCity) await loadCityConcerts()
    if (showAll) await loadBrowse()
  }

  const openCityConcerts = useMemo(
    () => (openCity ? [...cityConcerts].sort((left, right) => left.concertDate.localeCompare(right.concertDate)) : []),
    [openCity, cityConcerts],
  )

  function addMessage(text: string) { setMessage(text); setError('') }
  function addError(text: string) { setError(text); setMessage('') }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!concertDates.length) return addError('请至少选择一个演出日期')
    setBusy(true)
    setError('')
    setMessage('')
    const setlist = form.setlistSource === 'NEW'
      ? form.setlistText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((displayName, index) => ({
        songId: null, displayName, section: 'MAIN', position: index + 1, versionName: null, note: null,
        isEncore: false, isRequest: false, isDebut: false, isGuest: false, isMedley: false, isSpecial: false,
      }))
      : []
    const response = await fetch('/api/admin/music/concerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tourId: form.tourId, countryOrRegion: form.countryOrRegion, city: form.city, venue: form.venue,
        concertDates, setlistSource: form.setlistSource, setlist,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '创建失败')
    else {
      addMessage(data?.message || `已创建 ${concertDates.length} 个场次`)
      setConcertDates([])
      setForm((current) => ({ ...current, setlistText: '' }))
      await refresh()
    }
    setBusy(false)
  }

  async function remove(concert: BrowseConcert) {
    if (!window.confirm(`确定删除 ${concert.city} ${concert.concertDate.slice(0, 10)} 场次吗？其歌单和特别时刻会一并删除。`)) return
    const response = await fetch(`/api/admin/music/concerts/${concert.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '删除失败')
    else {
      addMessage('场次已删除，其余场次已自动重新编号')
      setSelectedIds((current) => current.filter((id) => id !== concert.id))
      await refresh()
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function bulkAction(action: 'publish' | 'unpublish' | 'draft') {
    const ids = [...selectedIds]
    if (!ids.length) return
    const response = await fetch('/api/admin/music/concerts/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '操作失败')
    else { addMessage(data.message); setSelectedIds([]); setPosterPanelOpen(false); setBatchPosterUrl(''); await refresh() }
  }

  async function applyPoster() {
    if (!batchPosterUrl || !selectedIds.length) return
    const response = await fetch('/api/admin/music/concerts/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, action: 'poster', posterUrl: batchPosterUrl }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '海报更新失败')
    else { addMessage(data.message); setSelectedIds([]); setPosterPanelOpen(false); setBatchPosterUrl(''); await refresh() }
  }

  async function copyCity() {
    if (!openCity || !copyForm.targetCity.trim() || !copyForm.concertDates.length) return addError('请填写目标城市并选择至少一个日期')
    setBusy(true)
    const response = await fetch('/api/admin/music/concerts/copy-city', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tourId: browseTourId, sourceCity: openCity, targetCity: copyForm.targetCity.trim(),
        concertDates: copyForm.concertDates, options: copyForm.options,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) addError(data?.message || '复制失败')
    else {
      addMessage(data.message)
      setCopyOpen(false)
      setCopyForm({ targetCity: '', concertDates: [], options: { venue: true, poster: true, description: true, setlist: true, highlights: true } })
      await refresh()
    }
    setBusy(false)
  }

  const selectedCount = selectedIds.length

  // 当前展开城市场次的勾选派生状态（仅前端状态，不触达 API/DB）
  const openCityIds = useMemo(() => openCityConcerts.map((concert) => concert.id), [openCityConcerts])
  const allCitySelected = openCityIds.length > 0 && openCityIds.every((id) => selectedIds.includes(id))
  const someCitySelected = openCityIds.some((id) => selectedIds.includes(id))
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = selectAllRef.current
    if (element) element.indeterminate = someCitySelected && !allCitySelected
  }, [someCitySelected, allCitySelected])

  function toggleSelectAll() {
    if (allCitySelected) {
      // 取消全选：仅清空当前城市场次的选择
      setSelectedIds((current) => current.filter((id) => !openCityIds.includes(id)))
    } else {
      // 全选：选中当前城市已加载的全部场次（合并去重）
      setSelectedIds((current) => [...new Set([...current, ...openCityIds])])
    }
  }

  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5">
    <section className="border border-sky-100 bg-white/90 p-6 shadow-sm">
      <Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link>
      <h1 className="mt-4 text-4xl font-black text-brand-950">演唱会管理</h1>
    </section>
    {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}

    {/* 创建巡演场次 */}
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
        <div>
          <span className="text-sm font-black text-slate-700">演出日期（点击多选，可切换月份）</span>
          <div className="mt-1"><MultiDatePicker value={concertDates} onChange={setConcertDates} /></div>
        </div>
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

    {/* 三级管理 */}
    <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-black text-brand-950">巡演场次管理</h2>
        <label className="flex items-center gap-2 text-sm font-black text-slate-600"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />平铺显示全部场次</label>
      </div>
      <div className="mt-4">
        <select aria-label="选择巡演" value={browseTourId} onChange={(event) => { setBrowseTourId(event.target.value); setOpenCity(null); setSelectedIds([]) }} className={`${field} max-w-md`}>
          <option value="">请选择巡演</option>
          {tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}
        </select>
      </div>

      {!browseTourId ? <p className="mt-5 text-sm font-bold text-slate-500">请先选择一个巡演以查看其城市与场次。</p> : null}

      {browseTourId && showAll ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-sky-50 text-xs font-black"><tr>{['日期', '城市', '场馆', '排序', '状态', '操作'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
            <tbody>
              {browseConcerts.map((concert) => <tr key={concert.id} className="border-t border-sky-100">
                <td className="p-3">{concert.concertDate.slice(0, 10)}</td>
                <td className="p-3 font-black">{concert.city}</td>
                <td className="max-w-52 break-words p-3">{concert.venue || '—'}</td>
                <td className="p-3 font-black">{String(Number(concert.sessionNumber || concert.sortOrder || 1)).padStart(2, '0')}</td>
                <td className="p-3">{concert.status === 'PUBLISHED' ? '已发布' : '草稿'}</td>
                <td className="p-3"><div className="flex gap-2"><Link href={`/admin/music/concerts/${concert.id}`} className="rounded-lg bg-brand-950 px-3 py-2 font-black text-white">编辑</Link><button type="button" onClick={() => void remove(concert)} className="rounded-lg bg-red-50 px-3 py-2 font-black text-red-700">删除</button></div></td>
              </tr>)}
            </tbody>
          </table>
          {!browseConcerts.length ? <p className="mt-4 text-sm font-bold text-slate-500">该巡演暂无场次。</p> : null}
        </div>
      ) : null}

      {browseTourId && !showAll ? (
        <div className="mt-5 space-y-3">
          {cities.map((group) => <div key={group.city} className="rounded-2xl border border-sky-100">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => { setOpenCity((current) => (current === group.city ? null : group.city)); setSelectedIds([]) }} className="flex items-center gap-3 text-left">
                <span className="text-lg font-black text-brand-950">{group.city}</span>
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-brand-800">{group.count} 场</span>
                <span className="text-xs font-bold text-slate-400">{group.firstDate ?? ''} ~ {group.lastDate ?? ''}</span>
                <span className="text-xs font-black text-slate-400">{openCity === group.city ? '▲' : '▼'}</span>
              </button>
              <button type="button" onClick={() => { setOpenCity(group.city); setSelectedIds([]); setCopyOpen(true) }} className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-black text-brand-700">复制城市</button>
            </div>
            {openCity === group.city ? (
              <div className="border-t border-sky-100 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-sm font-black text-slate-600">已选择 {selectedCount} / {openCityConcerts.length} 个场次</span>
                  <button type="button" onClick={() => bulkAction('publish')} disabled={!selectedCount} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量发布</button>
                  <button type="button" onClick={() => bulkAction('unpublish')} disabled={!selectedCount} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量取消发布</button>
                  <button type="button" onClick={() => bulkAction('draft')} disabled={!selectedCount} className="rounded-lg bg-slate-500 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量转草稿</button>
                  <button type="button" onClick={() => setPosterPanelOpen((current) => !current)} disabled={!selectedCount} className="rounded-lg bg-brand-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40">批量改海报</button>
                </div>

                {posterPanelOpen ? (
                  <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
                    <p className="text-sm font-black text-brand-950">上传一张海报，应用到所选 {selectedCount} 个场次</p>
                    <div className="mt-3 max-w-xs"><MusicCoverUploader entityType="concert" entityId={selectedIds[0]} currentUrl={batchPosterUrl || null} onUploaded={(url) => setBatchPosterUrl(url)} /></div>
                    <button type="button" onClick={() => void applyPoster()} disabled={!batchPosterUrl} className="mt-3 rounded-lg bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">应用到所选场次</button>
                  </div>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-sky-50 text-xs font-black"><tr>
                      <th className="w-10 p-3"><input ref={selectAllRef} type="checkbox" checked={allCitySelected} onChange={toggleSelectAll} aria-label="全选当前城市场次" /></th>
                      {['日期', '场馆', '排序', '状态', '操作'].map((label) => <th key={label} className="p-3">{label}</th>)}
                    </tr></thead>
                    <tbody>
                      {openCityConcerts.map((concert) => <tr key={concert.id} className="border-t border-sky-100">
                        <td className="p-3"><input type="checkbox" checked={selectedIds.includes(concert.id)} onChange={() => toggleSelect(concert.id)} aria-label={`选择 ${concert.concertDate.slice(0, 10)}`} /></td>
                        <td className="p-3">{concert.concertDate.slice(0, 10)}</td>
                        <td className="max-w-52 break-words p-3">{concert.venue || '—'}</td>
                        <td className="p-3 font-black">{String(Number(concert.sessionNumber || concert.sortOrder || 1)).padStart(2, '0')}</td>
                        <td className="p-3">{concert.status === 'PUBLISHED' ? '已发布' : '草稿'}</td>
                        <td className="p-3"><div className="flex gap-2"><Link href={`/admin/music/concerts/${concert.id}`} className="rounded-lg bg-brand-950 px-3 py-2 font-black text-white">编辑</Link><button type="button" onClick={() => void remove(concert)} className="rounded-lg bg-red-50 px-3 py-2 font-black text-red-700">删除</button></div></td>
                      </tr>)}
                    </tbody>
                  </table>
                  {!openCityConcerts.length ? <p className="mt-4 text-sm font-bold text-slate-500">{group.city} 暂无场次。</p> : null}
                </div>

                {copyOpen ? (
                  <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
                    <h3 className="text-lg font-black text-brand-950">复制「{group.city}」到新城市</h3>
                    <p className="mt-1 text-sm font-bold text-slate-500">将 {group.city} 各场次按日期顺序一一对应到新城市的各个日期（如 12-09 → 新城市首个日期），管理员后续仅需微调城市、日期、场馆。</p>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <label className="text-sm font-black text-slate-700">目标城市
                        <input value={copyForm.targetCity} onChange={(event) => setCopyForm((current) => ({ ...current, targetCity: event.target.value }))} className={`${field} mt-1`} />
                      </label>
                      <div>
                        <span className="text-sm font-black text-slate-700">新城市演出日期</span>
                        <div className="mt-1"><MultiDatePicker value={copyForm.concertDates} onChange={(dates) => setCopyForm((current) => ({ ...current, concertDates: dates }))} /></div>
                      </div>
                    </div>
                    <fieldset className="mt-4 rounded-xl border border-sky-100 p-3">
                      <legend className="px-1 text-sm font-black text-slate-700">复制内容（默认全部）</legend>
                      <div className="flex flex-wrap gap-4">
                        {([['venue', '场馆'], ['poster', '海报'], ['description', '描述'], ['setlist', '歌单'], ['highlights', '特别时刻']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm font-black"><input type="checkbox" checked={copyForm.options[key]} onChange={(event) => setCopyForm((current) => ({ ...current, options: { ...current.options, [key]: event.target.checked } }))} />{label}</label>)}
                      </div>
                    </fieldset>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => void copyCity()} disabled={busy} className="rounded-lg bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">生成新城市场次</button>
                      <button type="button" onClick={() => setCopyOpen(false)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">取消</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>)}
          {!cities.length ? <p className="mt-4 text-sm font-bold text-slate-500">该巡演暂无场次。</p> : null}
        </div>
      ) : null}
    </section>
  </main>
}
