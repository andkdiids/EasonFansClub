import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function RankingsPage() {
  const [points, streaks, posts] = await Promise.all([
    prisma.user.findMany({ where: { isDeleted: false }, orderBy: { points: 'desc' }, take: 10, select: { id: true, nickname: true, points: true, level: true } }),
    prisma.user.findMany({ where: { isDeleted: false }, orderBy: { consecutiveDays: 'desc' }, take: 10, select: { id: true, nickname: true, consecutiveDays: true, level: true } }),
    prisma.post.findMany({ where: { isDeleted: false }, orderBy: [{ replyCount: 'desc' }, { likeCount: 'desc' }], take: 10, select: { id: true, title: true, replyCount: true, likeCount: true } }),
  ])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Rankings</p>
          <h1 className="mt-3 text-4xl font-black text-brand-950">排行榜</h1>
        </section>
        <section className="grid gap-6 lg:grid-cols-3">
          {[
            ['积分榜', points.map((u) => `${u.nickname} · Lv.${u.level} · ${u.points}分`)],
            ['签到榜', streaks.map((u) => `${u.nickname} · 连续${u.consecutiveDays}天`)],
            ['热帖榜', posts.map((p) => `${p.title} · ${p.replyCount}回复 · ${p.likeCount}赞`)],
          ].map(([title, rows]) => (
            <div key={title as string} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
              <h2 className="text-2xl font-black text-brand-950">{title}</h2>
              <div className="mt-4 space-y-3">
                {(rows as string[]).map((row, index) => (
                  <p key={row} className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-slate-700">#{index + 1} {row}</p>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
    </>
  )
}
