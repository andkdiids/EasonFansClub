import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MusicCover } from '@/components/music/MusicCover'
import { MusicDetailReveal } from '@/components/music/MusicDetailReveal'
import { MusicAlbumTrackList } from '@/components/music/MusicAlbumTrackList'
import { formatMusicReleaseDate, formatTrackCount } from '@/lib/music-display'
import { getCurrentUser } from '@/lib/auth'
import { resolveMusicPlayback } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { toPublicMediaUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'

export default async function MusicAlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const currentUser = await getCurrentUser().catch((error) => {
    console.warn('[music-album.auth]', error)
    return null
  })
  const [album, config] = await Promise.all([
    prisma.musicAlbum.findFirst({ where: { id, status: 'PUBLISHED' }, include: { MusicSong: { orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }] } } }),
    getSiteAppearance(),
  ])
  if (!album) notFound()

  const coverUrl = toPublicMediaUrl(album.coverUrl)
  album.coverUrl = coverUrl

  const releaseLabel = formatMusicReleaseDate(album.releaseDate, album.releaseYear)
  const archiveDetails = [
    ['专辑名称', album.name],
    ['歌手', album.artist],
    ['发行日期', releaseLabel],
    ['发行年份', String(album.releaseYear)],
    ['语言', album.language],
    ['唱片公司', album.company || '待补充'],
    ['专辑类型', album.albumType || '待补充'],
    ['歌曲数量', formatTrackCount(album.MusicSong.length)],
    ['馆藏排序', String(album.displayOrder)],
  ]

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music" className="inline-flex items-center gap-2 text-sm font-black text-sky-300/80 transition hover:text-white">← 返回 EasMusic</Link>

    <section className="mt-8 grid items-center gap-9 md:grid-cols-[320px_minmax(0,1fr)] md:gap-14">
      <MusicDetailReveal direction="left" hover className="mx-auto w-full max-w-[320px]">
        <MusicCover src={album.coverUrl} alt={`${album.name}专辑封面`} className="aspect-square w-full rounded-[24px] border border-white/15 shadow-[0_28px_80px_rgba(35,145,230,.25)]" sizes="(max-width: 767px) 80vw, 320px" />
      </MusicDetailReveal>
      <MusicDetailReveal direction="right" delay={0.08}>
        <p className="text-xs font-black tracking-[0.24em] text-sky-300/70">ALBUM ARCHIVE · {album.language}</p>
        <h1 className="mt-4 text-5xl font-black tracking-[-0.04em] text-white sm:text-7xl">{album.name}</h1>
        <p className="mt-5 text-xl font-black text-slate-200">{album.artist}</p>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-sm font-bold text-slate-300/65">
          <span>{releaseLabel}</span><span aria-hidden="true">·</span><span>{album.company || '唱片公司待补充'}</span><span aria-hidden="true">·</span><span>{formatTrackCount(album.MusicSong.length)}</span>
        </div>
        {album.description ? <p className="mt-7 max-w-2xl whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{album.description}</p> : null}
      </MusicDetailReveal>
    </section>

    <MusicDetailReveal delay={0.12} className="mt-14 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_70px_rgba(2,12,27,.25)] backdrop-blur-xl sm:p-8">
      <div><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">ARCHIVE METADATA</p><h2 className="mt-2 text-3xl font-black text-white">专辑资料</h2></div>
      <dl className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2 md:grid-cols-3">
        {archiveDetails.map(([label, value]) => <div key={label} className="border-t border-white/10 pt-4"><dt className="text-xs font-black tracking-wider text-sky-200/55">{label}</dt><dd className="mt-2 text-base font-black text-slate-100">{value}</dd></div>)}
      </dl>
    </MusicDetailReveal>

    {album.story ? <MusicDetailReveal delay={0.16} className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl sm:p-8"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">ALBUM STORY</p><h2 className="mt-2 text-3xl font-black text-white">专辑故事</h2><p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{album.story}</p></MusicDetailReveal> : null}

    <section className="mt-14" aria-labelledby="album-track-list">
      <div><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">TRACK LIST</p><h2 id="album-track-list" className="mt-2 text-3xl font-black text-white sm:text-4xl">歌曲列表</h2></div>
      {album.MusicSong.length ? (
        <MusicAlbumTrackList songs={album.MusicSong.map((song) => ({
          id: song.id,
          title: song.title,
          artist: song.artist,
          albumName: album.name,
          coverUrl: toPublicMediaUrl(song.coverUrl || album.coverUrl),
          ...resolveMusicPlayback(song, currentUser),
          trackNumber: song.trackNumber,
          lyricist: song.lyricist,
          composer: song.composer,
          arranger: song.arranger,
        }))} />
      ) : <p className="mt-7 rounded-[24px] border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300/65">歌曲资料正在整理中。</p>}
    </section>
  </MusicArchiveShell>
}
