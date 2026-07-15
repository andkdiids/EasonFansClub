import Link from 'next/link'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { SiteHeader } from '@/components/SiteHeader'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function MusicPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  const q = (params.q || '').trim()
  const [tracks, layoutConfig] = await Promise.all([
    prisma.musicTrack.findMany({
      where: {
        isVisible: true,
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 40,
    }),
    getPublishedPageLayoutConfig('music'),
  ])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <PageLayoutRenderer
          pageKey="music"
          config={layoutConfig}
          modules={{
            'music.main': (
              <>
                <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
                  <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">EasMusic</p>
                  <h1 className="mt-3 text-4xl font-black text-brand-950">EasMusic</h1>
                  <p className="mt-4 max-w-2xl leading-8 text-slate-600">
                    只记录歌单、收藏和听歌时长，不存储盗版音乐文件。不可播放时可前往官方平台收听。
                  </p>
                  <form action="/music" className="mt-5 flex gap-3">
                    <input name="q" defaultValue={q} placeholder="搜索陈奕迅歌曲" className="min-w-0 flex-1 rounded-xl border border-sky-100 px-4 py-3 font-bold outline-none" />
                    <button className="rounded-xl bg-brand-700 px-5 py-3 font-black text-white">搜索</button>
                  </form>
                </section>

                <section className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {tracks.map((track) => (
                    <article key={track.id} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                      <p className="text-2xl font-black text-brand-950">{track.title}</p>
                      <p className="mt-2 text-sm font-bold text-slate-500">{track.artist}</p>
                      <div className="mt-4 flex gap-2">
                        {track.isPlayable ? (
                          <button className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">播放</button>
                        ) : (
                          <Link href={track.sourceUrl || '#'} target="_blank" className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
                            前往官方平台收听
                          </Link>
                        )}
                        <button className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">收藏</button>
                      </div>
                    </article>
                  ))}
                </section>
              </>
            ),
          }}
        />
      </main>
    </>
  )
}
