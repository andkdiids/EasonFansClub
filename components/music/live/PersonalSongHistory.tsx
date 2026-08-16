'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { buildConcertSlugPath } from '@/lib/music-slug'

type SongHistory = {
  occurrenceCount: number
  concertCount: number
  first: { date: string; city: string; tourName: string }
  latest: { date: string; city: string; tourName: string }
  concerts: Array<{ concertId: string; date: string; city: string; venue: string | null; tourName: string; stageType: 'NORMAL' | 'ENCORE' | 'FINAL' }>
}

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

export function PersonalSongHistory({ songId }: Readonly<{ songId: string }>) {
  const [history, setHistory] = useState<SongHistory | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/music/live/me/songs/${songId}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.song) setHistory(data.song) })
      .catch(() => null)
    return () => controller.abort()
  }, [songId])
  if (!history) return null
  return <section className="mt-8 border border-sky-300/15 bg-sky-300/[0.055] p-6 sm:p-8" aria-labelledby="personal-song-history-title">
    <h2 id="personal-song-history-title" className="text-3xl font-black text-white">我的现场记录</h2>
    <dl className="mt-6 grid grid-cols-2 border-y border-white/10 sm:grid-cols-4"><div className="p-4"><dt className="text-xs text-slate-400">现场听过</dt><dd className="mt-1 text-2xl font-black">{history.occurrenceCount} 次</dd></div><div className="border-l border-white/10 p-4"><dt className="text-xs text-slate-400">出现场次</dt><dd className="mt-1 text-2xl font-black">{history.concertCount} 场</dd></div><div className="border-t border-white/10 p-4 sm:border-l sm:border-t-0"><dt className="text-xs text-slate-400">第一次</dt><dd className="mt-1 text-sm font-black">{formatDate(history.first.date)} · {history.first.city} · {history.first.tourName}</dd></div><div className="border-l border-t border-white/10 p-4 sm:border-t-0"><dt className="text-xs text-slate-400">最近一次</dt><dd className="mt-1 text-sm font-black">{formatDate(history.latest.date)} · {history.latest.city} · {history.latest.tourName}</dd></div></dl>
    <div className="mt-5 divide-y divide-white/10 border-y border-white/10">{history.concerts.slice(-5).reverse().map((concert) => <Link key={concert.concertId} href={buildConcertSlugPath(concert.tourName, concert.city, concert.date, concert.stageType)} className="grid min-w-0 gap-1 py-3 hover:bg-white/[0.04] sm:grid-cols-[120px_minmax(0,1fr)]"><time className="text-xs font-black text-sky-200">{formatDate(concert.date)}</time><span className="break-words text-sm font-bold text-slate-200">{concert.city} · {concert.venue || '场馆待整理'} · {concert.tourName}</span></Link>)}</div>
    {history.concertCount > 5 ? <Link href="/music/live/me" className="mt-5 inline-flex text-sm font-black text-sky-200">查看全部现场记录 →</Link> : null}
  </section>
}
