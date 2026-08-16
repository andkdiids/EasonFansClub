import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SavePrescriptionButton } from '@/components/games/SavePrescriptionButton'
import { PrescriptionUserBadge } from '@/components/games/PrescriptionUserBadge'
import { PrescriptionHistoryPagination } from '@/components/games/PrescriptionHistoryPagination'
import { getEntertainmentDailyDrawHistory } from '@/lib/entertainment'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function parsePage(value?: string) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export default async function PrescriptionHistoryPage({ searchParams }: Readonly<{ searchParams: Promise<{ page?: string }> }>) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fprescription%2Fhistory')

  const result = await getEntertainmentDailyDrawHistory(user.id, parsePage((await searchParams).page))

  return (
    <main className="entertainment-page prescription-history-page mx-auto pb-10">
      <header className="entertainment-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1>我的处方记录</h1>
            <span>只读取你自己曾经开具的每日处方，不会重新发放挂号费。</span>
          </div>
          <Link href="/games/daily-prescription" className="inline-flex min-h-10 items-center rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-black text-brand-700 shadow-sm">
            返回今日处方
          </Link>
        </div>
      </header>

      {result.records.length ? (
        <div className="mt-4 space-y-3">
          {result.records.map((record) => (
            <article key={record.id} id={`prescription-${record.id}`} className="prescription-card">
              <header>
                <p>私家E院 · 历史处方</p>
                <PrescriptionUserBadge user={record.user} />
              </header>
              <div className="prescription-points">
                <span>获得奖励</span>
                <strong>{record.rewarded ? `+${record.points} 挂号费` : '未获得奖励'}</strong>
                <small>{record.rewardFromLedger ? '奖励来自当日挂号费流水' : '奖励来自处方记录快照'}</small>
              </div>
              <div className="prescription-lyric">
                <span>当日歌词处方</span>
                {record.lyric ? (
                  <>
                    <blockquote>「{record.lyric.text}」</blockquote>
                    <cite>——《{record.lyric.songTitle}》</cite>
                  </>
                ) : (
                  <p>当天没有歌词处方内容。</p>
                )}
              </div>
              <footer>
                <span>处方编号：{record.prescriptionCode} · 开具时间：{record.issuedAtBeijing}</span>
                <SavePrescriptionButton data={record} />
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <section className="mt-5 rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
          <p className="text-lg font-black text-brand-950">还没有历史处方</p>
          <p className="mt-2 text-sm font-bold text-slate-500">完成今天的每日处方后，这里会立即出现记录。</p>
          <Link href="/games/daily-prescription" className="mt-4 inline-flex rounded-xl bg-brand-950 px-4 py-2 text-sm font-black text-white">去领取今日处方</Link>
        </section>
      )}

      {result.pagination.totalPages > 1 ? (
        <PrescriptionHistoryPagination currentPage={result.pagination.page} totalPages={result.pagination.totalPages} />
      ) : null}
    </main>
  )
}
