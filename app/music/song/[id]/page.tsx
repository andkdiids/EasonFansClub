import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MusicCover } from '@/components/music/MusicCover'
import { MusicDetailReveal } from '@/components/music/MusicDetailReveal'
import { MusicPlayer } from '@/components/music/MusicPlayer'
import { formatMusicReleaseDate } from '@/lib/music-display'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicSongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [song, config] = await Promise.all([
    prisma.musicSong.findFirst({ where: { id, album: { status: 'PUBLISHED' } }, include: { album: true } }),
    getSiteAppearance(),
  ])
  if (!song) notFound()

  const coverUrl = song.album.coverUrl
  const releaseLabel = formatMusicReleaseDate(song.album.releaseDate, song.releaseYear)
  const tags = song.tags?.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) || []
  const credits = [['作词', song.lyricist], ['作曲', song.composer], ['编曲', song.arranger]]
  const songStory = song.description || song.story

  return <MusicArchiveShell maxWidth="max-w-5xl" backgroundVisual={config.heroVisuals.music}>
    <Link href={`/music/album/${song.albumId}`} className="inline-flex items-center gap-2 text-sm font-black text-sky-300/80 transition hover:text-white">← 返回《{song.album.name}》</Link>

    <section className="mt-8 grid items-center gap-9 md:grid-cols-[320px_minmax(0,1fr)] md:gap-14">
      <MusicDetailReveal direction="left" hover className="mx-auto w-full max-w-[320px]">
        <MusicCover src={coverUrl} alt={`${song.album.name}专辑封面`} className="aspect-square w-full rounded-[24px] border border-white/15 shadow-[0_28px_80px_rgba(35,145,230,.25)]" sizes="(max-width: 767px) 80vw, 320px" />
      </MusicDetailReveal>
      <MusicDetailReveal direction="right" delay={0.08}>
        <p className="text-xs font-black tracking-[0.24em] text-sky-300/70">SONG ARCHIVE</p>
        <h1 className="mt-4 text-5xl font-black tracking-[-0.04em] text-white sm:text-7xl">{song.title}</h1>
        <p className="mt-5 text-xl font-black text-slate-200">{song.artist}</p>
        <p className="mt-3 text-sm font-bold text-slate-300/65">《{song.album.name}》 · {releaseLabel}</p>
        {tags.length ? <div className="mt-5 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="rounded-full border border-sky-200/15 bg-sky-300/[0.08] px-3 py-1.5 text-xs font-black text-sky-100/75">{tag}</span>)}</div> : null}
        <div className="mt-7 flex flex-wrap gap-3"><button type="button" disabled className="rounded-full bg-white px-6 py-3 text-sm font-black text-[#07182d] opacity-75 disabled:cursor-not-allowed">▶ 播放歌曲</button><Link href={`/music/album/${song.albumId}`} className="rounded-full border border-white/15 bg-white/[0.08] px-6 py-3 text-sm font-black text-white backdrop-blur-md transition hover:bg-white/15">返回专辑</Link></div>
      </MusicDetailReveal>
    </section>

    <MusicDetailReveal delay={0.12} className="mt-14 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl sm:p-8">
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CREATIVE CREDITS</p><h2 className="mt-2 text-3xl font-black text-white">创作资料</h2>
      <dl className="mt-7 grid gap-4 sm:grid-cols-3">{credits.map(([label, value]) => <div key={label} className="rounded-[20px] border border-white/10 bg-white/[0.045] p-5"><dt className="text-xs font-black tracking-wider text-sky-200/55">{label}</dt><dd className="mt-2 text-lg font-black text-slate-100">{value || '待补充'}</dd></div>)}</dl>
    </MusicDetailReveal>

    <div className="mt-8"><MusicPlayer title={song.title} artist={song.artist} coverUrl={coverUrl} sourceType={song.sourceType} /></div>

    <MusicDetailReveal delay={0.16} className="mt-8 rounded-[30px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_70px_rgba(2,12,27,.25)] backdrop-blur-xl sm:p-9">
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">LYRICS ARCHIVE</p><h2 className="mt-2 text-3xl font-black text-white">歌词</h2>
      <div className="mt-7 max-h-[680px] overflow-y-auto pr-3 [scrollbar-color:rgba(125,211,252,.35)_transparent]"><p className="whitespace-pre-wrap text-sm font-medium leading-9 text-slate-200/80 sm:text-base">{song.lyrics || '歌词内容暂未收录。'}</p></div>
    </MusicDetailReveal>

    {songStory ? <MusicDetailReveal delay={0.2} className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl sm:p-8"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">SONG STORY</p><h2 className="mt-2 text-3xl font-black text-white">歌曲故事</h2><p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{songStory}</p></MusicDetailReveal> : null}
  </MusicArchiveShell>
}
