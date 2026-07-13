import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'
import { NotificationBroadcastForm } from './NotificationBroadcastForm'

export const dynamic = 'force-dynamic'

export default async function AdminNotificationsPage() {
  const user = await requireAdminPage('/admin/notifications', 'notification_manage')
  const [totalUsers, notifications] = await Promise.all([
    prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }),
    prisma.systemNotification.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        content: true,
        type: true,
        link: true,
        isPublished: true,
        publishedAt: true,
        createdBy: { select: { nickname: true, uid: true } },
        _count: { select: { reads: true } },
      },
    }),
  ])

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[420px_minmax(0,1fr)]">
        <NotificationBroadcastForm />

        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
          <h2 className="text-2xl font-black text-brand-950">已发布通知</h2>
          <div className="mt-5 space-y-3">
            {notifications.map((item) => (
              <article key={item.id} className="rounded-2xl bg-sky-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-brand-950">{item.title}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {item.type} · {item.createdBy.nickname} · {new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false })}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${item.isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {item.isPublished ? '已发布' : '已隐藏'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{item.content}</p>
                {item.link ? <p className="mt-2 text-xs font-bold text-brand-700">链接：{item.link}</p> : null}
                <p className="mt-3 text-xs font-black text-slate-500">
                  已读 {item._count.reads} · 未读 {Math.max(totalUsers - item._count.reads, 0)}
                </p>
              </article>
            ))}
            {!notifications.length ? <p className="rounded-2xl bg-sky-50 p-5 text-sm font-bold text-slate-500">暂无全站通知。</p> : null}
          </div>
        </section>
      </main>
    </>
  )
}
