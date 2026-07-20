import { SiteHeader } from '@/components/SiteHeader'
import { calculateCheckinStreaks } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function RankingsPage() {
  // 签到榜:一次性取出未删除用户的全部签到日期键(仅两个小字段),内存分组重算,避免 N+1,不读用户表上的连续天数快照
  const [points, checkInKeys, posts] = await Promise.all([
    prisma.user.findMany({ where: { isDeleted: false }, orderBy: { points: 'desc' }, take: 10, select: { id: true, nickname: true, points: true, level: true } }),
    prisma.checkIn.findMany({ where: { user: { isDeleted: false } }, select: { userId: true, checkinDateKey: true } }),
    prisma.post.findMany({ where: { isDeleted: false }, orderBy: [{ replyCount: 'desc' }, { likeCount: 'desc' }], take: 10, select: { id: true, title: true, replyCount: true, likeCount: true } }),
  ])

  const keysByUser = new Map<string, string[]>()
  for (const row of checkInKeys) {
    const keys = keysByUser.get(row.userId)
    if (keys) keys.push(row.checkinDateKey)
    else keysByUser.set(row.userId, [row.checkinDateKey])
  }
  const streakTop = [...keysByUser.entries()]
    .map(([userId, keys]) => ({ userId, currentStreak: calculateCheckinStreaks(keys).currentStreak }))
    .filter((item) => item.currentStreak > 0)
    .sort((a, b) => b.currentStreak - a.currentStreak)
    .slice(0, 10)
  const streakUsers = await prisma.user.findMany({
    where: { id: { in: streakTop.map((item) => item.userId) } },
    select: { id: true, nickname: true, level: true },
  })
  const userById = new Map(streakUsers.map((item) => [item.id, item]))

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
            ['签到榜', streakTop.map((item) => { const u = userById.get(item.userId); return u ? `${u.nickname} · 连续${item.currentStreak}天` : null }).filter((row): row is string => Boolean(row))],
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
