import { categoryText, rarityText } from '@/lib/achievements'

type AchievementRecord = {
  id: string
  unlocked: boolean
  progress: number
  unlockedAt?: Date | null
  achievement: {
    title: string
    description?: string | null
    category: string
    rarity: string
    icon?: string | null
    conditionValue?: number | null
  }
}

export default function AchievementList({
  records,
}: {
  records: AchievementRecord[]
}) {

  const grouped = records.reduce<Record<string, typeof records>>((acc, item) => {
    const key = item.achievement.category
    acc[key] ||= []
    acc[key].push(item)
    return acc
  }, {})

  const unlockedCount = records.filter((item) => item.unlocked).length

  return (
    <main className="site-page-main flat-page mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-5 sm:py-10">
      <section className="relative overflow-hidden border-y border-slate-200 bg-white px-6 py-10 shadow-[0_10px_32px_rgba(15,23,42,.05)] sm:px-10 sm:py-12">
        <div className="absolute inset-y-0 left-0 w-1 bg-brand-700" aria-hidden="true" />
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-sky-700">Achievement System</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight text-brand-950 sm:text-6xl">E院成就系统</h1>
            <p className="mt-5 max-w-2xl text-base font-bold leading-8 text-slate-600 sm:text-lg">
              记录每一次签到、每一次分享、<br className="hidden sm:block" />每一次与 Eason 相关的收藏。
            </p>
          </div>
          <div className="flex divide-x divide-slate-200 border-y border-slate-200 py-4 text-center">
            <div className="min-w-24 px-5"><strong className="block text-2xl font-black text-brand-950">{unlockedCount}</strong><span className="mt-1 block text-[10px] font-bold tracking-wider text-slate-500">已收藏徽章</span></div>
            <div className="min-w-24 px-5"><strong className="block text-2xl font-black text-brand-950">{records.length}</strong><span className="mt-1 block text-[10px] font-bold tracking-wider text-slate-500">成长档案</span></div>
          </div>
        </div>
      </section>

      {Object.entries(grouped).map(([category, items]) => (
        <section key={category} className="space-y-5">
          <header className="flex items-center gap-4 border-b border-slate-200 pb-3">
            <h2 className="text-xl font-black text-brand-950 sm:text-2xl">{categoryText[category] || category}</h2>
            <span className="text-xs font-bold text-slate-400">{items.filter((item) => item.unlocked).length} / {items.length}</span>
          </header>
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((item) => {
              const target = item.achievement.conditionValue || 1
              const percent = Math.min(100, Math.round((item.progress / target) * 100))
              return (
                <article key={item.id} data-achievement-state={item.unlocked ? 'unlocked' : 'locked'} className={`relative grid min-h-52 grid-cols-[72px_minmax(0,1fr)] gap-5 border bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)] sm:p-6 ${item.unlocked ? 'border-sky-200' : 'border-slate-200 brightness-[.94] grayscale-[.55]'}`}>
                  <div className={`grid h-16 w-16 place-items-center border text-4xl ${item.unlocked ? 'border-sky-200 bg-[radial-gradient(circle,#eff8ff_0%,#fff_72%)] shadow-[0_0_24px_rgba(56,189,248,.18)]' : 'border-slate-200 bg-slate-50 opacity-55'}`} aria-hidden="true">
                    {item.achievement.icon || '🏆'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-xl font-black text-brand-950">{item.achievement.title}</h3>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{categoryText[item.achievement.category] || item.achievement.category} · {rarityText[item.achievement.rarity] || item.achievement.rarity}</p>
                      </div>
                      <span className={`border px-2 py-1 text-[10px] font-black ${item.unlocked ? 'border-sky-200 text-sky-700' : 'border-slate-200 text-slate-400'}`}>{item.unlocked ? '已解锁' : '锁定'}</span>
                    </div>
                    <p className="mt-4 min-h-12 text-sm font-semibold leading-6 text-slate-500">{item.achievement.description || '后台可继续补充这个成就的说明。'}</p>
                    <div className="mt-4 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.unlocked ? 'bg-brand-700' : 'bg-slate-400'}`} style={{ width: `${percent}%` }} /></div>
                      <span className="w-10 text-right text-[10px] font-black text-slate-500">{percent}%</span>
                    </div>
                    <p className="mt-2 text-[11px] font-bold text-slate-500">{item.unlocked ? `获得于 ${item.unlockedAt?.toLocaleDateString('zh-CN')}` : `${item.progress} / ${target}`}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}

      {!records.length ? <section className="border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500">成长档案仍是空白。管理员可在后台成就管理中维护，新的社区足迹也会在这里被记录。</section> : null}
    </main>
  )
  }
