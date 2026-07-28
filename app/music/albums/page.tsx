import Link from 'next/link'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicAlbumsPage() {
  const [albums, config] = await Promise.all([
    prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'desc' }], include: { _count: { select: { MusicSong: true } } } }),
    getSiteAppearance(),
  ])

  return (
    <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
      <Link href="/music" className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm font-black text-sky-100/80 backdrop-blur-xl transition hover:border-white/15 hover:bg-white/[0.11] hover:text-white">← 返回 EasMusic</Link>
      <section className="mt-8"><p className="text-xs font-black tracking-[0.24em] text-sky-300/65">ALBUM ARCHIVE</p><h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-6xl">专辑墙</h1><p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-slate-300/65">按发行年份浏览陈奕迅音乐专辑资料。</p></section>
      {albums.length > 0 ? <section className="mt-8 grid grid-cols-2 gap-x-3 gap-y-5 sm:mt-10 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-4 xl:grid-cols-5">{albums.map((album) => <MusicAlbumCard key={album.id} theme="dark" album={{ ...album, songCount: album._count.MusicSong }} />)}</section> : <p className="mt-9 rounded-[26px] border border-white/10 bg-white/[0.05] p-8 text-sm font-bold text-slate-300/65">专辑墙正在建设中。</p>}
    </MusicArchiveShell>
  )
}
