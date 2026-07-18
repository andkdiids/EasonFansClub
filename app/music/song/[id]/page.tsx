import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicCover } from '@/components/music/MusicCover'
import { MusicPlayer } from '@/components/music/MusicPlayer'
import { SiteHeader } from '@/components/SiteHeader'
import { musicCover } from '@/lib/music'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export default async function MusicSongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const song = await prisma.musicSong.findFirst({ where: { id, album: { status: 'PUBLISHED' } }, include: { album: true } })
  if (!song) notFound()
  const coverUrl = musicCover(song.album.coverUrl, song.coverUrl)
  const credits = [['作词', song.lyricist], ['作曲', song.composer], ['编曲', song.arranger], ['制作人', song.producer]]
  return <><SiteHeader /><main className="mx-auto max-w-5xl space-y-8 px-4 py-7 sm:px-5 sm:py-11"><Link href={`/music/album/${song.albumId}`} className="text-sm font-black text-brand-700">← 《{song.album.name}》</Link><section className="grid items-end gap-7 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-10"><MusicCover src={coverUrl} alt={`${song.title}封面`} className="aspect-square w-full rounded-[32px] shadow-2xl shadow-sky-950/15 sm:w-[240px]" sizes="(max-width: 640px) 100vw, 240px" /><div><p className="text-sm font-black tracking-[0.18em] text-brand-700">歌曲资料</p><h1 className="mt-3 text-5xl font-black text-brand-950 sm:text-7xl">{song.title}</h1><p className="mt-4 text-lg font-bold text-slate-500">{song.artist} · {song.album.name} · {song.releaseYear}</p></div></section>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{credits.map(([label, value]) => <div key={label} className="rounded-2xl border border-sky-100 bg-white/88 p-4"><p className="text-xs font-black text-brand-700">{label}</p><p className="mt-2 font-black text-brand-950">{value || '待补充'}</p></div>)}</section>
    <MusicPlayer title={song.title} artist={song.artist} coverUrl={coverUrl} sourceType={song.sourceType} />
    <section className="grid gap-6 lg:grid-cols-2"><div className="rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm"><h2 className="text-3xl font-black text-brand-950">歌曲介绍</h2><p className="mt-5 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{song.description || '歌曲介绍正在整理中。'}</p></div><div className="rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm"><h2 className="text-3xl font-black text-brand-950">歌曲故事</h2><p className="mt-5 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{song.story || '歌曲故事正在整理中。'}</p></div></section>
    <section className="rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm sm:p-8"><h2 className="text-3xl font-black text-brand-950">歌词</h2><p className="mt-5 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">{song.lyrics || '歌词内容暂未收录。'}</p></section>
    <section className="flex flex-wrap gap-3 rounded-[28px] border border-sky-100 bg-sky-50/70 p-5"><button disabled className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white opacity-60">▶ 播放</button><button disabled className="rounded-full bg-white px-5 py-3 text-sm font-black text-brand-700 opacity-60">♡ 收藏</button><button disabled className="rounded-full bg-white px-5 py-3 text-sm font-black text-brand-700 opacity-60">评论</button><button disabled className="rounded-full bg-white px-5 py-3 text-sm font-black text-brand-700 opacity-60">分享</button></section>
  </main></>
}
