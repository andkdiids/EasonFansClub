import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const typeText = {
  SONG: '歌曲百科',
  ALBUM: '专辑馆',
  FILM: '电影馆',
  LIVE: 'Live 档案馆',
} as const

export default async function CulturePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fculture')

  const [quote, items, templates] = await Promise.all([
    prisma.dailyQuote.findFirst({
      where: { isVisible: true },
      orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.cultureItem.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { releaseDate: 'desc' }],
      take: 32,
    }),
    prisma.lyricCardTemplate.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 6,
    }),
  ])

  const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
    acc[item.type] ||= []
    acc[item.type].push(item)
    return acc
  }, {})

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-12 px-4 py-8 sm:px-5">
        <section className="overflow-hidden rounded-[36px] border border-sky-100 bg-white/82 shadow-xl shadow-sky-900/5">
          <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Eason Culture Museum</p>
              <h1 className="mt-3 text-4xl font-black text-brand-950 sm:text-6xl">Eason 文化馆</h1>
              <p className="mt-5 max-w-2xl text-base font-bold leading-8 text-slate-600 sm:text-lg">
                把歌曲、专辑、电影与 Live 档案收进同一个安静、清透的空间。
              </p>
            </div>
            <div className="rounded-[30px] bg-sky-50/90 p-6">
              <p className="text-sm font-black text-brand-700">今日一句</p>
              <p className="mt-4 text-2xl font-black leading-10 text-brand-950">
                {quote?.content || '后台还没有维护今日一句。'}
              </p>
              {quote?.songTitle ? <p className="mt-3 text-sm font-bold text-slate-500">来自《{quote.songTitle}》</p> : null}
            </div>
          </div>
        </section>

        {Object.entries(typeText).map(([type, label]) => (
          <section key={type} className="space-y-4">
            <h2 className="text-3xl font-black text-brand-950">{label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(grouped[type] || []).map((item) => (
                <Link
                  key={item.id}
                  href={`/culture/${item.slug}`}
                  className="overflow-hidden rounded-[30px] border border-sky-100 bg-white/82 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="aspect-[16/10] bg-gradient-to-br from-sky-100 via-white to-cyan-50">
                    {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="p-5">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">{label}</p>
                    <h3 className="mt-2 text-xl font-black text-brand-950">{item.title}</h3>
                    <p className="mt-2 line-clamp-2 text-sm font-bold leading-6 text-slate-500">
                      {item.summary || item.subtitle || '后台可继续补充介绍。'}
                    </p>
                  </div>
                </Link>
              ))}
              {!grouped[type]?.length ? (
                <p className="rounded-2xl bg-white/70 p-5 text-sm font-bold text-slate-500">暂无内容，可在后台维护。</p>
              ) : null}
            </div>
          </section>
        ))}

        <section className="rounded-[32px] border border-sky-100 bg-white/82 p-6 shadow-sm sm:p-8">
          <h2 className="text-3xl font-black text-brand-950">歌词卡片生成器</h2>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-500">
            仅使用后台维护的授权或简短内容生成 Apple 风格歌词海报。
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <div key={template.id} className="rounded-2xl bg-sky-50/80 p-5">
                <p className="font-black text-brand-950">{template.name}</p>
                <p className="mt-2 text-xs font-bold text-slate-500">
                  文字色 {template.textColor} · 点缀色 {template.accentColor}
                </p>
              </div>
            ))}
            {!templates.length ? (
              <p className="rounded-2xl bg-sky-50/80 p-5 text-sm font-bold text-slate-500">暂无海报模板。</p>
            ) : null}
          </div>
        </section>
      </main>
    </>
  )
}
