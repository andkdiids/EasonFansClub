'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ContributionType = 'SHOW' | 'SETLIST' | 'ENCORE'
type Tab = ContributionType | 'MINE'

type TourOption = { id: string; name: string; category: string; categoryId?: string | null; startDate?: string | null; endDate?: string | null }
type ConcertOption = { id: string; title?: string | null; concertDate: string; startTime?: string | null; city: string; countryOrRegion?: string | null; venue?: string | null; stageType: string; MusicTour: { id: string; name: string; category: string }; _count: { MusicConcertSetlistItem: number } }
type SongOption = { id: string; title: string; artist?: string; releaseYear: number; album: { name: string } }
type Row = { key: string; songId: string | null; title: string; album: string; displayName: string; section: string; versionName: string; note: string; isEncore: boolean; isRequest: boolean; isDebut: boolean; isGuest: boolean; isMedley: boolean; isSpecial: boolean }
type ShowForm = { tourId: string; city: string; countryOrRegion: string; venue: string; concertDate: string; startTime: string; endTime: string; title: string; posterUrl: string; description: string; stageType: 'NORMAL' | 'ENCORE' | 'FINAL' }
type Contribution = { id: string; type: ContributionType; payload: unknown; targetShowId: string | null; status: string; statusLabel?: string; reviewNote: string | null; createdAt: string; targetShow: { city: string; concertDate: string; venue: string | null; MusicTour: { name: string } } | null }

const field = 'w-full border border-white/15 bg-white/[0.07] px-3 py-2.5 text-sm font-bold text-white outline-none placeholder:text-slate-400/60 focus:border-sky-300/60'
const lightField = 'w-full border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold text-brand-950 outline-none placeholder:text-slate-400 focus:border-brand-400'

function emptyRow(isEncore = false): Row {
  return { key: `${Date.now()}-${Math.random()}`, songId: null, title: '', album: '', displayName: '', section: isEncore ? 'ENCORE' : 'MAIN', versionName: '', note: '', isEncore, isRequest: false, isDebut: false, isGuest: false, isMedley: false, isSpecial: false }
}

function dateText(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function timeText(value: string | null | undefined) {
  if (!value) return ''
  return value.includes('T') ? value.slice(11, 16) : value.slice(0, 5)
}

function payloadShow(payload: unknown): ShowForm | null {
  if (!payload || typeof payload !== 'object' || !('tourId' in payload)) return null
  const value = payload as Record<string, unknown>
  return {
    tourId: String(value.tourId || ''), city: String(value.city || ''), countryOrRegion: String(value.countryOrRegion || '中国'), venue: String(value.venue || ''), concertDate: String(value.concertDate || ''), startTime: String(value.startTime || ''), endTime: String(value.endTime || ''), title: String(value.title || ''), posterUrl: String(value.posterUrl || ''), description: String(value.description || ''), stageType: value.stageType === 'ENCORE' || value.stageType === 'FINAL' ? value.stageType : 'NORMAL',
  }
}

function payloadRows(payload: unknown, isEncore: boolean) {
  if (!payload || typeof payload !== 'object' || !('items' in payload)) return []
  const items = (payload as { items?: unknown[] }).items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).filter((item) => isEncore ? item.isEncore === true || item.section === 'ENCORE' : item.isEncore !== true && item.section !== 'ENCORE').map((item) => ({
    ...emptyRow(isEncore), key: `${String(item.songId || '')}-${Math.random()}`, songId: typeof item.songId === 'string' ? item.songId : null, title: String(item.title || item.displayName || ''), album: String(item.album || ''), displayName: String(item.displayName || item.title || ''), section: isEncore ? 'ENCORE' : String(item.section || 'MAIN'), versionName: String(item.versionName || ''), note: String(item.note || ''), isRequest: item.isRequest === true, isDebut: item.isDebut === true, isGuest: item.isGuest === true, isMedley: item.isMedley === true, isSpecial: item.isSpecial === true,
  }))
}

function contributionLocation(item: Contribution) {
  const payload = payloadShow(item.payload)
  if (payload) return `${payload.city || '未填写城市'} · ${payload.concertDate || '未填写日期'}`
  if (item.targetShow) return `${item.targetShow.city} · ${dateText(item.targetShow.concertDate)}`
  return '待绑定场次'
}

function SongPicker({ row, index, onChange, onMove, onRemove }: { row: Row; index: number; onChange: (patch: Partial<Row>) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void }) {
  const [query, setQuery] = useState(row.title)
  const [options, setOptions] = useState<SongOption[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => setQuery(row.title), [row.title])
  useEffect(() => {
    if (!query.trim() || row.songId) {
      setOptions([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      void fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => setOptions(Array.isArray(data?.songs) ? data.songs.slice(0, 8) : []))
        .catch(() => setOptions([]))
        .finally(() => setSearching(false))
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, row.songId])

  return <article className="border border-white/10 bg-white/[0.045] p-3 sm:p-4">
    <div className="flex min-w-0 items-start gap-3">
      <span className="w-7 shrink-0 pt-2 text-center text-sm font-black text-sky-300/70">{index + 1}</span>
      <div className="min-w-0 flex-1">
        {row.songId ? <div className="flex min-w-0 items-center justify-between gap-2 border border-sky-300/20 bg-sky-300/[0.08] px-3 py-2"><div className="min-w-0"><p className="break-words text-sm font-black text-white">{row.title}</p><p className="break-words text-xs font-bold text-slate-300/60">{row.album || 'EasMusic 曲库'}</p></div><button type="button" onClick={() => { setQuery(''); onChange({ songId: null, title: '', album: '', displayName: '' }) }} className="shrink-0 text-xs font-black text-sky-200">更换</button></div> : <div className="relative"><input value={query} onChange={(event) => { setQuery(event.target.value); onChange({ songId: null, title: event.target.value, displayName: event.target.value }) }} placeholder="搜索 EasMusic 曲库歌曲" className={field} aria-label={`搜索第${index + 1}首歌曲`} />{searching ? <p className="mt-1 text-xs font-bold text-slate-400">搜索中…</p> : null}{options.length ? <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto border border-sky-200/20 bg-[#12263d] shadow-xl">{options.map((song) => <button type="button" key={song.id} onClick={() => { setQuery(song.title); setOptions([]); onChange({ songId: song.id, title: song.title, album: song.album?.name || '', displayName: song.title }) }} className="block w-full border-b border-white/10 p-3 text-left hover:bg-sky-300/10"><strong className="block text-sm text-white">{song.title}</strong><span className="text-xs text-slate-300/65">{song.album?.name || '曲库'} · {song.releaseYear}</span></button>)}</div> : null}</div>}
        {!row.songId && query.trim() && !searching && !options.length ? <p className="mt-1 text-xs font-bold text-amber-200/80">暂未找到该歌曲，请从曲库结果中选择</p> : null}
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={row.versionName} onChange={(event) => onChange({ versionName: event.target.value })} placeholder="版本说明（可选）" className={field} /><input value={row.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="备注（可选）" className={field} /></div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">{([['isRequest', '点歌'], ['isDebut', '首唱'], ['isGuest', '嘉宾'], ['isMedley', '串烧'], ['isSpecial', '特别演唱']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-1 text-xs font-bold text-slate-300/75"><input type="checkbox" checked={row[key]} onChange={(event) => onChange({ [key]: event.target.checked })} />{label}</label>)}</div>
      </div>
      <div className="flex shrink-0 flex-col gap-1"><button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="border border-white/10 px-2 py-1 text-xs font-black disabled:opacity-30" aria-label="上移">↑</button><button type="button" onClick={() => onMove(1)} className="border border-white/10 px-2 py-1 text-xs font-black" aria-label="下移">↓</button><button type="button" onClick={onRemove} className="border border-red-300/20 px-2 py-1 text-xs font-black text-red-200">删</button></div>
    </div>
  </article>
}

function SetlistRows({ title, rows, onRowsChange, isEncore }: { title: string; rows: Row[]; onRowsChange: (rows: Row[]) => void; isEncore: boolean }) {
  function patch(index: number, value: Partial<Row>) { onRowsChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row)) }
  function move(index: number, direction: -1 | 1) { const target = index + direction; if (target < 0 || target >= rows.length) return; const next = [...rows]; [next[index], next[target]] = [next[target], next[index]]; onRowsChange(next) }
  return <section className="border-t border-white/10 pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-black text-white">{title}</h3><button type="button" onClick={() => onRowsChange([...rows, emptyRow(isEncore)])} className="border border-sky-300/25 px-3 py-2 text-xs font-black text-sky-100">添加歌曲</button></div><div className="mt-4 space-y-3">{rows.map((row, index) => <SongPicker key={row.key} row={row} index={index} onChange={(value) => patch(index, value)} onMove={(direction) => move(index, direction)} onRemove={() => onRowsChange(rows.filter((_, rowIndex) => rowIndex !== index))} />)}</div>{!rows.length ? <p className="mt-3 text-sm font-bold text-slate-400">暂未添加歌曲。</p> : null}</section>
}

export function ConcertContributionComposer() {
  const [tab, setTab] = useState<Tab>('SHOW')
  const [tours, setTours] = useState<TourOption[]>([])
  const [concerts, setConcerts] = useState<ConcertOption[]>([])
  const [show, setShow] = useState<ShowForm>({ tourId: '', city: '', countryOrRegion: '中国', venue: '', concertDate: '', startTime: '', endTime: '', title: '', posterUrl: '', description: '', stageType: 'NORMAL' })
  const [concertFilter, setConcertFilter] = useState({ tourId: '', city: '', date: '', q: '' })
  const [targetShowId, setTargetShowId] = useState('')
  const [normalRows, setNormalRows] = useState<Row[]>([])
  const [encoreRows, setEncoreRows] = useState<Row[]>([])
  const [showEncore, setShowEncore] = useState(false)
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [duplicateData, setDuplicateData] = useState<{ message: string; duplicates: Array<{ city: string; concertDate: string; venue: string | null }> } | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedConcert = useMemo(() => concerts.find((concert) => concert.id === targetShowId) || null, [concerts, targetShowId])

  async function loadTours() {
    const response = await fetch('/api/music/concerts/options?kind=tours', { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    if (response.ok) setTours(data?.tours || [])
  }
  async function loadContributions() {
    const response = await fetch('/api/music/concerts/contributions', { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    if (response.ok) setContributions(data?.contributions || [])
  }
  async function loadConcerts() {
    const params = new URLSearchParams()
    if (concertFilter.tourId) params.set('tourId', concertFilter.tourId)
    if (concertFilter.city) params.set('city', concertFilter.city)
    if (concertFilter.date) params.set('date', concertFilter.date)
    if (concertFilter.q) params.set('q', concertFilter.q)
    const response = await fetch(`/api/music/concerts/options?${params}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    if (response.ok) setConcerts(data?.concerts || [])
  }
  useEffect(() => { void loadTours(); void loadContributions() }, [])
  useEffect(() => { if (tab === 'SETLIST' || tab === 'ENCORE') void loadConcerts() }, [tab, concertFilter.tourId, concertFilter.city, concertFilter.date, concertFilter.q])

  function resetEditor(type: ContributionType = 'SHOW', clearFeedback = true) {
    setEditingId(null); setDuplicateData(null); setError(''); if (clearFeedback) setMessage(''); setTab(type); setShow({ tourId: '', city: '', countryOrRegion: '中国', venue: '', concertDate: '', startTime: '', endTime: '', title: '', posterUrl: '', description: '', stageType: 'NORMAL' }); setTargetShowId(''); setNormalRows([]); setEncoreRows([]); setShowEncore(type !== 'SETLIST' ? type === 'ENCORE' : false)
  }

  function startEdit(item: Contribution) {
    if (item.status !== 'PENDING') return
    setEditingId(item.id); setDuplicateData(null); setError(''); setMessage(''); setTab(item.type)
    if (item.type === 'SHOW') { setShow(payloadShow(item.payload) || show) }
    else { setTargetShowId((item.payload as { targetShowId?: string })?.targetShowId || item.targetShowId || ''); setNormalRows(payloadRows(item.payload, false)); setEncoreRows(payloadRows(item.payload, true)); setShowEncore(item.type === 'ENCORE' || payloadRows(item.payload, true).length > 0) }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function buildPayload(type: ContributionType) {
    if (type === 'SHOW') return show
    const rows = type === 'ENCORE' ? encoreRows : [...normalRows, ...(showEncore ? encoreRows : [])]
    return { targetShowId, items: rows.map((row) => ({ songId: row.songId, displayName: row.displayName || row.title || null, section: type === 'ENCORE' || row.isEncore ? 'ENCORE' : row.section, versionName: row.versionName || null, note: row.note || null, isEncore: type === 'ENCORE' || row.isEncore, isRequest: row.isRequest, isDebut: row.isDebut, isGuest: row.isGuest, isMedley: row.isMedley, isSpecial: row.isSpecial })) }
  }

  async function submit(confirmDuplicate = false) {
    const type = tab === 'MINE' ? 'SHOW' : tab
    if (type !== 'SHOW' && !targetShowId) return setError('请先选择对应演唱会场次')
    if (type === 'SHOW' && !show.tourId) return setError('请先选择所属巡演')
    if (type !== 'SHOW' && !(type === 'ENCORE' ? encoreRows.length : normalRows.length + (showEncore ? encoreRows.length : 0))) return setError('请至少添加一首从曲库选择的歌曲')
    if (type !== 'SHOW' && [...normalRows, ...encoreRows].some((row) => !row.songId)) return setError('请从 EasMusic 曲库结果中选择每一首歌曲')
    setBusy(true); setError(''); setMessage('')
    const url = editingId ? `/api/music/concerts/contributions/${editingId}` : '/api/music/concerts/contributions'
    const response = await fetch(url, { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(editingId ? {} : { type }), payload: buildPayload(type), confirmDuplicate }) })
    const data = await response.json().catch(() => null)
    if (response.status === 409 && data?.code === 'POSSIBLE_DUPLICATE') { setDuplicateData(data); setError(''); setBusy(false); return }
    if (!response.ok) { setError(data?.message || '提交失败，请稍后重试'); setBusy(false); return }
    const successMessage = data?.message || '资料已提交'; resetEditor(type, false); setMessage(successMessage); await loadContributions(); setBusy(false)
  }

  async function withdraw(id: string) {
    if (!window.confirm('确定撤回这条审核中的投稿吗？')) return
    const response = await fetch(`/api/music/concerts/contributions/${id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '撤回失败')
    else { setMessage(data?.message || '投稿已撤回'); await loadContributions() }
  }

  const tabButton = (value: Tab, label: string) => <button type="button" onClick={() => { setTab(value); setError(''); setMessage('') }} className={`border-b-2 px-1 py-3 text-sm font-black ${tab === value ? 'border-sky-300 text-sky-100' : 'border-transparent text-slate-300/60'}`}>{label}</button>

  return <div className="space-y-7">
    <header><div className="flex flex-wrap items-center justify-between gap-3"><Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回 Eason in Concert</Link><button type="button" onClick={() => { setTab('MINE'); void loadContributions() }} className="border border-sky-200/20 bg-sky-200/[0.07] px-4 py-2 text-sm font-black text-sky-100">我的投稿</button></div><p className="mt-10 text-xs font-black tracking-[0.24em] text-sky-300/70">EASON IN CONCERT ARCHIVE</p><h1 className="mt-3 break-words text-4xl font-black tracking-tight text-white sm:text-6xl">提供演唱会资料</h1><p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-slate-300/70 sm:text-base">如果你发现缺少场次、歌单或 Encore，可以在这里提交资料。资料将在管理员审核后展示。</p><p className="mt-3 text-sm font-bold text-slate-300/55">感谢你帮助完善 Eason in Concert 的演出资料。</p></header>
    <nav className="flex flex-wrap gap-5 border-b border-white/10" aria-label="投稿类型">{tabButton('SHOW', '提供场次')}{tabButton('SETLIST', '提供歌单')}{tabButton('ENCORE', '提供 Encore')}{tabButton('MINE', '我的投稿')}</nav>
    {message ? <p role="status" className="border border-emerald-300/20 bg-emerald-300/[0.08] p-3 text-sm font-black text-emerald-100">{message}</p> : null}{error ? <p role="alert" className="border border-red-300/20 bg-red-300/[0.08] p-3 text-sm font-black text-red-100">{error}</p> : null}
    {duplicateData ? <section className="border border-amber-300/30 bg-amber-300/[0.08] p-4"><p className="text-sm font-black text-amber-100">{duplicateData.message}</p><p className="mt-2 text-xs font-bold leading-6 text-amber-100/75">{duplicateData.duplicates?.map((item) => `${item.city} · ${dateText(item.concertDate)}${item.venue ? ` · ${item.venue}` : ''}`).join('；')}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void submit(true)} className="bg-amber-200 px-4 py-2 text-sm font-black text-amber-950">确认仍然提交</button><button type="button" onClick={() => setDuplicateData(null)} className="border border-amber-200/30 px-4 py-2 text-sm font-black text-amber-100">返回修改</button></div></section> : null}
    {tab === 'MINE' ? <MyContributions items={contributions} onEdit={startEdit} onWithdraw={(id) => void withdraw(id)} /> : <section className="border border-white/10 bg-white/[0.045] p-5 sm:p-7">
      {tab === 'SHOW' ? <ShowEditor show={show} tours={tours} onChange={(patch) => setShow((current) => ({ ...current, ...patch }))} /> : <SetlistEditor type={tab} tours={tours} concerts={concerts} filter={concertFilter} onFilterChange={(patch) => setConcertFilter((current) => ({ ...current, ...patch }))} selectedConcert={selectedConcert} targetShowId={targetShowId} onTargetChange={setTargetShowId} normalRows={normalRows} encoreRows={encoreRows} onNormalChange={setNormalRows} onEncoreChange={setEncoreRows} showEncore={showEncore} onShowEncore={setShowEncore} />}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5"><p className="text-xs font-bold text-slate-400/70">提交后会进入管理员审核，审核通过才会展示。</p><button type="button" onClick={() => void submit()} disabled={busy} className="bg-sky-200 px-5 py-3 text-sm font-black text-sky-950 disabled:opacity-50">{busy ? '提交中…' : editingId ? '保存修改' : '提交资料'}</button></div>
    </section>}
  </div>
}

function ShowEditor({ show, tours, onChange }: { show: ShowForm; tours: TourOption[]; onChange: (patch: Partial<ShowForm>) => void }) {
  return <div><h2 className="text-2xl font-black text-white">添加演唱会场次</h2><p className="mt-2 text-sm font-bold leading-6 text-slate-300/60">表单字段会进入管理员审核，审核状态、排序和创建者信息由服务端维护。</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black text-slate-200">所属巡演<select required value={show.tourId} onChange={(event) => onChange({ tourId: event.target.value })} className={`${field} mt-1`}><option value="">请选择已有巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name} · {tour.category}</option>)}</select></label><label className="text-sm font-black text-slate-200">城市<input required value={show.city} onChange={(event) => onChange({ city: event.target.value })} className={`${field} mt-1`} placeholder="例如：香港" /></label><label className="text-sm font-black text-slate-200">国家 / 地区<input value={show.countryOrRegion} onChange={(event) => onChange({ countryOrRegion: event.target.value })} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-200">场馆<input value={show.venue} onChange={(event) => onChange({ venue: event.target.value })} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-200">演出日期<input required type="date" value={show.concertDate} onChange={(event) => onChange({ concertDate: event.target.value })} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-200">开始时间<input type="time" value={show.startTime} onChange={(event) => onChange({ startTime: event.target.value })} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-200">结束时间<input type="time" value={show.endTime} onChange={(event) => onChange({ endTime: event.target.value })} className={`${field} mt-1`} /></label><label className="text-sm font-black text-slate-200">场次类型<select value={show.stageType} onChange={(event) => onChange({ stageType: event.target.value as ShowForm['stageType'] })} className={`${field} mt-1`}><option value="NORMAL">普通场次</option><option value="ENCORE">返场</option><option value="FINAL">最终站</option></select></label><label className="text-sm font-black text-slate-200 sm:col-span-2">场次标题<input value={show.title} onChange={(event) => onChange({ title: event.target.value })} className={`${field} mt-1`} placeholder="可选，默认使用城市站" /></label><label className="text-sm font-black text-slate-200 sm:col-span-2">海报地址<input value={show.posterUrl} onChange={(event) => onChange({ posterUrl: event.target.value })} className={`${field} mt-1`} placeholder="可选，填写已有图片地址" /></label><label className="text-sm font-black text-slate-200 sm:col-span-2">备注<textarea value={show.description} onChange={(event) => onChange({ description: event.target.value })} className={`${field} mt-1 min-h-28`} /></label></div></div>
}

function SetlistEditor({ type, tours, concerts, filter, onFilterChange, selectedConcert, targetShowId, onTargetChange, normalRows, encoreRows, onNormalChange, onEncoreChange, showEncore, onShowEncore }: { type: 'SETLIST' | 'ENCORE'; tours: TourOption[]; concerts: ConcertOption[]; filter: { tourId: string; city: string; date: string; q: string }; onFilterChange: (patch: Partial<typeof filter>) => void; selectedConcert: ConcertOption | null; targetShowId: string; onTargetChange: (value: string) => void; normalRows: Row[]; encoreRows: Row[]; onNormalChange: (rows: Row[]) => void; onEncoreChange: (rows: Row[]) => void; showEncore: boolean; onShowEncore: (value: boolean) => void }) {
  return <div><h2 className="text-2xl font-black text-white">{type === 'ENCORE' ? '添加 Encore' : '添加现场歌单'}</h2><p className="mt-2 text-sm font-bold leading-6 text-slate-300/60">先选择明确的演唱会场次，再从 EasMusic 曲库选择歌曲。没有找到的歌曲不会自动创建。</p><div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4"><select aria-label="按巡演筛选" value={filter.tourId} onChange={(event) => { onFilterChange({ tourId: event.target.value }); onTargetChange('') }} className={lightField}><option value="">全部巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select><input value={filter.city} onChange={(event) => onFilterChange({ city: event.target.value })} placeholder="城市" className={lightField} /><input type="date" value={filter.date} onChange={(event) => onFilterChange({ date: event.target.value })} className={lightField} /><input value={filter.q} onChange={(event) => onFilterChange({ q: event.target.value })} placeholder="搜索巡演 / 城市 / 场馆" className={lightField} /></div><label className="mt-4 block text-sm font-black text-slate-200">对应演唱会场次<select required value={targetShowId} onChange={(event) => onTargetChange(event.target.value)} className={`${field} mt-1`}><option value="">请选择已有场次</option>{concerts.map((concert) => <option key={concert.id} value={concert.id}>{concert.MusicTour.name} · {concert.city} · {dateText(concert.concertDate)}{concert.startTime ? ` ${timeText(concert.startTime)}` : ''}{concert.venue ? ` · ${concert.venue}` : ''}</option>)}</select></label>{selectedConcert ? <p className="mt-3 border border-sky-300/20 bg-sky-300/[0.07] p-3 text-xs font-bold text-sky-100/80">已选择：{selectedConcert.MusicTour.name} · {selectedConcert.city} · {dateText(selectedConcert.concertDate)}。{selectedConcert._count.MusicConcertSetlistItem ? '该场次目前已经存在歌单。如果你发现内容有误或不完整，仍然可以提交修正版。' : '该场次目前还没有正式歌单。'}</p> : null}<div className="mt-6 space-y-5">{type === 'SETLIST' ? <><SetlistRows title="正式歌单" rows={normalRows} onRowsChange={onNormalChange} isEncore={false} />{showEncore ? <SetlistRows title="Encore" rows={encoreRows} onRowsChange={onEncoreChange} isEncore /> : <button type="button" onClick={() => onShowEncore(true)} className="border border-sky-300/25 px-3 py-2 text-xs font-black text-sky-100">插入 Encore 分隔</button>}</> : <SetlistRows title="Encore" rows={encoreRows} onRowsChange={onEncoreChange} isEncore />}</div></div>
}

function MyContributions({ items, onEdit, onWithdraw }: { items: Contribution[]; onEdit: (item: Contribution) => void; onWithdraw: (id: string) => void }) {
  if (!items.length) return <section className="border border-white/10 bg-white/[0.045] p-7"><h2 className="text-2xl font-black text-white">我的投稿</h2><p className="mt-4 text-sm font-bold text-slate-300/60">还没有投稿记录。</p></section>
  return <section className="space-y-3"><div><h2 className="text-2xl font-black text-white">我的投稿</h2><p className="mt-2 text-sm font-bold text-slate-300/60">审核通过后，正式资料会继续保留你的来源。</p></div>{items.map((item) => <article key={item.id} className="border border-white/10 bg-white/[0.045] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.16em] text-sky-300/65">{item.type === 'SHOW' ? '场次' : item.type === 'SETLIST' ? '歌单' : 'ENCORE'}</p><h3 className="mt-2 text-lg font-black text-white">{contributionLocation(item)}</h3><p className="mt-1 text-xs font-bold text-slate-400">提交于 {item.createdAt.slice(0, 16).replace('T', ' ')}</p></div><span className="border border-sky-300/20 px-2 py-1 text-xs font-black text-sky-100">{item.statusLabel || item.status}</span></div>{item.reviewNote ? <p className="mt-3 border-l-2 border-red-300/50 pl-3 text-sm font-bold text-red-100/80">拒绝原因：{item.reviewNote}</p> : null}<div className="mt-4 flex flex-wrap gap-2">{item.status === 'PENDING' ? <><button type="button" onClick={() => onEdit(item)} className="border border-sky-300/25 px-3 py-2 text-xs font-black text-sky-100">编辑</button><button type="button" onClick={() => onWithdraw(item.id)} className="border border-red-300/25 px-3 py-2 text-xs font-black text-red-100">撤回</button></> : item.status === 'APPROVED' && item.targetShowId ? <Link href={`/music/live/concerts/${item.targetShowId}`} className="border border-sky-300/25 px-3 py-2 text-xs font-black text-sky-100">查看正式资料</Link> : null}</div></article>)}</section>
}
