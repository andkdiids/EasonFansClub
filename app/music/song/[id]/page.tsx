import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MusicBackButton } from '@/components/music/MusicBackButton'
import { MusicCover } from '@/components/music/MusicCover'
import { MusicDetailReveal } from '@/components/music/MusicDetailReveal'
import { MusicPlayer } from '@/components/music/MusicPlayer'
import { PersonalSongHistory } from '@/components/music/live/PersonalSongHistory'
import { formatMusicReleaseDate } from '@/lib/music-display'
import { getCurrentUser } from '@/lib/auth'
import { resolveMusicPlayback } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { publicImageVariantUrl } from '@/lib/image-variants'

export const dynamic = 'force-dynamic'

export default async function MusicSongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const currentUser = await getCurrentUser()
  const [song, config] = await Promise.all([
    prisma.musicSong.findFirst({ where: { id, MusicAlbum: { status: 'PUBLISHED' } }, include: { MusicAlbum: true } }),
    getSiteAppearance(),
  ])
  if (!song) notFound()

  const coverUrl = publicImageVariantUrl(song.MusicAlbum.coverUrl, 'large')
  const playerCoverUrl = publicImageVariantUrl(song.MusicAlbum.coverUrl, 'thumb-sm')
  const releaseLabel = formatMusicReleaseDate(song.MusicAlbum.releaseDate, song.releaseYear)
  const tags = song.tags?.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) || []
  const credits = [
    ['曲序', String(song.trackNumber).padStart(2, '0')],
    ['作词', song.lyricist],
    ['作曲', song.composer],
    ['编曲', song.arranger],
    ['制作人', song.producer],
    ['发行信息', releaseLabel],
  ]
  const songStory = song.description || song.story
  const playback = resolveMusicPlayback(song, currentUser)

  return <MusicArchiveShell maxWidth="max-w-5xl" backgroundVisual={config.heroVisuals.music}>
    <MusicBackButton fallbackHref={`/music/album/${song.albumId}`} label={`返回《${song.MusicAlbum.name}》`} />

    <section className="mt-8 grid items-center gap-9 md:grid-cols-[320px_minmax(0,1fr)] md:gap-14">
      <MusicDetailReveal direction="left" hover className="mx-auto w-full max-w-[320px]">
        <MusicCover src={coverUrl} alt={`${song.MusicAlbum.name}专辑封面`} variant="large" className="aspect-square w-full rounded-[24px] border border-white/15 shadow-[0_28px_80px_rgba(35,145,230,.25)]" sizes="(max-width: 767px) 80vw, 320px" priority />
      </MusicDetailReveal>
      <MusicDetailReveal direction="right" delay={0.08}>
        <h1 className="text-5xl font-black tracking-[-0.04em] text-white sm:text-7xl">{song.title}</h1>
        <p className="mt-5 text-xl font-black text-slate-200">{song.artist}</p>
        <p className="mt-3 text-sm font-bold text-slate-300/65">《{song.MusicAlbum.name}》 · {releaseLabel}</p>
        {tags.length ? <div className="mt-5 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="rounded-full border border-sky-200/15 bg-sky-300/[0.08] px-3 py-1.5 text-xs font-black text-sky-100/75">{tag}</span>)}</div> : null}
        <div className="mt-7 flex flex-wrap gap-3"><a href="#song-preview" className="easmusic-preview-button rounded-full bg-white px-6 py-3 text-sm font-black text-[#07182d]">▶ 播放试听</a><Link href={`/music/album/${song.albumId}`} className="rounded-full border border-white/15 bg-white/[0.08] px-6 py-3 text-sm font-black text-white backdrop-blur-md transition hover:bg-white/15">返回专辑</Link></div>
      </MusicDetailReveal>
    </section>

    <MusicDetailReveal delay={0.12} className="mt-14 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl sm:p-8">
      <h2 className="text-3xl font-black text-white">创作资料</h2>
      <dl className="mt-7 grid gap-4 sm:grid-cols-2 md:grid-cols-3">{credits.map(([label, value]) => <div key={label} className="rounded-[20px] border border-white/10 bg-white/[0.045] p-5"><dt className="text-xs font-black tracking-wider text-sky-200/55">{label}</dt><dd className="mt-2 text-lg font-black text-slate-100">{value || '待补充'}</dd></div>)}</dl>
    </MusicDetailReveal>

    <div id="song-preview" className="mt-8 scroll-mt-24"><MusicPlayer id={song.id} title={song.title} artist={song.artist} albumName={song.MusicAlbum.name} coverUrl={playerCoverUrl} sourceType={song.sourceType} previewUrl={playback.previewUrl} previewDuration={playback.previewDuration} isFullPlayback={playback.isFullPlayback} /></div>
    <PersonalSongHistory songId={song.id} />

    <MusicDetailReveal delay={0.16} className="mt-8 rounded-[30px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_70px_rgba(2,12,27,.25)] backdrop-blur-xl sm:p-9">
      <h2 className="text-3xl font-black text-white">歌词</h2>
      <div className="mt-7 pr-3"><p className="whitespace-pre-wrap text-sm font-medium leading-9 text-slate-200/80 sm:text-base">{song.lyrics || '歌词内容暂未收录。'}</p></div>
    </MusicDetailReveal>

    {songStory ? <MusicDetailReveal delay={0.2} className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl sm:p-8"><h2 className="text-3xl font-black text-white">歌曲故事</h2><p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{songStory}</p></MusicDetailReveal> : null}
  </MusicArchiveShell>
}
