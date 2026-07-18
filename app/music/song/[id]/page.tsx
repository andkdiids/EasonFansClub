import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicCover } from '@/components/music/MusicCover'
import { MusicMiniPlayer } from '@/components/music/MusicMiniPlayer'
import { MusicPlayer } from '@/components/music/MusicPlayer'
import { SiteHeader } from '@/components/SiteHeader'
import { musicCover } from '@/lib/music'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function MusicSongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const song = await prisma.musicSong.findUnique({ where: { id }, include: { album: true } })
  if (!song) notFound()
  const coverUrl = musicCover(song.album.coverUrl, song.coverUrl)
  const credits = [['作词', song.lyricist], ['作曲', song.composer], ['编曲', song.arranger], ['制作人', song.producer]]

  return (
    <><SiteHeader /><main className="mx-auto max-w-5xl space-y-8 px-4 py-7 sm:px-5 sm:py-10">
      <Link href={`/music/album/${song.albumId}`} className="text-sm font-black text-brand-700">← 返回《{song.album.name}》</Link>
      <section className="grid items-end gap-7 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-9">
        <MusicCover src={coverUrl} alt={`${song.title}封面`} className="aspect-square w-full rounded-[30px] shadow-xl shadow-sky-950/15 sm:w-[220px]" />
        <div className="min-w-0 pb-1"><p className="text-sm font-black tracking-[0.18em] text-brand-700">歌曲</p><h1 className="mt-3 text-4xl font-black text-brand-950 sm:text-6xl">{song.title}</h1><p className="mt-4 text-lg font-bold text-slate-500">{song.artist} · <Link href={`/music/album/${song.albumId}`} className="text-brand-700 hover:underline">{song.album.name}</Link></p></div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{credits.map(([label, value]) => <div key={label} className="rounded-2xl border border-sky-100 bg-white/85 p-4"><p className="text-xs font-black text-brand-700">{label}</p><p className="mt-2 font-black text-brand-950">{value || '待补充'}</p></div>)}</section>

      <MusicPlayer title={song.title} artist={song.artist} coverUrl={coverUrl} sourceType={song.sourceType} />

      <section className="rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm sm:p-8"><h2 className="text-3xl font-black text-brand-950">歌曲故事</h2><p className="mt-5 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{song.story || '歌曲故事正在整理中。'}</p></section>
      <section className="rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm sm:p-8"><div className="flex items-center justify-between gap-3"><h2 className="text-3xl font-black text-brand-950">歌词</h2><span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">预留区域</span></div><p className="mt-5 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{song.lyrics || '歌词内容暂未收录。'}</p></section>
      <MusicMiniPlayer title={song.title} artist={song.artist} coverUrl={coverUrl} />
    </main></>
  )
}
