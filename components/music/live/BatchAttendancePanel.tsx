'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type BatchConcert = {
  id: string
  title: string | null
  concertDate: string
  startTime: string | null
  venue: string | null
  sessionNumber: string | null
  attended: boolean
}

type BatchCity = {
  id: string
  name: string
  label: string
  concerts: BatchConcert[]
}

type BatchTour = {
  id: string
  name: string
  cities: BatchCity[]
}

type BatchCatalog = { tours: BatchTour[] }

type BatchAttendancePanelProps = {
  open: boolean
  tourId?: string
  onClose: () => void
  onSaved: (message: string) => void
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日期待整理' : dateFormatter.format(date)
}

function formatTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : timeFormatter.format(date)
}

function hasSetChanged(current: ReadonlySet<string>, initial: ReadonlySet<string>) {
  if (current.size !== initial.size) return true
  for (const id of current) if (!initial.has(id)) return true
  return false
}

export function BatchAttendancePanel({ open, tourId, onClose, onSaved }: Readonly<BatchAttendancePanelProps>) {
  const searchRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [catalog, setCatalog] = useState<BatchCatalog | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [initialSelectedIds, setInitialSelectedIds] = useState<Set<string>>(new Set())
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadCatalog = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    setCatalog(null)
    try {
      const queryString = tourId ? `?tourId=${encodeURIComponent(tourId)}` : ''
      const response = await fetch(`/api/music/live/attendance/bulk${queryString}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      const data = await response.json().catch(() => null) as BatchCatalog & { message?: string } | null
      if (!response.ok || !data || !Array.isArray(data.tours)) throw new Error(data?.message || '批量场次加载失败，请稍后重试')
      const attended = new Set(
        data.tours.flatMap((tour) => tour.cities.flatMap((city) => city.concerts.filter((concert) => concert.attended).map((concert) => concert.id))),
      )
      setCatalog(data)
      setSelectedIds(new Set(attended))
      setInitialSelectedIds(new Set(attended))
      setExpandedCities(new Set())
      setQuery('')
      window.setTimeout(() => searchRef.current?.focus(), 0)
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      setError(loadError instanceof Error ? loadError.message : '批量场次加载失败，请稍后重试')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      setLoading(false)
    }
  }, [tourId])

  useEffect(() => {
    if (!open) return undefined
    void loadCatalog()
    return () => requestRef.current?.abort()
  }, [open, loadCatalog])

  const changed = useMemo(() => hasSetChanged(selectedIds, initialSelectedIds), [selectedIds, initialSelectedIds])
  const newCount = useMemo(() => [...selectedIds].filter((id) => !initialSelectedIds.has(id)).length, [selectedIds, initialSelectedIds])
  const removeCount = useMemo(() => [...initialSelectedIds].filter((id) => !selectedIds.has(id)).length, [selectedIds, initialSelectedIds])
  const filterText = query.trim().toLocaleLowerCase('zh-CN')
  const filteredTours = useMemo(() => {
    if (!catalog || !filterText) return catalog?.tours || []
    return catalog.tours.map((tour) => ({
      ...tour,
      cities: tour.cities.flatMap((city) => {
        const cityMatches = city.name.toLocaleLowerCase('zh-CN').includes(filterText)
        const concerts = cityMatches ? city.concerts : city.concerts.filter((concert) => [
          concert.venue || '',
          concert.title || '',
          formatDate(concert.concertDate),
        ].some((value) => value.toLocaleLowerCase('zh-CN').includes(filterText)))
        return concerts.length ? [{ ...city, concerts }] : []
      }),
    })).filter((tour) => tour.cities.length)
  }, [catalog, filterText])

  const requestClose = useCallback(() => {
    if (busy) return
    if (changed && !window.confirm('还有未保存的场次选择，确定关闭吗？')) return
    onClose()
  }, [busy, changed, onClose])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      requestRef.current?.abort()
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, requestClose])

  function toggleExpanded(cityKey: string) {
    setExpandedCities((current) => {
      const next = new Set(current)
      if (next.has(cityKey)) next.delete(cityKey)
      else next.add(cityKey)
      return next
    })
  }

  function toggleShow(showId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(showId)) next.delete(showId)
      else next.add(showId)
      return next
    })
  }

  function toggleCity(city: BatchCity) {
    const allSelected = city.concerts.every((concert) => selectedIds.has(concert.id))
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const concert of city.concerts) {
        if (allSelected) next.delete(concert.id)
        else next.add(concert.id)
      }
      return next
    })
  }

  async function save() {
    if (busy || !catalog) return
    const addShowIds = [...selectedIds].filter((id) => !initialSelectedIds.has(id))
    const removeShowIds = [...initialSelectedIds].filter((id) => !selectedIds.has(id))
    if (!addShowIds.length && !removeShowIds.length) {
      onClose()
      onSaved(`已更新我的现场，共记录 ${selectedIds.size} 场`)
      return
    }

    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/music/live/attendance/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ tourId, addShowIds, removeShowIds }),
      })
      const data = await response.json().catch(() => null) as { message?: string; recordedCount?: number } | null
      if (!response.ok) {
        setError(data?.message || '保存失败，请稍后重试')
        return
      }
      const message = data?.message || `已更新我的现场，共记录 ${data?.recordedCount ?? selectedIds.size} 场`
      window.dispatchEvent(new CustomEvent('music-live:attendance-updated'))
      onClose()
      onSaved(message)
    } catch (saveError) {
      console.error('[music.live.attendance.bulk.save]', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return <div className="fixed inset-0 z-[var(--layer-dialog)] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <div role="dialog" aria-modal="true" aria-labelledby="batch-attendance-title" className="flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden border border-sky-200/20 bg-[#07182d] shadow-2xl sm:h-[calc(100dvh-32px)] sm:max-h-[900px]">
      <header className="shrink-0 border-b border-white/10 px-4 pb-4 pt-5 sm:px-7 sm:pt-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">

            <h2 id="batch-attendance-title" className="text-2xl font-black text-white sm:text-3xl">批量添加场次</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-300/70">一次选择多个城市和场次，保存后统一更新你的现场记录。</p>
          </div>
          <button type="button" onClick={requestClose} disabled={busy} aria-label="关闭批量添加场次" className="shrink-0 px-2 py-1 text-2xl leading-none text-slate-300 disabled:opacity-50">×</button>
        </div>
        <label className="mt-5 block">
          <span className="sr-only">搜索城市、场馆或日期</span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-sky-300" placeholder="搜索城市 / 场馆 / 日期" />
        </label>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
        {loading ? <p className="border border-white/10 p-6 text-sm font-bold text-slate-300">正在加载可登记的场次…</p> : null}
        {!loading && error ? <div className="border border-red-300/20 bg-red-300/10 p-4"><p role="alert" className="text-sm font-bold text-red-200">{error}</p><button type="button" onClick={() => void loadCatalog()} className="mt-3 border border-red-200/30 px-4 py-2 text-sm font-black text-red-100">重新加载</button></div> : null}
        {!loading && !error && catalog && !catalog.tours.length ? <p className="border border-white/10 p-6 text-sm font-bold text-slate-300">当前没有可登记的已公开场次。</p> : null}
        {!loading && !error && catalog && catalog.tours.length && !filteredTours.length ? <p className="border border-white/10 p-6 text-sm font-bold text-slate-300">没有找到匹配的城市或场次。</p> : null}
        <div className="space-y-6">
          {filteredTours.map((tour) => <section key={tour.id} aria-label={`${tour.name}批量选择`}>
            <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-white/10 pb-2">
              <h3 className="min-w-0 break-words text-lg font-black text-sky-100">{tour.name}</h3>
              <span className="shrink-0 text-xs font-bold text-slate-400">{tour.cities.reduce((count, city) => count + city.concerts.length, 0)} 场</span>
            </div>
            <div className="space-y-2">
              {tour.cities.map((city) => {
                const cityKey = `${tour.id}:${city.id}`
                const sourceCity = catalog?.tours.find((item) => item.id === tour.id)?.cities.find((item) => item.id === city.id) || city
                const expanded = expandedCities.has(cityKey)
                const allSelected = sourceCity.concerts.every((concert) => selectedIds.has(concert.id))
                const selectedInCity = sourceCity.concerts.filter((concert) => selectedIds.has(concert.id)).length
                return <div key={cityKey} className="overflow-hidden border border-white/10 bg-white/[0.035]">
                  <div className="flex min-w-0 items-stretch">
                    <button type="button" onClick={() => toggleExpanded(cityKey)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left hover:bg-white/[0.06] sm:px-4">
                      <span aria-hidden="true" className="w-4 shrink-0 text-sky-200">{expanded ? '▼' : '▶'}</span>
                      <span className="min-w-0 break-words font-black text-white">{city.name}</span>
                      {city.label ? <span className="shrink-0 border border-sky-300/20 px-1.5 py-0.5 text-[10px] font-black text-sky-100/75">{city.label}</span> : null}
                      <span className="ml-auto shrink-0 text-xs font-bold text-slate-400">{selectedInCity}/{city.concerts.length}</span>
                    </button>
                    <button type="button" onClick={() => toggleCity(sourceCity)} className="shrink-0 border-l border-white/10 px-3 text-xs font-black text-sky-200 hover:bg-white/[0.06] sm:px-4">{allSelected ? '取消全选' : '全选'}</button>
                  </div>
                  {expanded ? <div className="border-t border-white/10 px-2 py-2 sm:px-3">
                    {city.concerts.map((concert) => {
                      const selected = selectedIds.has(concert.id)
                      const wasAttended = initialSelectedIds.has(concert.id)
                      const time = formatTime(concert.startTime)
                      return <label key={concert.id} className={`flex min-w-0 cursor-pointer items-start gap-3 border-b border-white/[0.07] px-2 py-3 last:border-b-0 sm:px-3 ${selected ? 'bg-sky-300/[0.07]' : 'hover:bg-white/[0.04]'}`}>
                        <input type="checkbox" checked={selected} onChange={() => toggleShow(concert.id)} className="mt-1 size-4 shrink-0 accent-sky-300" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-black text-white"><span>{formatDate(concert.concertDate)}</span>{time ? <span className="text-slate-400">{time}</span> : null}{wasAttended ? <span className={`text-xs ${selected ? 'text-emerald-200' : 'text-amber-200'}`}>{selected ? '✓ 已添加' : '已添加 · 将移除'}</span> : selected ? <span className="text-xs text-sky-200">本次新增</span> : null}</span>
                          <span className="mt-1 block break-words text-xs font-bold text-slate-400">{concert.venue || '场馆待整理'}{concert.sessionNumber ? ` · 第 ${concert.sessionNumber} 场` : ''}</span>
                        </span>
                      </label>
                    })}
                  </div> : null}
                </div>
              })}
            </div>
          </section>)}
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 shrink-0 border-t border-white/10 bg-[#07182d]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:px-7 sm:py-4 sm:pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="text-base font-black text-white">已选择 {selectedIds.size} 场</p>{changed ? <p className="mt-1 text-xs font-bold text-slate-400">本次新增 {newCount} 场{removeCount ? ` · 将移除 ${removeCount} 场` : ''}</p> : <p className="mt-1 text-xs font-bold text-slate-400">历史已添加场次已默认选中</p>}</div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0"><button type="button" onClick={requestClose} disabled={busy} className="border border-white/15 px-5 py-3 text-sm font-black text-white disabled:opacity-50">取消</button><button type="button" onClick={() => void save()} disabled={busy || loading || !catalog} className="bg-sky-100 px-5 py-3 text-sm font-black text-[#06101d] disabled:opacity-50">{busy ? '保存中…' : '确认添加'}</button></div>
        </div>
      </footer>
    </div>
  </div>
}
