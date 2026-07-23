import Link from 'next/link'

export default function ProfileAchievementPreview({
  records,
}: {
  records: any[]
}) {

  const unlocked = records
    .filter((item) => item.unlocked)
    .slice(0, 6)

  return (
    <section className="border border-sky-100 bg-white/88 p-5">

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-black text-brand-950">
          我的成就
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
          暂无获得的成就
        </p>
      )}

    </section>
  )
}