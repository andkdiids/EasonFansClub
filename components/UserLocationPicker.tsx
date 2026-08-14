'use client'

import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  formatUserLocation,
  getLocationCountry,
  getLocationRegions,
  searchAllLocationRegions,
  searchLocationCountries,
  type LocationCountry,
  type UserLocation,
} from '@/lib/user-location'

export function UserLocationPicker({ value, onChange }: { value: UserLocation | null; onChange: (value: UserLocation | null) => void }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedCountryCode, setSelectedCountryCode] = useState(value?.countryCode || '')

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const selectedCountry = selectedCountryCode ? getLocationCountry(selectedCountryCode) : null
  const countryResults = useMemo(() => searchLocationCountries(query), [query])
  const globalRegionResults = useMemo(() => selectedCountryCode ? [] : searchAllLocationRegions(query).slice(0, 30), [query, selectedCountryCode])
  const regionResults = useMemo(() => selectedCountryCode ? getLocationRegions(selectedCountryCode).filter((item) => {
    const text = `${item.code} ${item.name} ${(item.aliases || []).join(' ')}`.toLocaleLowerCase()
    return !query.trim() || text.includes(query.trim().toLocaleLowerCase())
  }) : [], [query, selectedCountryCode])

  function chooseCountry(country: LocationCountry) {
    setSelectedCountryCode(country.code)
    setQuery('')
  }

  function chooseCountryOnly() {
    if (!selectedCountry) return
    onChange({ countryCode: selectedCountry.code, countryName: selectedCountry.name, regionCode: null, regionName: null })
    setOpen(false)
  }

  function chooseRegion(regionCode: string, regionName: string) {
    if (!selectedCountry) return
    onChange({ countryCode: selectedCountry.code, countryName: selectedCountry.name, regionCode, regionName })
    setOpen(false)
  }

  function openPicker() {
    setSelectedCountryCode(value?.countryCode || '')
    setQuery('')
    setOpen(true)
  }

  const dialog = mounted && open
    ? createPortal(
      <div className="fixed inset-0 z-[var(--layer-dialog)] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="location-picker-title" className="flex max-h-[min(760px,92dvh)] w-full min-w-0 flex-col overflow-hidden rounded-t-[28px] border border-sky-100 bg-white shadow-2xl sm:max-w-2xl sm:rounded-[28px]">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-sky-100 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs font-black tracking-[0.18em] text-sky-700">个人资料</p>
              <h2 id="location-picker-title" className="mt-1 text-lg font-black text-brand-950">选择地区</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="min-h-10 shrink-0 rounded-full border border-sky-100 px-3 text-sm font-black text-brand-700">关闭</button>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              {selectedCountry ? (
                <button type="button" onClick={() => { setSelectedCountryCode(''); setQuery('') }} className="rounded-full bg-sky-50 px-3 py-2 text-sm font-black text-brand-700">
                  {selectedCountry.name} ×
                </button>
              ) : null}
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索国家、地区或城市，例如 东京 / California"
                className="min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-700"
                aria-label="搜索地区"
              />
            </div>

            {selectedCountry ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-brand-950">选择 {selectedCountry.name} 的一级地区</p>
                  <button type="button" onClick={chooseCountryOnly} className="text-xs font-black text-brand-700">仅保存国家/地区</button>
                </div>
                {regionResults.length ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {regionResults.map((item) => (
                      <button key={item.code} type="button" onClick={() => chooseRegion(item.code, item.name)} className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 py-2 text-left text-sm font-bold text-slate-700 transition hover:border-brand-700 hover:bg-sky-50">
                        {item.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl bg-sky-50/70 p-4 text-sm font-bold leading-6 text-slate-500">没有维护该国家/地区的一级行政区，可保存国家/地区本身。</p>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {globalRegionResults.length ? (
                  <div>
                    <p className="text-sm font-black text-brand-950">地区匹配</p>
                    <div className="mt-2 space-y-2">
                      {globalRegionResults.map(({ country, region }) => (
                        <button key={`${country.code}-${region.code}`} type="button" onClick={() => { onChange({ countryCode: country.code, countryName: country.name, regionCode: region.code, regionName: region.name }); setOpen(false) }} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-sky-100 bg-white px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-sky-50">
                          <span>{country.name} · {region.name}</span>
                          <span className="text-xs text-slate-400">选择</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="text-sm font-black text-brand-950">国家 / 地区</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {countryResults.map((country) => (
                      <button key={country.code} type="button" onClick={() => chooseCountry(country)} className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 py-2 text-left text-sm font-bold text-slate-700 transition hover:border-brand-700 hover:bg-sky-50">
                        {country.name}
                      </button>
                    ))}
                  </div>
                  {!countryResults.length ? <p className="mt-4 text-sm font-bold text-slate-500">没有找到匹配的国家或地区。</p> : null}
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-between gap-3 border-t border-sky-100 pt-4">
              <p className="min-w-0 text-xs font-bold leading-5 text-slate-500">地区由你自行设置，与系统显示的 IP 属地无关。</p>
              {value ? <button type="button" onClick={() => { onChange(null); setOpen(false) }} className="shrink-0 text-xs font-black text-red-600">清除地区</button> : null}
            </div>
          </div>
        </section>
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <button type="button" onClick={openPicker} className="mt-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-2 text-left text-sm font-bold text-slate-700 outline-none transition hover:border-brand-700">
        <span className={value ? 'text-brand-950' : 'text-slate-400'}>{formatUserLocation(value) || '选择地区'}</span>
        <span aria-hidden="true" className="text-lg text-slate-400">›</span>
      </button>
      {dialog}
    </>
  )
}
