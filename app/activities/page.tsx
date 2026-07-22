import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { HeroBackground } from '@/components/HeroBackground'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function ActivitiesPage() {
  const [activities, config] = await Promise.all([
    prisma.activity.findMany({ where: { status: { in: ['PUBLISHED', 'DRAFT'] } }, orderBy: { createdAt: 'desc' }, take: 12 }),
    getSiteAppearance(),
  ])
  const banner = config.heroVisuals.activities
  const hasBanner = banner.enabled && Boolean(banner.imageUrl || config.images.activityCoverUrl)

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-6 px-5 py-8">
        <section className={`relative isolate min-h-64 overflow-hidden border shadow-sm ${hasBanner ? 'border-slate-800 bg-[#071523] text-white' : 'border-sky-100 bg-white/85 text-brand-950'}`}>
          <HeroBackground visual={banner} fallbackImageUrl={config.images.activityCoverUrl} priority />
          {hasBanner ? <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-black/10" /> : null}
          <div className="relative z-10 p-7 sm:p-10"><p className={`text-sm font-black uppercase tracking-[0.22em] ${hasBanner ? 'text-sky-200' : 'text-brand-700'}`}>Activities</p><h1 className="mt-3 text-4xl font-black">活动中心</h1><p className={`mt-4 max-w-2xl leading-8 ${hasBanner ? 'text-white/80' : 'text-slate-600'}`}>演唱会报名、聚会、线上活动和抽奖都会在这里发布。</p><Link href="/birthday" className={`mt-6 inline-flex border px-4 py-2 text-sm font-black ${hasBanner ? 'border-white/30 bg-black/20 text-white' : 'border-sky-200 text-brand-700'}`}>生日应援专题 →</Link></div>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          {activities.length ? activities.map((item) => (
            <article key={item.id} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
              <p className="text-2xl font-black text-brand-950">{item.title}</p>
              <p className="mt-3 line-clamp-3 leading-7 text-slate-600">{item.description}</p>
            </article>
          )) : (
            <div className="rounded-2xl border border-sky-100 bg-white/80 p-8 text-center font-bold text-slate-500 md:col-span-2">
              暂无活动，后台创建后会显示在这里。
            </div>
          )}
        </section>
      </main>
    </>
  )
}
