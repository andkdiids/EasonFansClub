import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { TodayAdminManager, type AdminTodayEvent } from './TodayAdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminTodayPage() {
  const user = await requireAdminPage('/admin/today', 'today_manage')
  const events = await prisma.todayEvent.findMany({
    orderBy: [{ status: 'asc' }, { date: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      date: true,
      type: true,
      title: true,
      content: true,
      imageUrl: true,
      source: true,
      reference: true,
      status: true,
      rejectionReason: true,
      SubmittedBy: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
    },
  })
  const initial: AdminTodayEvent[] = events.map(({ SubmittedBy, ...event }) => ({
    ...event,
    date: event.date.toISOString(),
    imageUrl: publicImageUrl(event.imageUrl),
    submittedBy: SubmittedBy ? { uid: SubmittedBy.uid, name: SubmittedBy.Profile?.displayName || SubmittedBy.nickname } : null,
  }))

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
        <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Today CMS</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">今日内容管理</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">维护历史上的今天，并审核用户提交的生日、出道、比赛、专辑、演唱会和获奖记录。</p>
        </section>
        <TodayAdminManager initialEvents={initial} />
      </main>
    </>
  )
}
