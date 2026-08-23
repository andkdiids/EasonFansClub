import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getBadgeYearReview } from '@/lib/badge-phase5'

export const dynamic = 'force-dynamic'
export const metadata = { title: '年度荣誉 | 私家E院' }

export default async function BadgeYearReviewPage({ searchParams }: { searchParams?: Promise<{ year?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/badges/year-in-review')
  const params = await searchParams
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()))
  const year = Number(params?.year || currentYear)
  const review = await getBadgeYearReview(user.id, year)
  if (!review) redirect('/badges/year-in-review')
  const maxMonth = Math.max(1, ...review.months.map((item) => item.count))
  const isCurrent = year === currentYear
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
    <header className="rounded-[30px] border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-6 sm:p-8"><p className="text-xs font-black tracking-[0.2em] text-amber-700">EASON FANS CLUB · YEAR REVIEW</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black text-brand-950">我的 {year} E院荣誉</h1><p className="mt-2 text-sm font-bold text-slate-500">{isCurrent ? `${year} 荣誉记录仍在继续。` : `回看 ${year} 年留下的每一枚真实荣誉。`}</p></div><div className="flex gap-2"><Link href="/badges/tasks" className="rounded-full bg-white px-4 py-2 text-xs font-black text-brand-700">勋章任务</Link><Link href="/badges" className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">展览馆</Link></div></div></header>
    {review.availableYears.length ? <nav className="flex gap-2 overflow-x-auto" aria-label="选择年度">{review.availableYears.map((item) => <Link key={item} href={`/badges/year-in-review?year=${item}`} className={`rounded-full px-4 py-2 text-xs font-black ${item === year ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{item}</Link>)}</nav> : null}
    {review.total ? <><section className="grid grid-cols-2 gap-3 sm:grid-cols-5"><div className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-bold text-slate-500">今年获得</span><strong className="mt-1 block text-2xl font-black text-brand-950">{review.total} 枚</strong></div><div className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-bold text-slate-500">限定收藏</span><strong className="mt-1 block text-2xl font-black text-brand-950">{review.limitedCount} 枚</strong></div><div className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-bold text-slate-500">当前完成系列</span><strong className="mt-1 block text-2xl font-black text-brand-950">{review.currentCompletedSeries} 个</strong></div><div className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-bold text-slate-500">最活跃月份</span><strong className="mt-1 block text-2xl font-black text-brand-950">{review.mostActiveMonth?.month || '-'} 月</strong></div><div className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-bold text-slate-500">当月获得</span><strong className="mt-1 block text-2xl font-black text-brand-950">{review.mostActiveMonth?.count || 0} 枚</strong></div></section>
    <section className="grid gap-4 md:grid-cols-2"><article className="rounded-[26px] border border-sky-100 bg-white p-5"><h2 className="text-lg font-black text-brand-950">最稀有收藏</h2>{review.rarest ? <div className="mt-4 flex items-center gap-4">{review.rarest.imageUrl ? <img src={review.rarest.imageUrl} alt="" className="h-20 w-20 object-contain" /> : null}<div><strong className="text-xl font-black text-brand-950">{review.rarest.name}</strong><p className="mt-1 text-sm font-bold text-slate-500">全站获得率 {review.rarest.ownershipRate}</p></div></div> : null}</article><article className="rounded-[26px] border border-sky-100 bg-white p-5"><h2 className="text-lg font-black text-brand-950">年度首尾</h2><p className="mt-4 text-sm font-bold text-slate-600">第一枚：{review.first?.name || '-'}</p><p className="mt-2 text-sm font-bold text-slate-600">最近一枚：{review.latest?.name || '-'}</p></article></section>
    <section className="rounded-[26px] border border-sky-100 bg-white p-5"><h2 className="text-lg font-black text-brand-950">每月获得趋势</h2><div className="mt-5 grid h-48 grid-cols-12 items-end gap-1">{review.months.map((item) => <div key={item.month} className="flex h-full flex-col justify-end text-center"><span className="mb-1 text-[10px] font-black text-brand-700">{item.count || ''}</span><span className="mx-auto w-full max-w-8 rounded-t bg-sky-300" style={{ height: `${Math.max(item.count ? 8 : 2, item.count / maxMonth * 100)}%` }} /><span className="mt-2 text-[9px] font-bold text-slate-500">{item.month}</span></div>)}</div></section></> : <section className="rounded-[28px] border border-dashed border-sky-200 p-12 text-center"><h2 className="text-xl font-black text-brand-950">这一年还没有留下勋章记录</h2><p className="mt-2 text-sm font-bold text-slate-500">去任务中心看看下一枚值得追踪的荣誉。</p></section>}
  </main>
}
