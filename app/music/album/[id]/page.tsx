import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicCover } from '@/components/music/MusicCover'
import { SiteHeader } from '@/components/SiteHeader'
import { formatTrackNumber } from '@/lib/music'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export default async function MusicAlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const album = await prisma.musicAlbum.findFirst({ where: { id, status: 'PUBLISHED' }, include: { songs: { orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }] } } })
  if (!album) notFound()
  return <><SiteHeader /><main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-11"><Link href="/music" className="text-sm font-black text-brand-700">← EasMusic</Link><section className="mt-6 grid items-end gap-8 sm:grid-cols-[minmax(260px,400px)_minmax(0,1fr)] sm:gap-12"><MusicCover src={album.coverUrl} alt={`${album.name}专辑封面`} className="aspect-square w-full rounded-[38px] shadow-2xl shadow-sky-950/20" sizes="(max-width: 640px) 100vw, 400px" /><div className="pb-2"><p className="text-sm font-black tracking-[0.18em] text-brand-700">专辑 · {album.language}</p><h1 className="mt-3 text-5xl font-black tracking-tight text-brand-950 sm:text-7xl">{album.name}</h1><p className="mt-4 text-lg font-bold text-slate-500">{album.artist} · {album.releaseYear}{album.company ? ` · ${album.company}` : ''}</p>{album.releaseDate ? <p className="mt-2 text-xs font-bold text-slate-400">发行日期：{album.releaseDate.toISOString().slice(0, 10)}</p> : null}<p className="mt-7 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{album.description || '专辑介绍正在整理中。'}</p></div></section>
    {album.story ? <section className="mt-10 rounded-[30px] border border-sky-100 bg-white/88 p-6 shadow-sm sm:p-8"><h2 className="text-3xl font-black text-brand-950">专辑故事</h2><p className="mt-5 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{album.story}</p></section> : null}
    <section className="mt-10"><h2 className="text-3xl font-black text-brand-950">歌曲列表</h2>{album.songs.length ? <div className="mt-5 overflow-hidden rounded-[28px] border border-sky-100 bg-white/90 shadow-sm">{album.songs.map((song) => <Link key={song.id} href={`/music/song/${song.id}`} className="grid grid-cols-[38px_minmax(0,1fr)] gap-x-3 border-b border-sky-100 px-4 py-4 last:border-0 hover:bg-sky-50/70 sm:grid-cols-[42px_minmax(0,1fr)_160px_160px] sm:px-6"><span className="font-black text-brand-500">{formatTrackNumber(song.trackNumber)}</span><span className="truncate font-black text-brand-950">{song.title}</span><span className="col-start-2 mt-1 truncate text-xs font-bold text-slate-400 sm:col-start-auto sm:mt-0">作词：{song.lyricist || '待补充'}</span><span className="col-start-2 truncate text-xs font-bold text-slate-400 sm:col-start-auto">作曲：{song.composer || '待补充'}</span></Link>)}</div> : <p className="mt-5 rounded-2xl bg-sky-50 p-5 text-sm font-bold text-slate-500">歌曲资料正在整理中。</p>}</section>
  </main></>
}
