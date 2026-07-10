import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ActivitiesPage() {
  const activities = await prisma.activity.findMany({
    where: { status: { in: ['PUBLISHED', 'DRAFT'] } },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Activities</p>
          <h1 className="mt-3 text-4xl font-black text-brand-950">活动中心</h1>
          <p className="mt-4 max-w-2xl leading-8 text-slate-600">演唱会报名、聚会、线上活动和抽奖都会在这里发布。</p>
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
