import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { categoryText, rarityText } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AchievementsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fachievements')

  const records = await safeDb(
    'achievements.read',
    prisma.userAchievement.findMany({
      where: { userId: user.id, achievement: { isVisible: true } },
      include: { achievement: true },
      orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    [],
  )
  const grouped = records.reduce<Record<string, typeof records>>((acc, item) => {
    const key = item.achievement.category
    acc[key] ||= []
    acc[key].push(item)
    return acc
  }, {})

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-5">
        <section className="rounded-[34px] border border-sky-100 bg-white/82 p-8 shadow-xl shadow-sky-900/5 sm:p-10">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Achievement System</p>
          <h1 className="mt-3 text-4xl font-black text-brand-950 sm:text-6xl">E院成就系统</h1>
          <p className="mt-5 max-w-2xl text-base font-bold leading-8 text-slate-600 sm:text-lg">
            每一次挂号、发帖、听歌和相遇，都会在这里留下可以被点亮的记录。
          </p>
        </section>

        {Object.entries(grouped).map(([category, items]) => (
          <section key={category} className="space-y-4">
            <h2 className="text-3xl font-black text-brand-950">{categoryText[category] || category}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const target = item.achievement.conditionValue || 1
                const percent = Math.min(100, Math.round((item.progress / target) * 100))
                return (
                  <article key={item.id} className="rounded-[28px] border border-sky-100 bg-white/82 p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-4xl">{item.achievement.icon || '🏆'}</div>
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">
                        {rarityText[item.achievement.rarity] || item.achievement.rarity}
                      </span>
                    </div>
                    <h3 className="mt-4 text-xl font-black text-brand-950">{item.achievement.title}</h3>
                    <p className="mt-2 min-h-12 text-sm font-bold leading-6 text-slate-500">
                      {item.achievement.description || '后台可继续补充这个成就的说明。'}
                    </p>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-sky-100">
                      <div className="h-full rounded-full bg-brand-700" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-black text-slate-500">
                      {item.unlocked
                        ? `已获得 · ${item.unlockedAt?.toLocaleDateString('zh-CN')}`
                        : `${item.progress} / ${target}`}
                    </p>
                  </article>
                )
              })}
            </div>
          </section>
        ))}

        {!records.length ? (
          <section className="rounded-[28px] border border-dashed border-sky-200 bg-white/70 p-8 text-center text-sm font-bold text-slate-500">
            后台还没有创建成就，管理员可在后台成就管理中维护。
          </section>
        ) : null}
      </main>
    </>
  )
}
