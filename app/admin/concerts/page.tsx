import { requireAdminPage } from '@/components/AdminAccess'
import { ConcertEventAdminManager } from '@/app/admin/concerts/ConcertEventAdminManager'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminConcertsPage() {
  await requireAdminPage('/admin/concerts', 'activity_manage')
  const events = await prisma.concertEvent.findMany({ orderBy: [{ updatedAt: 'desc' }], take: 100, include: { shows: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] }, timeline: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] }, tutorials: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } })
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9"><section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7"><h1 className="text-2xl font-black text-[var(--foreground)] sm:text-3xl">演唱会专题管理</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--foreground-muted)]">维护专题、登记地址、首页露出、时间线、场次与教程。移除历史项目请改为归档、取消或草稿状态，保存不会物理删除场次、参与记录或讨论帖。</p></section><ConcertEventAdminManager initialEvents={events} /></main>
}
