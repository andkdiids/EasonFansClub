import Link from 'next/link'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function MusicAlbumsPage() {
  const albums = await prisma.musicAlbum.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'desc' }],
    include: { _count: { select: { songs: true } } },
  })

  return (
    <><SiteHeader /><main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-10">
      <Link href="/music" className="text-sm font-black text-brand-700">← 返回 EasMusic</Link>
      <section className="mt-6"><p className="text-sm font-black tracking-[0.18em] text-brand-700">ALBUM ARCHIVE</p><h1 className="mt-2 text-4xl font-black text-brand-950 sm:text-6xl">专辑墙</h1><p className="mt-4 text-sm font-bold leading-7 text-slate-600">按发行年份浏览陈奕迅音乐专辑资料。</p></section>
      {albums.length > 0 ? <section className="mt-9 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{albums.map((album) => <MusicAlbumCard key={album.id} album={{ ...album, songCount: album._count.songs }} />)}</section> : <p className="mt-9 rounded-[26px] border border-dashed border-sky-200 bg-white/75 p-8 text-sm font-bold text-slate-500">专辑墙正在建设中。</p>}
    </main></>
  )
}
