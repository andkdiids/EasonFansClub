'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatLiveDate } from '@/lib/music-live'

type Concert = { id: string; title?: string | null; concertDate: string; city: string; venue?: string | null; sessionNumber?: string | null; songCount: number; hasHighlights: boolean }

export function LiveConcertList({ concerts }: { concerts: Concert[] }) {
  const [year, setYear] = useState('')
  const [city, setCity] = useState('')
  const years = [...new Set(concerts.map((concert) => concert.concertDate.slice(0, 4)))].sort()
  const cities = [...new Set(concerts.map((concert) => concert.city))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const filtered = useMemo(() => concerts.filter((concert) => (!year || concert.concertDate.startsWith(year)) && (!city || concert.city === city)), [concerts, year, city])
  return <section className="mt-14" aria-labelledby="tour-concerts-title"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CONCERT ARCHIVE</p><h2 id="tour-concerts-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">演唱会场次</h2></div><div className="flex gap-2"><label className="text-xs font-black text-sky-100/70">年份<select value={year} onChange={(event) => setYear(event.target.value)} className="ml-2 border border-white/15 bg-[#07182d] px-3 py-2 text-white"><option value="">全部</option>{years.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-black text-sky-100/70">城市<select value={city} onChange={(event) => setCity(event.target.value)} className="ml-2 max-w-32 border border-white/15 bg-[#07182d] px-3 py-2 text-white"><option value="">全部</option>{cities.map((value) => <option key={value}>{value}</option>)}</select></label></div></div>
    <div className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((concert) => <Link key={concert.id} href={`/music/live/concerts/${concert.id}`} className="min-w-0 border border-white/10 bg-white/[0.055] p-5 transition hover:border-sky-300/30 hover:bg-white/[0.09]"><time className="text-xs font-black text-sky-300/70">{formatLiveDate(concert.concertDate)}</time><h3 className="mt-2 break-words text-xl font-black text-white">{concert.title || concert.city}</h3><p className="mt-2 break-words text-sm font-bold text-slate-300/65">{concert.venue || '场馆待整理'}{concert.sessionNumber ? ` · ${concert.sessionNumber}` : ''}</p><p className="mt-4 text-xs font-black text-sky-100/65">{concert.songCount} 首{concert.hasHighlights ? ' · 含特别时刻' : ''}</p></Link>)}</div>
    {!filtered.length ? <p className="mt-7 border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300">没有符合筛选条件的场次。</p> : null}
  </section>
}
