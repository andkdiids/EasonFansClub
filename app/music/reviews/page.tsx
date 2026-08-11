import Image from 'next/image'
import Link from 'next/link'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function AlbumReviewsPage() {
  const [reviews, config] = await Promise.all([
    prisma.albumReview.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      include: { MusicAlbum: { select: { id: true, name: true, releaseYear: true, coverUrl: true } } },
    }),
    getSiteAppearance(),
  ])
  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music" className="text-sm font-black text-sky-300/80">← 返回 EasMusic</Link>
    <header className="py-12 sm:py-16">
      <p className="text-xs font-black tracking-[0.24em] text-sky-300/65">ALBUM REVIEW ARCHIVE</p>
      <h1 className="mt-3 text-5xl font-black tracking-tight text-white sm:text-7xl">专辑鉴赏</h1>
      <p className="mt-5 max-w-2xl text-sm font-bold leading-7 text-slate-300/70">从制作资料、幕后故事、歌曲解析与时代背景，重新走进一张专辑。</p>
    </header>
    {reviews.length ? <section className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
      {reviews.map((review) => <Link key={review.id} href={`/music/reviews/${review.id}`} className="group overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.055] transition hover:-translate-y-1 hover:border-sky-300/30 hover:bg-white/[0.09]">
        <div className="relative aspect-[16/10] bg-[#0b2038]">
          {review.coverUrl || review.MusicAlbum.coverUrl ? <Image src={(review.coverUrl || review.MusicAlbum.coverUrl)!} alt={review.title} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover transition duration-500 group-hover:scale-105" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">REVIEW</div>}
        </div>
        <div className="p-5">
          <p className="text-xs font-black text-sky-300/60">{review.MusicAlbum.releaseYear} · {review.MusicAlbum.name}</p>
          <h2 className="mt-2 line-clamp-2 text-xl font-black text-white">{review.title}</h2>
          <p className="mt-4 text-xs font-bold text-slate-300/55">{new Intl.DateTimeFormat('zh-CN').format(review.publishedAt || review.createdAt)} · {review.likeCount} 赞 · {review.favoriteCount} 收藏</p>
        </div>
      </Link>)}
    </section> : <p className="rounded-[26px] border border-white/10 bg-white/[0.05] p-8 text-sm font-bold text-slate-300/65">专辑鉴赏档案正在整理中。</p>}
  </MusicArchiveShell>
}
