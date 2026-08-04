'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { MusicCoverUploader } from '@/app/admin/music/MusicCoverUploader'

type Tour = { id: string; name: string }
type SongOption = { id: string; title: string; album: string; releaseYear: number }
type SetlistItem = { id?: string; songId: string | null; displayName: string; section: string; position: number; versionName: string; note: string; isEncore: boolean; isRequest: boolean; isDebut: boolean; isGuest: boolean; isMedley: boolean; isSpecial: boolean; song?: SongOption | null; candidates?: SongOption[] }
type Highlight = { id?: string; type: string; title: string; content: string; sortOrder: number }
type Concert = { id: string; tourId: string; title?: string | null; concertDate: string; city: string; countryOrRegion?: string | null; venue?: string | null; sessionNumber?: string | null; posterUrl?: string | null; description?: string | null; status: 'DRAFT' | 'PUBLISHED'; sortOrder: number; tour: Tour; setlist: SetlistItem[]; highlights: Highlight[]; _count?: { UserMusicConcert: number } }
const sections = [['OPENING','开场'],['MAIN','正式歌单'],['TALK','谈话环节'],['REQUEST','点歌'],['ENCORE','Encore'],['SPECIAL','特别环节'],['OTHER','其他']]
const highlightTypes = [['TALK','谈话'],['GUEST','嘉宾'],['SONG','歌曲'],['STAGE','舞台'],['INTERACTION','互动'],['MEMORIAL','纪念'],['OTHER','其他']]
const field = 'w-full border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-brand-400'
const newItem = (position: number): SetlistItem => ({ songId: null, displayName: '', section: 'MAIN', position, versionName: '', note: '', isEncore: false, isRequest: false, isDebut: false, isGuest: false, isMedley: false, isSpecial: false })

export function AdminConcertEditor({ concertId }: { concertId: string }) {
  const [concert, setConcert] = useState<Concert | null>(null)
  const [tours, setTours] = useState<Tour[]>([])
  const [form, setForm] = useState({ tourId: '', title: '', concertDate: '', city: '', countryOrRegion: '中国', venue: '', posterUrl: '', description: '', status: 'DRAFT' as Concert['status'] })
  const [setlist, setSetlist] = useState<SetlistItem[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [searches, setSearches] = useState<Record<number, SongOption[]>>({})
  const [bulkText, setBulkText] = useState('')
  const [copyId, setCopyId] = useState('')
  const [allConcerts, setAllConcerts] = useState<Array<{ id: string; city: string; concertDate: string; sessionNumber?: string | null; sortOrder: number; tour: Tour }>>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [concertResponse, toursResponse, concertsResponse] = await Promise.all([fetch(`/api/admin/music/concerts/${concertId}`), fetch('/api/admin/music/tours'), fetch(`/api/admin/music/concerts?mode=copy-options&excludeId=${encodeURIComponent(concertId)}`)])
    const data = await concertResponse.json().catch(() => null)
    if (!concertResponse.ok) return setError(data?.message || '场次加载失败')
    const item = data.concert as Concert
    setConcert(item)
    setForm({ tourId: item.tourId, title: item.title || '', concertDate: item.concertDate.slice(0,10), city: item.city, countryOrRegion: item.countryOrRegion || '中国', venue: item.venue || '', posterUrl: item.posterUrl || '', description: item.description || '', status: item.status })
    setSetlist(item.setlist.map((row, index) => ({ ...row, position: index + 1, displayName: row.displayName || '', versionName: row.versionName || '', note: row.note || '' })))
    setHighlights(item.highlights.map((row, index) => ({ ...row, sortOrder: index })))
    if (toursResponse.ok) setTours(((await toursResponse.json()).tours || []).map((tour: Tour) => ({ id: tour.id, name: tour.name })))
    if (concertsResponse.ok) setAllConcerts((await concertsResponse.json()).concerts || [])
    setDirty(false)
  }, [concertId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function updateForm(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); setDirty(true) }
  function updateSetlist(index: number, patch: Partial<SetlistItem>) { setSetlist((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); setDirty(true) }
  function move<T>(items: T[], index: number, direction: -1 | 1, setter: (value: T[]) => void) {
    const target = index + direction; if (target < 0 || target >= items.length) return
    const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; setter(next); setDirty(true)
  }
  function drop(event: DragEvent, target: number) {
    event.preventDefault(); const source = Number(event.dataTransfer.getData('text/plain')); if (!Number.isInteger(source) || source === target) return
    const next = [...setlist]; const [item] = next.splice(source, 1); next.splice(target, 0, item); setSetlist(next); setDirty(true)
  }
  async function searchSong(index: number, query: string) {
    if (!query.trim()) return setSearches((current) => ({ ...current, [index]: [] }))
    const response = await fetch(`/api/admin/music/live-song-options?q=${encodeURIComponent(query)}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setSearches((current) => ({ ...current, [index]: data.songs || [] }))
  }
  async function bulkAdd() {
    const response = await fetch('/api/admin/music/live-song-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: bulkText }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) return setError(data?.message || '批量匹配失败')
    setSetlist((current) => [...current, ...(data.items || []).map((item: { displayName: string; songId: string | null; candidates: SongOption[] }, index: number) => ({ ...newItem(current.length + index + 1), ...item }))])
    setBulkText(''); setDirty(true)
  }
  async function copySetlist() {
    if (!copyId) return
    const response = await fetch(`/api/admin/music/concerts/${copyId}`); const data = await response.json().catch(() => null)
    if (!response.ok) return setError(data?.message || '复制来源加载失败')
    setSetlist(data.concert.setlist.map((row: SetlistItem, index: number) => ({ ...row, id: undefined, position: index + 1, displayName: row.displayName || '', versionName: row.versionName || '', note: row.note || '' })))
    setCopyId('')
    setMessage('歌单已复制到当前编辑器，尚未写入数据库；请确认后保存。'); setDirty(true)
  }
  async function save(event?: FormEvent, nextStatus?: Concert['status']) {
    event?.preventDefault(); if (busy) return
    if (setlist.some((item) => !item.songId && !item.displayName.trim())) return setError('歌单存在空白行，请关联歌曲、填写显示名称或删除该行')
    setBusy(true); setError(''); setMessage('')
    const response = await fetch(`/api/admin/music/concerts/${concertId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, status: nextStatus || form.status, setlist: setlist.map((item, index) => ({ ...item, position: index + 1 })), highlights: highlights.map((item, index) => ({ ...item, sortOrder: index })) }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '保存失败')
    else { setMessage(data.message); await load() }
    setBusy(false)
  }
  if (!concert) return <main className="mx-auto max-w-6xl p-6">{error ? <p role="alert" className="bg-red-50 p-4 font-bold text-red-700">{error}</p> : <p className="font-bold text-slate-500">加载中…</p>}</main>
  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5">
    <section className="border border-sky-100 bg-white/90 p-6"><Link href="/admin/music/concerts" onClick={(event) => { if (dirty && !window.confirm('有未保存修改，确定离开吗？')) event.preventDefault() }} className="text-sm font-black text-brand-700">← 演唱会管理</Link><div className="mt-4 flex flex-wrap items-center justify-between gap-4"><div><h1 className="break-words text-4xl font-black text-brand-950">{concert.city} · {concert.concertDate.slice(0,10)}</h1><p className="mt-2 text-sm font-bold text-slate-500">{dirty ? '有未保存修改' : concert.status === 'PUBLISHED' ? '已发布' : '草稿'}</p>{concert._count?.UserMusicConcert ? <p className="mt-2 text-sm font-black text-amber-700">已有 {concert._count.UserMusicConcert} 位用户记录看过；不能直接删除，仅建议转为草稿。</p> : null}</div><button type="button" onClick={() => void save(undefined, concert.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')} className="bg-emerald-700 px-5 py-3 text-sm font-black text-white">{concert.status === 'PUBLISHED' ? '转为草稿' : '发布场次'}</button></div></section>
    {message ? <p role="status" className="bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}{error ? <p role="alert" className="bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
    <form onSubmit={save} className="space-y-6">
      <section className="border border-sky-100 bg-white/90 p-5 sm:p-7"><h2 className="text-2xl font-black text-brand-950">基本信息</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-black">所属巡演<select required value={form.tourId} onChange={(e) => updateForm('tourId', e.target.value)} className={`${field} mt-1`}>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
        <label className="text-sm font-black">演出日期<input required type="date" value={form.concertDate} onChange={(e) => updateForm('concertDate', e.target.value)} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black">城市<input required value={form.city} onChange={(e) => updateForm('city', e.target.value)} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black">国家或地区<input value={form.countryOrRegion} onChange={(e) => updateForm('countryOrRegion', e.target.value)} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black">场馆<input value={form.venue} onChange={(e) => updateForm('venue', e.target.value)} className={`${field} mt-1`} /></label>
        <div className="text-sm font-black">系统场次编号<div className={`${field} mt-1 bg-sky-50 text-brand-800`}>第 {concert.sessionNumber || concert.sortOrder || 1} 场（自动排序）</div></div>
        <label className="text-sm font-black">自定义标题<input value={form.title} onChange={(e) => updateForm('title', e.target.value)} className={`${field} mt-1`} /></label>
        <label className="text-sm font-black sm:col-span-2 lg:col-span-4">介绍<textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} className={`${field} mt-1 min-h-28`} /></label>
      </div><div className="mt-6"><MusicCoverUploader entityType="concert" entityId={concertId} currentUrl={form.posterUrl || concert.posterUrl} onUploaded={(posterUrl) => { setConcert((current) => current ? { ...current, posterUrl } : current); setForm((current) => ({ ...current, posterUrl })); setDirty(true) }} /></div></section>
      <section className="border border-sky-100 bg-white/90 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black text-brand-950">现场歌单</h2><button type="button" onClick={() => { setSetlist((current) => [...current, newItem(current.length + 1)]); setDirty(true) }} className="bg-brand-950 px-4 py-2 text-sm font-black text-white">新增一行</button></div>
        <div className="mt-5 grid gap-3 border border-sky-100 bg-sky-50/50 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"><textarea aria-label="批量粘贴歌单" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={'批量粘贴歌单，每行一首\n1. 任我行\n2. 人来人往'} className={`${field} min-h-24`} /><button type="button" onClick={() => void bulkAdd()} disabled={!bulkText.trim()} className="bg-brand-700 px-4 py-2 font-black text-white disabled:opacity-50">解析并加入</button></div>
        <div className="mt-4 flex flex-wrap gap-2"><select aria-label="复制已有场次歌单" value={copyId} onChange={(e) => setCopyId(e.target.value)} className={`${field} max-w-xl`}><option value="">选择其他场次复制歌单</option>{allConcerts.map((row) => <option key={row.id} value={row.id}>{row.tour.name} · {row.city} · {row.concertDate.slice(0,10)} · #{String(Number(row.sessionNumber || row.sortOrder || 1)).padStart(3, '0')}</option>)}</select><button type="button" onClick={() => void copySetlist()} disabled={!copyId} className="bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">复制到编辑器</button></div>
        <div className="mt-5 space-y-3">{setlist.map((item, index) => <article key={`${item.id || 'new'}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, index)} className="border border-sky-100 bg-white p-4 shadow-sm"><div className="grid min-w-0 gap-3 lg:grid-cols-[40px_130px_minmax(160px,1fr)_minmax(140px,1fr)_auto] lg:items-start"><span aria-label={`第 ${index + 1} 首，可拖动排序`} className="cursor-grab py-2 text-center font-black text-brand-500">≡ {index + 1}</span><select aria-label={`第 ${index + 1} 行段落`} value={item.section} onChange={(e) => updateSetlist(index, { section: e.target.value })} className={field}>{sections.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><div className="relative"><input aria-label={`搜索第 ${index + 1} 行歌曲`} defaultValue={item.song?.title || ''} onChange={(e) => void searchSong(index, e.target.value)} placeholder="搜索并关联歌曲" className={field} />{searches[index]?.length ? <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto border border-sky-100 bg-white shadow-xl">{searches[index].map((song) => <button key={song.id} type="button" onClick={() => { updateSetlist(index, { songId: song.id, song, displayName: item.displayName || song.title }); setSearches((current) => ({ ...current, [index]: [] })) }} className="block w-full border-b border-sky-50 p-2 text-left text-xs hover:bg-sky-50"><strong>{song.title}</strong><span className="block text-slate-500">{song.album} · {song.releaseYear}</span></button>)}</div> : null}{item.songId ? <button type="button" onClick={() => updateSetlist(index, { songId: null, song: null })} className="mt-1 text-xs font-black text-red-600">清除关联</button> : null}</div><input aria-label={`第 ${index + 1} 行显示名称`} value={item.displayName} onChange={(e) => updateSetlist(index, { displayName: e.target.value })} placeholder="显示名称" className={field} /><div className="flex gap-1"><button type="button" aria-label="上移" disabled={index === 0} onClick={() => move(setlist, index, -1, setSetlist)} className="bg-sky-50 px-2 py-2 font-black disabled:opacity-30">↑</button><button type="button" aria-label="下移" disabled={index === setlist.length - 1} onClick={() => move(setlist, index, 1, setSetlist)} className="bg-sky-50 px-2 py-2 font-black disabled:opacity-30">↓</button><button type="button" aria-label="删除歌单行" onClick={() => { setSetlist(setlist.filter((_, rowIndex) => rowIndex !== index)); setDirty(true) }} className="bg-red-50 px-2 py-2 font-black text-red-700">删</button></div></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><input aria-label={`第 ${index + 1} 行版本说明`} value={item.versionName} onChange={(e) => updateSetlist(index, { versionName: e.target.value })} placeholder="版本说明" className={field} /><input aria-label={`第 ${index + 1} 行备注`} value={item.note} onChange={(e) => updateSetlist(index, { note: e.target.value })} placeholder="备注" className={field} /></div>
          <div className="mt-3 flex flex-wrap gap-3">{[['isEncore','Encore'],['isRequest','点歌'],['isDebut','首唱'],['isGuest','嘉宾'],['isMedley','串烧'],['isSpecial','特别演唱']].map(([key,label]) => <label key={key} className="flex items-center gap-1 text-xs font-black"><input type="checkbox" checked={Boolean(item[key as keyof SetlistItem])} onChange={(e) => updateSetlist(index, { [key]: e.target.checked })} />{label}</label>)}</div>
          {item.candidates && item.candidates.length > 1 && !item.songId ? <div className="mt-3 border-l-4 border-amber-400 bg-amber-50 p-3 text-xs"><strong>发现多个同名版本，未自动关联：</strong>{item.candidates.map((song) => <button key={song.id} type="button" onClick={() => updateSetlist(index, { songId: song.id, song })} className="ml-2 underline">{song.album} · {song.releaseYear}</button>)}</div> : null}
        </article>)}</div>{!setlist.length ? <p className="mt-5 text-sm font-bold text-slate-500">暂无歌单，点击“新增一行”或批量粘贴。</p> : null}
      </section>
      <section className="border border-sky-100 bg-white/90 p-5 sm:p-7"><div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black text-brand-950">特别时刻</h2><button type="button" onClick={() => { setHighlights((current) => [...current, { type: 'OTHER', title: '', content: '', sortOrder: current.length }]); setDirty(true) }} className="bg-brand-950 px-4 py-2 text-sm font-black text-white">新增特别时刻</button></div><div className="mt-5 space-y-3">{highlights.map((item, index) => <article key={`${item.id || 'new'}-${index}`} className="grid gap-3 border border-sky-100 p-4 lg:grid-cols-[140px_minmax(0,1fr)_auto]"><select aria-label={`特别时刻 ${index + 1} 类型`} value={item.type} onChange={(e) => { setHighlights(highlights.map((row, rowIndex) => rowIndex === index ? { ...row, type: e.target.value } : row)); setDirty(true) }} className={field}>{highlightTypes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><div className="space-y-3"><input required aria-label={`特别时刻 ${index + 1} 标题`} value={item.title} onChange={(e) => { setHighlights(highlights.map((row, rowIndex) => rowIndex === index ? { ...row, title: e.target.value } : row)); setDirty(true) }} placeholder="标题" className={field} /><textarea required aria-label={`特别时刻 ${index + 1} 内容`} value={item.content} onChange={(e) => { setHighlights(highlights.map((row, rowIndex) => rowIndex === index ? { ...row, content: e.target.value } : row)); setDirty(true) }} placeholder="内容（支持换行）" className={`${field} min-h-24`} /></div><div className="flex gap-1"><button type="button" aria-label="上移特别时刻" disabled={index === 0} onClick={() => move(highlights, index, -1, setHighlights)} className="bg-sky-50 px-2">↑</button><button type="button" aria-label="下移特别时刻" disabled={index === highlights.length - 1} onClick={() => move(highlights, index, 1, setHighlights)} className="bg-sky-50 px-2">↓</button><button type="button" aria-label="删除特别时刻" onClick={() => { setHighlights(highlights.filter((_, rowIndex) => rowIndex !== index)); setDirty(true) }} className="bg-red-50 px-2 text-red-700">删</button></div></article>)}</div></section>
      <div className="admin-save-bar sticky bottom-20 z-30 flex justify-end border border-sky-100 bg-white/95 p-3 shadow-xl md:bottom-4"><button disabled={busy} className="bg-brand-950 px-7 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '事务保存中…' : '保存基本信息、歌单和特别时刻'}</button></div>
    </form>
  </main>
}
