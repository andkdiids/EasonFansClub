import { requireAdminPage } from '@/components/AdminAccess'
import { ActivityAdminManager } from '@/app/admin/activities/ActivityAdminManager'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminActivitiesPage() {
  await requireAdminPage('/admin/activities', 'activity_manage')
  const activities = await prisma.activity.findMany({
    orderBy: [{ status: 'asc' }, { isPinned: 'desc' }, { sortOrder: 'asc' }, { startsAt: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: activitySelect,
  })
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <h1 className="text-3xl font-black text-brand-950 dark:text-slate-100 sm:text-4xl">活动中心管理</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">创建、编辑、预览、发布和取消活动。活动结束状态根据时间动态计算，不需要定时任务；已取消活动会保留历史页面。</p>
      </section>
      <ActivityAdminManager initialActivities={activities.map((activity) => serializeActivityRow(activity))} />
    </main>
  )
}
