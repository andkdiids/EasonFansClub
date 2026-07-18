import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicCover } from '@/components/music/MusicCover'
import { SiteHeader } from '@/components/SiteHeader'
import { formatDuration, formatTrackNumber } from '@/lib/music'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function MusicAlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const album = await prisma.musicAlbum.findUnique({ where: { id }, include: { songs: { orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }] } } })
  if (!album) notFound()

  return (
    <><SiteHeader /><main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-10">
      <Link href="/music/albums" className="text-sm font-black text-brand-700">← 返回专辑墙</Link>
      <section className="mt-6 grid items-end gap-7 sm:grid-cols-[minmax(240px,360px)_minmax(0,1fr)] sm:gap-10">
        <MusicCover src={album.coverUrl} alt={`${album.name}专辑封面`} className="aspect-square w-full rounded-[34px] shadow-2xl shadow-sky-950/15" />
        <div className="min-w-0 pb-2"><p className="text-sm font-black tracking-[0.18em] text-brand-700">专辑 · {album.language}</p><h1 className="mt-3 text-4xl font-black tracking-tight text-brand-950 sm:text-6xl">{album.name}</h1><p className="mt-4 text-lg font-bold text-slate-500">{album.artist} · {album.releaseYear}</p><p className="mt-6 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{album.description || '专辑介绍正在整理中。'}</p></div>
      </section>
      <section className="mt-12"><h2 className="text-3xl font-black text-brand-950">歌曲列表</h2>
        {album.songs.length > 0 ? <div className="mt-5 overflow-hidden rounded-[26px] border border-sky-100 bg-white/88 shadow-sm">{album.songs.map((song) => <Link key={song.id} href={`/music/song/${song.id}`} className="group flex items-center gap-4 border-b border-sky-100 px-4 py-4 last:border-0 hover:bg-sky-50/70 sm:px-6"><span className="w-8 shrink-0 text-sm font-black text-brand-500">{formatTrackNumber(song.trackNumber)}</span><span className="min-w-0 flex-1 truncate font-black text-brand-950">{song.title}</span>{formatDuration(song.duration) ? <span className="text-xs font-bold text-slate-400">{formatDuration(song.duration)}</span> : null}<span className="text-brand-500 transition group-hover:translate-x-1">→</span></Link>)}</div> : <p className="mt-5 rounded-2xl bg-sky-50 p-5 text-sm font-bold text-slate-500">这张专辑的歌曲资料正在整理中。</p>}
      </section>
    </main></>
  )
}
