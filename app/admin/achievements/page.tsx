import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { categoryText, rarityText } from '@/lib/achievements'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminAchievementsPage() {
  const user = await requireAdminPage('/admin/achievements', 'achievement_manage')

  const [achievements, userAchievements] = await Promise.all([
    prisma.achievement.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
include: {
  _count: {
    select: {
      UserAchievement: true,
    },
  },
}    }),
    prisma.userAchievement.count({ where: { unlocked: true } }),
  ])

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-5">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Achievement Admin</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">成就 / 勋章管理</h1>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-600">
            当前已维护 {achievements.length} 个成就，已点亮 {userAchievements} 次。新增、隐藏、排序、条件和图片字段均存储在数据库。
          </p>
        </section>

        <section className="overflow-hidden rounded-[24px] border border-sky-100 bg-white/85 shadow-sm">
          <div className="grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_0.7fr] gap-3 border-b border-sky-100 px-5 py-3 text-xs font-black text-slate-500 max-lg:hidden">
            <span>成就</span>
            <span>分类</span>
            <span>稀有度</span>
            <span>条件</span>
            <span>状态</span>
          </div>
          <div className="divide-y divide-sky-100">
            {achievements.map((item) => (
              <article key={item.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_0.7fr]">
                <div>
                  <p className="font-black text-brand-950">
                    <span className="mr-2">{item.icon || '🏆'}</span>
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{item.description || '暂无说明'}</p>
                </div>
                <p className="text-sm font-bold text-slate-600">{categoryText[item.category] || item.category}</p>
                <p className="text-sm font-bold text-slate-600">{rarityText[item.rarity] || item.rarity}</p>
                <p className="text-sm font-bold text-slate-600">
                  {item.conditionKey ? `${item.conditionKey} ≥ ${item.conditionValue || 1}` : '手动发放'}
                </p>
                <p className="text-sm font-bold text-slate-600">{item.isVisible ? '显示' : '隐藏'} · {item.isAutoGrant ? '自动' : '手动'}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  )
}
