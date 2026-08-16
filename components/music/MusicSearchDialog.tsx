'use client'

import NextImage from 'next/image'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useEffect, useState, type ComponentProps, type FormEvent } from 'react'
import { generateArchiveSlug, buildConcertSlugPath } from '@/lib/music-slug'
import { publicImageVariantUrl } from '@/lib/image-variants'

type Result = {
  query: string
  albums: Array<{ id: string; type: 'album'; name: string; artist: string; releaseYear: number; coverUrl?: string | null }>
  songs: Array<{ id: string; type: 'song'; title: string; artist: string; releaseYear: number; coverUrl?: string | null; hasPreview: boolean; lyricist?: string | null; composer?: string | null; arranger?: string | null; lyricSnippet?: string | null; album: { id: string; name: string; artist: string } }>
  tours: Array<{ id: string; type: 'tour'; name: string; subtitle?: string | null; startDate?: string | null; endDate?: string | null; concertCount: number }>
  concerts: Array<{ id: string; type: 'concert'; title?: string | null; concertDate: string; city: string; venue?: string | null; stageType: 'NORMAL' | 'ENCORE' | 'FINAL'; tour: { id: string; name: string } }>
}
type MusicSearchDialogProps = { variant?: 'default' | 'glass'; label?: string }

function PublicImage({ src, ...props }: ComponentProps<typeof NextImage>) {
  const normalizedSrc = typeof src === 'string' ? publicImageVariantUrl(src, 'thumb-sm') || src : src
  return <NextImage {...props} src={normalizedSrc} />
}

const Image = PublicImage

export function MusicSearchDialog({ variant = 'default', label = '搜索专辑、歌曲、现场' }: Readonly<MusicSearchDialogProps>) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!open) return
    const body = document.body
    const previousOverflow = body.style.overflow
    const previousPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`
    window.dispatchEvent(new CustomEvent('easmusic:search-dialog', { detail: true }))
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPaddingRight
      window.dispatchEvent(new CustomEvent('easmusic:search-dialog', { detail: false }))
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    const response = await fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}`)
    const data = await response.json().catch(() => null)
    setResult(response.ok ? data : { albums: [], songs: [], tours: [], concerts: [] })
    setLoading(false)
  }

  const triggerClassName = variant === 'glass'
    ? 'inline-flex items-center gap-2 rounded-[10px] border border-white/[0.16] bg-slate-950/25 px-5 py-3 text-sm font-bold text-white/90 backdrop-blur-xl transition hover:border-sky-200/25 hover:bg-white/[0.1] hover:text-white'
    : 'inline-flex items-center gap-2 rounded-full border border-sky-100 bg-white px-6 py-3 text-sm font-black text-brand-950 shadow-lg shadow-sky-950/10 transition hover:-translate-y-0.5 hover:shadow-xl'

  const dialog = mounted && open ? createPortal(<div role="dialog" aria-modal="true" aria-label="搜索音乐资料" className="fixed inset-0 z-[var(--layer-dialog)] grid place-items-center bg-[rgba(3,10,20,.72)] p-4 backdrop-blur-[18px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <div className="max-h-[84vh] w-[90%] max-w-[720px] overflow-y-auto rounded-[26px] border border-white/[0.12] bg-[#07182d]/90 p-5 text-white shadow-[0_28px_90px_rgba(0,0,0,.42)] backdrop-blur-2xl sm:p-7">
      <div className="flex items-center justify-between gap-4"><div><p className="text-[10px] font-black tracking-[0.22em] text-sky-300/60 sm:text-xs">EasMusic</p><h2 className="mt-1 text-2xl font-black">搜索音乐资料</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="关闭搜索" className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-xl text-white transition hover:bg-white/[0.12]">×</button></div>
      <form onSubmit={search} className="mt-6 flex gap-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌曲、专辑、歌词、巡演、场次……" className="min-w-0 flex-1 rounded-2xl border border-white/[0.12] bg-white/[0.07] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-400 focus:border-sky-300/40" /><button className="rounded-2xl border border-white/[0.12] bg-white/[0.1] px-5 text-sm font-black text-white transition hover:bg-white/[0.14]">{loading ? '搜索中' : '搜索'}</button></form>
      {result ? <div className="mt-7 space-y-7"><section><h3 className="text-xs font-black tracking-[0.18em] text-sky-300/65">专辑</h3><div className="mt-3 grid gap-2">{result.albums.map((album) => <Link key={album.id} href={`/music/album/${album.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3 transition hover:bg-white/[0.1]"><span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.08] text-sky-200/60">{album.coverUrl ? <Image src={album.coverUrl} alt={`${album.name}专辑封面`} fill sizes="48px" loading="lazy" className="object-cover" /> : '♪'}</span><span className="min-w-0 flex-1"><span className="block truncate font-black text-white">{album.name}</span><span className="mt-1 block truncate text-xs font-bold text-slate-300/55">专辑 · {album.artist} · {album.releaseYear}</span></span></Link>)}{result.albums.length === 0 ? <p className="text-sm font-bold text-slate-400">没有匹配专辑</p> : null}</div></section>
      <section><h3 className="text-xs font-black tracking-[0.18em] text-sky-300/65">巡演</h3><div className="mt-3 grid gap-2">{result.tours.map((tour) => <Link key={tour.id} href={`/music/live/tours/${generateArchiveSlug(tour.name)}`} className="block rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3 transition hover:bg-white/[0.1]"><span className="block break-words font-black text-white">{tour.name}</span><span className="mt-1 block text-xs font-bold text-slate-300/55">巡演 · {tour.startDate?.slice(0, 10) || '时间待整理'} · {tour.concertCount} 场</span></Link>)}{result.tours.length === 0 ? <p className="text-sm font-bold text-slate-400">没有匹配巡演</p> : null}</div></section>
      <section><h3 className="text-xs font-black tracking-[0.18em] text-sky-300/65">演唱会</h3><div className="mt-3 grid gap-2">{result.concerts.map((concert) => <Link key={concert.id} href={buildConcertSlugPath(concert.tour.name, concert.city, concert.concertDate, concert.stageType)} className="block rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3 transition hover:bg-white/[0.1]"><span className="block break-words font-black text-white">{concert.title || `${concert.city} · ${concert.concertDate.slice(0, 10)}`}</span><span className="mt-1 block break-words text-xs font-bold text-slate-300/55">演唱会 · {concert.venue || '场馆待整理'} · {concert.tour.name}</span></Link>)}{result.concerts.length === 0 ? <p className="text-sm font-bold text-slate-400">没有匹配演唱会</p> : null}</div></section>
      <section><h3 className="text-xs font-black tracking-[0.18em] text-sky-300/65">歌曲</h3><div className="mt-3 grid gap-2">{result.songs.map((song) => <Link key={song.id} href={`/music/song/${song.id}`} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3 transition hover:bg-white/[0.1]"><span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.08] text-xl text-sky-200/60">{song.coverUrl ? <Image src={song.coverUrl} alt={`${song.title}封面`} fill sizes="48px" loading="lazy" className="object-cover" /> : '♪'}</span><span className="min-w-0 flex-1"><span className="block truncate font-black text-white">{song.title}</span><span className="mt-1 block truncate text-xs font-bold text-slate-300/55">歌曲 · {song.album.name} · {song.artist || song.album.artist} · {song.releaseYear} · {song.hasPreview ? '支持试听' : '暂无试听'}</span>{song.lyricSnippet ? <span className="mt-2 block line-clamp-2 text-xs font-medium leading-5 text-sky-100/70">歌词命中：{song.lyricSnippet}</span> : null}</span></Link>)}{result.songs.length === 0 ? <p className="text-sm font-bold text-slate-400">没有匹配歌曲</p> : null}</div></section></div> : null}
    </div>
  </div>, document.body) : null

  return <><button type="button" onClick={() => setOpen(true)} className={triggerClassName}><span aria-hidden="true" className="text-lg font-normal text-sky-200/75">⌕</span>{label}</button>{dialog}</>
}
