import Link from 'next/link'
  type AchievementRecord = {
  id: string
  unlocked: boolean
  unlockedAt?: Date | null
  progress: number
  achievement: {
    title: string
    description?: string | null
    category: string
    rarity: string
    icon?: string | null
  }
}
export default function ProfileAchievementPreview({
  records,
  isSelf = true,
}: {
records: AchievementRecord[]
isSelf?: boolean
}) {

  const unlocked = records
    .filter((item) => item.unlocked)
    .slice(0, 6)

  return (
    <section className="border border-sky-100 bg-white/88 p-5">

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-black text-brand-950">
          {isSelf ? '我的成就' : 'TA的成就'}
        </h2>

        <Link
          href="/achievements"
          className="text-sm font-bold text-sky-700 hover:underline"
        >
          查看全部成就 →
        </Link>
      </div>


      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">

        {unlocked.map((item)=>(
          <div
            key={item.id}
            className="border border-slate-200 p-3"
          >

            <div className="text-3xl">
              {item.achievement.icon || '🏆'}
            </div>

            <div className="mt-2 text-sm font-black">
              {item.achievement.title}
            </div>

            <div className="text-xs text-slate-400">
              已解锁
            </div>

          </div>
        ))}

      </div>


      {!unlocked.length && (
        <p className="text-sm text-slate-500">
          {isSelf ? '我的成就暂时为空' : 'TA的成就暂时为空'}
        </p>
      )}

    </section>
  )
}
